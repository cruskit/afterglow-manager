use crate::settings::{extract_bucket_name, extract_distribution_id, get_credentials_from_keychain};
use crate::thumbnails::{build_thumbnail_specs, ensure_thumbnails_with_progress, parse_galleries_array};
use aws_credential_types::Credentials;
use aws_sdk_s3::config::Region;
use aws_sdk_s3::primitives::ByteStream;
use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;
use tauri::{Emitter, Manager};

const IMAGE_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "tiff", "tif",
];

fn is_syncable_file(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    IMAGE_EXTENSIONS.contains(&ext.as_str())
        || ext == "json"
        || ext == "html"
        || ext == "css"
        || ext == "js"
}

fn content_type_for_extension(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "tiff" | "tif" => "image/tiff",
        "ico" => "image/x-icon",
        "json" => "application/json",
        "html" => "text/html; charset=utf-8",
        "css" => "text/css",
        "js" => "application/javascript",
        _ => "application/octet-stream",
    }
}

fn compute_md5(path: &Path) -> Result<String, String> {
    let data = fs::read(path).map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    let mut hasher = Md5::new();
    hasher.update(&data);
    let result = hasher.finalize();
    Ok(format!("{:x}", result))
}

#[allow(dead_code)]
fn walk_syncable_files(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    walk_dir_recursive(root, root, &mut files)?;
    files.sort();
    Ok(files)
}

fn walk_dir_recursive(root: &Path, dir: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("Cannot read {}: {}", dir.display(), e))?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files/dirs
        if name.starts_with('.') {
            continue;
        }

        if path.is_dir() {
            walk_dir_recursive(root, &path, files)?;
        } else if path.is_file() && is_syncable_file(&path) {
            files.push(path);
        }
    }
    Ok(())
}


/// Collect only the files that are reachable from galleries.json.
///
/// This traverses the gallery JSON structure:
///   galleries.json → each gallery entry's slug → {slug}/gallery-details.json → photos
///
/// Only files explicitly referenced are included. Untracked folders/files are excluded.
fn collect_referenced_files(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files: HashSet<PathBuf> = HashSet::new();

    // Always include galleries.json
    let galleries_path = root.join("galleries.json");
    if !galleries_path.exists() {
        return Err(format!(
            "galleries.json not found in {}",
            root.display()
        ));
    }
    files.insert(galleries_path.clone());

    // Parse galleries.json (supports both wrapped and legacy formats)
    let galleries_content =
        fs::read_to_string(&galleries_path).map_err(|e| format!("Failed to read galleries.json: {}", e))?;
    let raw: serde_json::Value =
        serde_json::from_str(&galleries_content).map_err(|e| format!("Failed to parse galleries.json: {}", e))?;
    let galleries = if let Some(arr) = raw.as_array() {
        // Legacy format: plain array
        arr.clone()
    } else if let Some(obj) = raw.as_object() {
        // New format: { schemaVersion, galleries: [...] }
        obj.get("galleries")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
    } else {
        return Err("galleries.json has unexpected format".to_string());
    };

    for gallery in &galleries {
        let slug = match gallery.get("slug").and_then(|v| v.as_str()) {
            Some(s) => s,
            None => continue,
        };

        // Include cover image if referenced and exists
        // Cover path is relative to workspace root (e.g. "sunset/01.jpg")
        if let Some(cover) = gallery.get("cover").and_then(|v| v.as_str()) {
            if !cover.is_empty() {
                let cover_path = root.join(cover);
                if cover_path.exists() && cover_path.is_file() {
                    files.insert(cover_path);
                }
            }
        }

        // Include gallery-details.json and its referenced photos
        let details_path = root.join(slug).join("gallery-details.json");
        if details_path.exists() {
            files.insert(details_path.clone());

            if let Ok(details_content) = fs::read_to_string(&details_path) {
                if let Ok(details) = serde_json::from_str::<serde_json::Value>(&details_content) {
                    if let Some(photos) = details.get("photos").and_then(|v| v.as_array()) {
                        for photo in photos {
                            for field in &["thumbnail", "full"] {
                                if let Some(path_str) = photo.get(field).and_then(|v| v.as_str()) {
                                    if !path_str.is_empty() {
                                        // Photo path is relative to gallery dir (e.g. "01.jpg")
                                        let photo_path = root.join(slug).join(path_str);
                                        if photo_path.exists() && photo_path.is_file() {
                                            files.insert(photo_path);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let mut result: Vec<PathBuf> = files.into_iter().collect();
    result.sort();
    Ok(result)
}

// Website source files embedded at compile time so they work in dev and production alike.
const WEBSITE_INDEX_HTML: &[u8] = include_bytes!("../../afterglow-website/index.html");
const WEBSITE_STYLES_CSS: &[u8] = include_bytes!("../../afterglow-website/afterglow/css/styles.css");
const WEBSITE_APP_JS: &[u8] = include_bytes!("../../afterglow-website/afterglow/js/app.js");
const WEBSITE_FAVICON_ICO: &[u8] = include_bytes!("../../afterglow-website/favicon.ico");
const WEBSITE_FAVICON_PNG: &[u8] = include_bytes!("../../afterglow-website/favicon.png");

/// Write the embedded website files to a temporary directory and return
/// (local_path, s3_key) pairs for the five files:
///   - index.html at the site root
///   - afterglow/css/styles.css
///   - afterglow/js/app.js
///   - favicon.ico
///   - favicon.png
fn collect_website_files(s3_root: &str) -> Result<Vec<(PathBuf, String)>, String> {
    let tmp = std::env::temp_dir().join("afterglow-manager-website");
    let css_dir = tmp.join("afterglow").join("css");
    let js_dir = tmp.join("afterglow").join("js");
    fs::create_dir_all(&css_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;
    fs::create_dir_all(&js_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;

    let entries = [
        (WEBSITE_INDEX_HTML, tmp.join("index.html"), format!("{}index.html", s3_root)),
        (WEBSITE_STYLES_CSS, css_dir.join("styles.css"), format!("{}afterglow/css/styles.css", s3_root)),
        (WEBSITE_APP_JS, js_dir.join("app.js"), format!("{}afterglow/js/app.js", s3_root)),
        (WEBSITE_FAVICON_ICO, tmp.join("favicon.ico"), format!("{}favicon.ico", s3_root)),
        (WEBSITE_FAVICON_PNG, tmp.join("favicon.png"), format!("{}favicon.png", s3_root)),
    ];

    let mut result = Vec::new();
    for (data, path, s3_key) in &entries {
        fs::write(path, data).map_err(|e| format!("Failed to write temp website file: {}", e))?;
        result.push((path.clone(), s3_key.clone()));
    }

    Ok(result)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncFile {
    pub local_path: String,
    pub s3_key: String,
    pub size_bytes: u64,
    pub content_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishPlan {
    pub plan_id: String,
    pub to_upload: Vec<SyncFile>,
    pub to_delete: Vec<String>,
    pub unchanged: usize,
    pub total_files: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishProgress {
    pub current: usize,
    pub total: usize,
    pub file: String,
    pub action: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishResult {
    pub uploaded: usize,
    pub deleted: usize,
    pub unchanged: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishError {
    pub error: String,
    pub file: String,
}

// ===== Thumbnail Progress =====

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailProgress {
    /// 1-based index of the thumbnail just processed; 0 means no thumbnails to generate.
    pub current: usize,
    pub total: usize,
    /// Display name shown in the UI, e.g. "sunset/photo01.webp". Empty when total is 0.
    pub filename: String,
}

// ===== Publish-time JSON rewriting =====

/// Read `galleries.json` and return bytes with `cover` fields rewritten to point
/// at WebP thumbnails for any cover whose source path is in `cover_thumb_map`.
///
/// `cover_thumb_map`: source_path → new cover value (e.g. "sunset/.thumbs/01.webp")
fn rewrite_galleries_json_for_publish(
    root: &Path,
    cover_thumb_map: &HashMap<PathBuf, String>,
) -> Result<Vec<u8>, String> {
    let path = root.join("galleries.json");
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read galleries.json: {}", e))?;
    let mut raw: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse galleries.json: {}", e))?;

    let galleries = if let Some(obj) = raw.as_object_mut() {
        obj.get_mut("galleries").and_then(|v| v.as_array_mut())
    } else {
        raw.as_array_mut()
    };

    if let Some(galleries) = galleries {
        for gallery in galleries.iter_mut() {
            let cover = gallery
                .get("cover")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_default();
            if !cover.is_empty() {
                let source_path = root.join(&cover);
                if let Some(new_cover) = cover_thumb_map.get(&source_path) {
                    if let Some(g) = gallery.as_object_mut() {
                        g.insert("cover".to_string(), serde_json::Value::String(new_cover.clone()));
                    }
                }
            }
        }
    }

    serde_json::to_vec_pretty(&raw).map_err(|e| e.to_string())
}

/// Read a `gallery-details.json` and return bytes with `thumbnail` fields
/// rewritten to point at WebP thumbnails for any photo in `photo_thumb_map`.
///
/// `photo_thumb_map`: source_path → new thumbnail value (e.g. ".thumbs/01.webp")
fn rewrite_gallery_details_json_for_publish(
    details_path: &Path,
    root: &Path,
    slug: &str,
    photo_thumb_map: &HashMap<PathBuf, String>,
) -> Result<Vec<u8>, String> {
    let content = fs::read_to_string(details_path)
        .map_err(|e| format!("Failed to read {}: {}", details_path.display(), e))?;
    let mut raw: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse {}: {}", details_path.display(), e))?;

    if let Some(photos) = raw.get_mut("photos").and_then(|v| v.as_array_mut()) {
        for photo in photos.iter_mut() {
            let thumbnail = photo
                .get("thumbnail")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_default();
            if !thumbnail.is_empty() {
                let source_path = root.join(slug).join(&thumbnail);
                if let Some(new_thumbnail) = photo_thumb_map.get(&source_path) {
                    if let Some(p) = photo.as_object_mut() {
                        p.insert(
                            "thumbnail".to_string(),
                            serde_json::Value::String(new_thumbnail.clone()),
                        );
                    }
                }
            }
        }
    }

    serde_json::to_vec_pretty(&raw).map_err(|e| e.to_string())
}

// ===== Search Index =====

#[derive(Debug, Serialize)]
struct SearchIndexGallery {
    slug: String,
    name: String,
    date: String,
    description: String,
    tags: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchIndexPhoto {
    gallery_slug: String,
    thumbnail: String,
    full: String,
    alt: String,
    tags: Vec<String>,
}

#[derive(Debug, Serialize)]
struct SearchIndex {
    version: u32,
    galleries: Vec<SearchIndexGallery>,
    photos: Vec<SearchIndexPhoto>,
}

fn generate_search_index(
    root: &Path,
    photo_thumb_map: &HashMap<PathBuf, String>,
) -> Result<Vec<u8>, String> {
    let mut galleries_out: Vec<SearchIndexGallery> = Vec::new();
    let mut photos_out: Vec<SearchIndexPhoto> = Vec::new();

    let galleries_path = root.join("galleries.json");
    if !galleries_path.exists() {
        let index = SearchIndex { version: 1, galleries: vec![], photos: vec![] };
        return serde_json::to_vec(&index).map_err(|e| e.to_string());
    }

    let content = fs::read_to_string(&galleries_path).map_err(|e| e.to_string())?;
    let raw: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let galleries = parse_galleries_array(&raw);

    for gallery in &galleries {
        let slug = match gallery.get("slug").and_then(|v| v.as_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        let name = gallery.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let date = gallery.get("date").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let gallery_tags: Vec<String> = gallery
            .get("tags")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|t| t.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default();

        let details_path = root.join(&slug).join("gallery-details.json");
        let mut description = String::new();

        if details_path.exists() {
            if let Ok(dc) = fs::read_to_string(&details_path) {
                if let Ok(dv) = serde_json::from_str::<serde_json::Value>(&dc) {
                    description = dv.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    if let Some(photos) = dv.get("photos").and_then(|v| v.as_array()) {
                        for photo in photos {
                            let thumbnail_raw = photo
                                .get("thumbnail")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            // Rewrite thumbnail to .thumbs/ path if a thumbnail was generated
                            let source_path = root.join(&slug).join(&thumbnail_raw);
                            let thumbnail = photo_thumb_map
                                .get(&source_path)
                                .cloned()
                                .unwrap_or(thumbnail_raw);
                            let full = photo.get("full").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let alt = photo.get("alt").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let photo_tags: Vec<String> = photo
                                .get("tags")
                                .and_then(|v| v.as_array())
                                .map(|arr| arr.iter().filter_map(|t| t.as_str().map(|s| s.to_string())).collect())
                                .unwrap_or_default();
                            photos_out.push(SearchIndexPhoto {
                                gallery_slug: slug.clone(),
                                thumbnail,
                                full,
                                alt,
                                tags: photo_tags,
                            });
                        }
                    }
                }
            }
        }

        galleries_out.push(SearchIndexGallery {
            slug,
            name,
            date,
            description,
            tags: gallery_tags,
        });
    }

    let index = SearchIndex {
        version: 1,
        galleries: galleries_out,
        photos: photos_out,
    };
    serde_json::to_vec_pretty(&index).map_err(|e| e.to_string())
}

pub struct PublishState {
    pub plans: HashMap<String, PublishPlan>,
    pub cancelled: HashMap<String, bool>,
}

impl PublishState {
    pub fn new() -> Self {
        Self {
            plans: HashMap::new(),
            cancelled: HashMap::new(),
        }
    }
}

#[tauri::command]
pub async fn publish_preview(
    app: tauri::AppHandle,
    folder_path: String,
    bucket: String,
    region: String,
    s3_root: String,
) -> Result<PublishPlan, String> {
    let (key_id, secret) = get_credentials_from_keychain()?;

    let creds = Credentials::new(&key_id, &secret, None, None, "afterglow-manager");
    let region = Region::new(region);

    let s3_config = aws_sdk_s3::Config::builder()
        .credentials_provider(creds)
        .region(region)
        .behavior_version_latest()
        .build();
    let s3_client = aws_sdk_s3::Client::from_conf(s3_config);

    let bucket = extract_bucket_name(&bucket);
    let root = PathBuf::from(&folder_path);

    // Normalise s3_root: must be empty or end with /
    let s3_root = if s3_root.is_empty() || s3_root.ends_with('/') {
        s3_root
    } else {
        format!("{}/", s3_root)
    };

    // ===== Thumbnail generation =====
    // Parse galleries.json to build thumbnail specs before any network I/O.
    let galleries_json: serde_json::Value = {
        let path = root.join("galleries.json");
        let content = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read galleries.json: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse galleries.json: {}", e))?
    };

    let specs = build_thumbnail_specs(&root, &galleries_json, &s3_root);
    let total_specs = specs.len();

    let thumb_results = if total_specs > 0 {
        let specs_for_gen = specs.clone();
        let app_clone = app.clone();
        tokio::task::spawn_blocking(move || {
            ensure_thumbnails_with_progress(&specs_for_gen, |current, total, spec| {
                let _ = app_clone.emit(
                    "publish-thumbnail-progress",
                    ThumbnailProgress {
                        current,
                        total,
                        filename: format!("{}/{}", spec.slug, spec.thumb_filename),
                    },
                );
            })
        })
        .await
        .map_err(|e| format!("Thumbnail generation panicked: {}", e))?
    } else {
        // No thumbnails to generate — emit immediately so the UI transitions to scanning
        let _ = app.emit(
            "publish-thumbnail-progress",
            ThumbnailProgress { current: 0, total: 0, filename: String::new() },
        );
        crate::thumbnails::ThumbnailResults { generated: 0, skipped: 0, errors: vec![] }
    };

    if !thumb_results.errors.is_empty() {
        for (src, err) in &thumb_results.errors {
            eprintln!("[thumbnails] Error generating {}: {}", src.display(), err);
        }
    }

    // Build thumb maps for JSON rewriting.
    // photo_thumb_map: source_path → ".thumbs/{filename}.webp"  (used in gallery-details.json)
    // cover_thumb_map: source_path → "{slug}/.thumbs/{filename}.webp"  (used in galleries.json)
    let mut photo_thumb_map: HashMap<PathBuf, String> = HashMap::new();
    let mut cover_thumb_map: HashMap<PathBuf, String> = HashMap::new();
    for spec in &specs {
        if spec.dest_path.exists() {
            photo_thumb_map.insert(
                spec.source_path.clone(),
                format!(".thumbs/{}", spec.thumb_filename),
            );
            cover_thumb_map.insert(
                spec.source_path.clone(),
                format!("{}/.thumbs/{}", spec.slug, spec.thumb_filename),
            );
        }
    }

    // Write rewritten JSON to a temp directory.
    let rewrite_tmp = std::env::temp_dir().join("afterglow-manager-rewritten");
    fs::create_dir_all(&rewrite_tmp)
        .map_err(|e| format!("Failed to create rewrite temp dir: {}", e))?;

    // Build local file map: s3_key -> (local_path, md5)
    let mut local_map: HashMap<String, (PathBuf, String)> = HashMap::new();

    // Gallery files go under {s3_root}galleries/
    let gallery_files = collect_referenced_files(&root)?;
    let galleries_prefix = format!("{}galleries/", s3_root);
    for file_path in &gallery_files {
        let relative = file_path
            .strip_prefix(&root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        let s3_key = format!("{}{}", galleries_prefix, relative);
        let md5 = compute_md5(file_path)?;
        local_map.insert(s3_key, (file_path.clone(), md5));
    }

    // Rewrite galleries.json with thumbnail cover paths (if any thumbnails generated)
    if !cover_thumb_map.is_empty() {
        let rewritten = rewrite_galleries_json_for_publish(&root, &cover_thumb_map)?;
        let tmp_path = rewrite_tmp.join("galleries.json");
        fs::write(&tmp_path, &rewritten)
            .map_err(|e| format!("Failed to write rewritten galleries.json: {}", e))?;
        let md5 = compute_md5(&tmp_path)?;
        let s3_key = format!("{}galleries.json", galleries_prefix);
        local_map.insert(s3_key, (tmp_path, md5));
    }

    // Rewrite each gallery-details.json with thumbnail paths
    if !photo_thumb_map.is_empty() {
        let galleries = parse_galleries_array(&galleries_json);
        for gallery in &galleries {
            let slug = match gallery.get("slug").and_then(|v| v.as_str()) {
                Some(s) => s,
                None => continue,
            };
            let details_path = root.join(slug).join("gallery-details.json");
            if !details_path.exists() {
                continue;
            }
            let rewritten = rewrite_gallery_details_json_for_publish(
                &details_path,
                &root,
                slug,
                &photo_thumb_map,
            )?;
            let tmp_dir = rewrite_tmp.join(slug);
            fs::create_dir_all(&tmp_dir)
                .map_err(|e| format!("Failed to create rewrite tmp dir: {}", e))?;
            let tmp_path = tmp_dir.join("gallery-details.json");
            fs::write(&tmp_path, &rewritten)
                .map_err(|e| format!("Failed to write rewritten gallery-details.json: {}", e))?;
            let md5 = compute_md5(&tmp_path)?;
            let s3_key = format!("{}{}/gallery-details.json", galleries_prefix, slug);
            local_map.insert(s3_key, (tmp_path, md5));
        }
    }

    // Add generated thumbnail .webp files to local_map
    for spec in &specs {
        if spec.dest_path.exists() {
            let md5 = compute_md5(&spec.dest_path)?;
            local_map.insert(spec.s3_key.clone(), (spec.dest_path.clone(), md5));
        }
    }

    // Search index goes at {s3_root}galleries/search-index.json
    let search_index_bytes = generate_search_index(&root, &photo_thumb_map)?;
    let tmp_dir = std::env::temp_dir().join("afterglow-manager-search");
    fs::create_dir_all(&tmp_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;
    let search_index_path = tmp_dir.join("search-index.json");
    fs::write(&search_index_path, &search_index_bytes)
        .map_err(|e| format!("Failed to write search index: {}", e))?;
    let search_index_key = format!("{}search-index.json", galleries_prefix);
    let search_index_md5 = compute_md5(&search_index_path)?;
    local_map.insert(search_index_key, (search_index_path, search_index_md5));

    // Website files go at {s3_root}index.html, {s3_root}afterglow/...
    let website_files = collect_website_files(&s3_root)?;
    for (file_path, s3_key) in &website_files {
        let md5 = compute_md5(file_path)?;
        local_map.insert(s3_key.clone(), (file_path.clone(), md5));
    }

    // List all S3 objects under s3_root
    let mut s3_objects: HashMap<String, String> = HashMap::new(); // key -> etag
    let mut continuation_token: Option<String> = None;
    loop {
        let mut req = s3_client.list_objects_v2().bucket(&bucket).prefix(&s3_root);
        if let Some(token) = &continuation_token {
            req = req.continuation_token(token);
        }
        let resp = req.send().await.map_err(|e| format!("{}", e))?;

        for obj in resp.contents() {
            let key = obj.key().unwrap_or_default();
            if key.is_empty() {
                continue;
            }
            let etag = obj
                .e_tag()
                .unwrap_or_default()
                .trim_matches('"')
                .to_string();
            s3_objects.insert(key.to_string(), etag);
        }

        if resp.is_truncated() == Some(true) {
            continuation_token = resp.next_continuation_token().map(|s| s.to_string());
        } else {
            break;
        }
    }

    // Compare
    let mut to_upload = Vec::new();
    let mut unchanged: usize = 0;

    for (s3_key, (local_path, local_md5)) in &local_map {
        if let Some(etag) = s3_objects.get(s3_key) {
            // If ETag contains a hyphen (multipart upload), treat as changed
            if !etag.contains('-') && etag == local_md5 {
                unchanged += 1;
                continue;
            }
        }

        let metadata = fs::metadata(local_path).map_err(|e| e.to_string())?;
        to_upload.push(SyncFile {
            local_path: local_path.to_string_lossy().to_string(),
            s3_key: s3_key.clone(),
            size_bytes: metadata.len(),
            content_type: content_type_for_extension(local_path).to_string(),
        });
    }

    // Files to delete: in S3 but not in local map, restricted to managed areas only.
    // We only manage: {s3_root}galleries/*, {s3_root}afterglow/*, {s3_root}index.html, {s3_root}favicon.*
    let afterglow_prefix = format!("{}afterglow/", s3_root);
    let index_key = format!("{}index.html", s3_root);
    let favicon_ico_key = format!("{}favicon.ico", s3_root);
    let favicon_png_key = format!("{}favicon.png", s3_root);
    let to_delete: Vec<String> = s3_objects
        .keys()
        .filter(|key| {
            !local_map.contains_key(*key)
                && (key.starts_with(&galleries_prefix)
                    || key.starts_with(&afterglow_prefix)
                    || **key == index_key
                    || **key == favicon_ico_key
                    || **key == favicon_png_key)
        })
        .cloned()
        .collect();

    let total_files = to_upload.len() + to_delete.len() + unchanged;
    let plan_id = uuid::Uuid::new_v4().to_string();

    let plan = PublishPlan {
        plan_id: plan_id.clone(),
        to_upload,
        to_delete,
        unchanged,
        total_files,
    };

    // Store the plan
    let state = app.state::<Mutex<PublishState>>();
    let mut state = state.lock().map_err(|e| e.to_string())?;
    state.plans.insert(plan_id.clone(), plan.clone());
    state.cancelled.insert(plan_id, false);

    Ok(plan)
}

#[tauri::command]
pub async fn publish_execute(app: tauri::AppHandle, plan_id: String) -> Result<(), String> {
    let (plan, key_id, secret) = {
        let state = app.state::<Mutex<PublishState>>();
        let state = state.lock().map_err(|e| e.to_string())?;
        let plan = state
            .plans
            .get(&plan_id)
            .ok_or("Plan not found. Run preview first.")?
            .clone();
        let (key_id, secret) = get_credentials_from_keychain()?;
        (plan, key_id, secret)
    };

    // Extract region from any s3_key or use default
    // We need region from settings, but it's passed via the plan context
    // For now, get it from app state settings
    let settings_path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot determine app data directory: {}", e))?
        .join("settings.json");
    let settings_content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
    let settings: crate::settings::AppSettings =
        serde_json::from_str(&settings_content).map_err(|e| e.to_string())?;

    let bucket_name = extract_bucket_name(&settings.bucket);
    let creds = Credentials::new(&key_id, &secret, None, None, "afterglow-manager");
    let region = Region::new(settings.region.clone());

    let s3_config = aws_sdk_s3::Config::builder()
        .credentials_provider(creds)
        .region(region)
        .behavior_version_latest()
        .build();
    let s3_client = aws_sdk_s3::Client::from_conf(s3_config);

    let total = plan.to_upload.len() + plan.to_delete.len();
    let mut current: usize = 0;
    let mut uploaded: usize = 0;
    let mut deleted: usize = 0;
    let _start = Instant::now();

    // Upload files
    for file in &plan.to_upload {
        // Check cancellation
        {
            let state = app.state::<Mutex<PublishState>>();
            let state = state.lock().map_err(|e| e.to_string())?;
            if state.cancelled.get(&plan_id) == Some(&true) {
                let _ = app.emit("publish-complete", PublishResult {
                    uploaded,
                    deleted,
                    unchanged: plan.unchanged,
                });
                return Ok(());
            }
        }

        current += 1;
        let _ = app.emit(
            "publish-progress",
            PublishProgress {
                current,
                total,
                file: file.s3_key.clone(),
                action: "upload".to_string(),
            },
        );

        let body = ByteStream::from_path(&file.local_path)
            .await
            .map_err(|e| format!("Failed to read {}: {}", file.local_path, e))?;

        match s3_client
            .put_object()
            .bucket(&bucket_name)
            .key(&file.s3_key)
            .content_type(&file.content_type)
            .body(body)
            .send()
            .await
        {
            Ok(_) => uploaded += 1,
            Err(e) => {
                let _ = app.emit(
                    "publish-error",
                    PublishError {
                        error: format!("{}", e),
                        file: file.s3_key.clone(),
                    },
                );
                return Err(format!("Upload failed for {}: {}", file.s3_key, e));
            }
        }
    }

    // Delete files
    // Safety: only delete keys in the managed areas (galleries/, afterglow/, index.html)
    let s3_root = &settings.s3_prefix;
    let galleries_prefix = format!("{}galleries/", s3_root);
    let afterglow_prefix = format!("{}afterglow/", s3_root);
    let index_key = format!("{}index.html", s3_root);

    for s3_key in &plan.to_delete {
        // Safety: only delete keys within managed areas
        if !s3_key.starts_with(&galleries_prefix)
            && !s3_key.starts_with(&afterglow_prefix)
            && s3_key.as_str() != index_key.as_str()
        {
            continue;
        }

        // Check cancellation
        {
            let state = app.state::<Mutex<PublishState>>();
            let state = state.lock().map_err(|e| e.to_string())?;
            if state.cancelled.get(&plan_id) == Some(&true) {
                let _ = app.emit("publish-complete", PublishResult {
                    uploaded,
                    deleted,
                    unchanged: plan.unchanged,
                });
                return Ok(());
            }
        }

        current += 1;
        let _ = app.emit(
            "publish-progress",
            PublishProgress {
                current,
                total,
                file: s3_key.clone(),
                action: "delete".to_string(),
            },
        );

        match s3_client
            .delete_object()
            .bucket(&bucket_name)
            .key(s3_key)
            .send()
            .await
        {
            Ok(_) => deleted += 1,
            Err(e) => {
                let _ = app.emit(
                    "publish-error",
                    PublishError {
                        error: format!("{}", e),
                        file: s3_key.clone(),
                    },
                );
                return Err(format!("Delete failed for {}: {}", s3_key, e));
            }
        }
    }

    // CloudFront cache invalidation
    let dist_id = extract_distribution_id(&settings.cloud_front_distribution_id);
    if !dist_id.is_empty() {
        let _ = app.emit(
            "publish-progress",
            PublishProgress {
                current: total,
                total,
                file: "".to_string(),
                action: "invalidate".to_string(),
            },
        );

        let cf_config = aws_sdk_cloudfront::Config::builder()
            .credentials_provider(Credentials::new(&key_id, &secret, None, None, "afterglow-manager"))
            .region(Region::new("us-east-1"))
            .behavior_version_latest()
            .build();
        let cf_client = aws_sdk_cloudfront::Client::from_conf(cf_config);

        let invalidation_path = format!("/{}*", s3_root);
        let invalidation_result = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            cf_client
                .create_invalidation()
                .distribution_id(&dist_id)
                .invalidation_batch(
                    aws_sdk_cloudfront::types::InvalidationBatch::builder()
                        .paths(
                            aws_sdk_cloudfront::types::Paths::builder()
                                .quantity(1)
                                .items(&invalidation_path)
                                .build()
                                .map_err(|e| format!("CloudFront invalidation error: {}", e))?,
                        )
                        .caller_reference(uuid::Uuid::new_v4().to_string())
                        .build()
                        .map_err(|e| format!("CloudFront invalidation error: {}", e))?,
                )
                .send(),
        )
        .await;

        match invalidation_result {
            Ok(Ok(_)) => {
                eprintln!("[publish] CloudFront invalidation created for path: {}", invalidation_path);
            }
            Ok(Err(e)) => {
                let _ = app.emit(
                    "publish-error",
                    PublishError {
                        error: format!("CloudFront invalidation failed: {}", e),
                        file: "".to_string(),
                    },
                );
                return Err(format!("CloudFront invalidation failed: {}", e));
            }
            Err(_) => {
                let _ = app.emit(
                    "publish-error",
                    PublishError {
                        error: "CloudFront invalidation timed out after 30s.".to_string(),
                        file: "".to_string(),
                    },
                );
                return Err("CloudFront invalidation timed out after 30s.".to_string());
            }
        }
    }

    let _ = app.emit("publish-complete", PublishResult {
        uploaded,
        deleted,
        unchanged: plan.unchanged,
    });

    // Clean up plan
    {
        let state = app.state::<Mutex<PublishState>>();
        let mut state = state.lock().map_err(|e| e.to_string())?;
        state.plans.remove(&plan_id);
        state.cancelled.remove(&plan_id);
    }

    Ok(())
}

#[tauri::command]
pub async fn publish_cancel(app: tauri::AppHandle, plan_id: String) -> Result<(), String> {
    let state = app.state::<Mutex<PublishState>>();
    let mut state = state.lock().map_err(|e| e.to_string())?;
    state.cancelled.insert(plan_id, true);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_content_type_mapping() {
        assert_eq!(content_type_for_extension(Path::new("photo.jpg")), "image/jpeg");
        assert_eq!(content_type_for_extension(Path::new("photo.jpeg")), "image/jpeg");
        assert_eq!(content_type_for_extension(Path::new("photo.png")), "image/png");
        assert_eq!(content_type_for_extension(Path::new("photo.gif")), "image/gif");
        assert_eq!(content_type_for_extension(Path::new("photo.webp")), "image/webp");
        assert_eq!(content_type_for_extension(Path::new("photo.avif")), "image/avif");
        assert_eq!(content_type_for_extension(Path::new("photo.bmp")), "image/bmp");
        assert_eq!(content_type_for_extension(Path::new("photo.tiff")), "image/tiff");
        assert_eq!(content_type_for_extension(Path::new("photo.tif")), "image/tiff");
        assert_eq!(content_type_for_extension(Path::new("data.json")), "application/json");
        assert_eq!(content_type_for_extension(Path::new("index.html")), "text/html; charset=utf-8");
        assert_eq!(content_type_for_extension(Path::new("styles.css")), "text/css");
        assert_eq!(content_type_for_extension(Path::new("app.js")), "application/javascript");
        assert_eq!(content_type_for_extension(Path::new("file.xyz")), "application/octet-stream");
    }

    #[test]
    fn test_is_syncable_file() {
        assert!(is_syncable_file(Path::new("photo.jpg")));
        assert!(is_syncable_file(Path::new("photo.JPEG")));
        assert!(is_syncable_file(Path::new("photo.png")));
        assert!(is_syncable_file(Path::new("data.json")));
        assert!(is_syncable_file(Path::new("index.html")));
        assert!(is_syncable_file(Path::new("styles.css")));
        assert!(is_syncable_file(Path::new("app.js")));
        assert!(!is_syncable_file(Path::new(".DS_Store")));
        assert!(!is_syncable_file(Path::new("readme.txt")));
        assert!(!is_syncable_file(Path::new("file.md")));
        assert!(!is_syncable_file(Path::new(".gitignore")));
    }

    #[test]
    fn test_s3_key_construction_gallery_files() {
        // Gallery files go under {s3_root}galleries/{relative}
        let root = PathBuf::from("/workspace/galleries");
        let file = root.join("coastal-sunset/01.jpg");
        let relative = file
            .strip_prefix(&root)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");

        // Bucket root (s3_root = "")
        let s3_key = format!("galleries/{}", relative);
        assert_eq!(s3_key, "galleries/coastal-sunset/01.jpg");

        // Subdirectory (s3_root = "my-site/")
        let s3_key = format!("my-site/galleries/{}", relative);
        assert_eq!(s3_key, "my-site/galleries/coastal-sunset/01.jpg");
    }

    #[test]
    fn test_managed_area_safety_check() {
        // Managed areas: galleries/, afterglow/, index.html
        let s3_root = "";
        let galleries_prefix = format!("{}galleries/", s3_root);
        let afterglow_prefix = format!("{}afterglow/", s3_root);
        let index_key = format!("{}index.html", s3_root);

        let is_managed = |key: &str| -> bool {
            key.starts_with(&galleries_prefix)
                || key.starts_with(&afterglow_prefix)
                || key == index_key.as_str()
        };

        assert!(is_managed("galleries/coastal-sunset/01.jpg"));
        assert!(is_managed("galleries/galleries.json"));
        assert!(is_managed("afterglow/css/styles.css"));
        assert!(is_managed("afterglow/js/app.js"));
        assert!(is_managed("index.html"));
        assert!(!is_managed("other/file.jpg"));
        assert!(!is_managed("index.html.bak"));
    }

    #[test]
    fn test_managed_area_safety_check_with_s3_root() {
        let s3_root = "my-site/";
        let galleries_prefix = format!("{}galleries/", s3_root);
        let afterglow_prefix = format!("{}afterglow/", s3_root);
        let index_key = format!("{}index.html", s3_root);

        let is_managed = |key: &str| -> bool {
            key.starts_with(&galleries_prefix)
                || key.starts_with(&afterglow_prefix)
                || key == index_key.as_str()
        };

        assert!(is_managed("my-site/galleries/photo.jpg"));
        assert!(is_managed("my-site/afterglow/css/styles.css"));
        assert!(is_managed("my-site/index.html"));
        assert!(!is_managed("galleries/photo.jpg")); // wrong root
        assert!(!is_managed("other-site/index.html"));
    }

    #[test]
    fn test_etag_comparison_exact_match() {
        let local_md5 = "d41d8cd98f00b204e9800998ecf8427e";
        let etag = "d41d8cd98f00b204e9800998ecf8427e";
        assert!(!etag.contains('-') && etag == local_md5);
    }

    #[test]
    fn test_etag_comparison_multipart() {
        // Multipart ETags contain a hyphen and should be treated as changed
        let etag = "d41d8cd98f00b204e9800998ecf8427e-2";
        assert!(etag.contains('-'));
    }

    #[test]
    fn test_publish_plan_serialization() {
        let plan = PublishPlan {
            plan_id: "test-id".to_string(),
            to_upload: vec![SyncFile {
                local_path: "/workspace/photo.jpg".to_string(),
                s3_key: "galleries/photo.jpg".to_string(),
                size_bytes: 1024,
                content_type: "image/jpeg".to_string(),
            }],
            to_delete: vec!["galleries/old.jpg".to_string()],
            unchanged: 5,
            total_files: 7,
        };
        let json = serde_json::to_string(&plan).unwrap();
        assert!(json.contains("planId"));
        assert!(json.contains("toUpload"));
        assert!(json.contains("toDelete"));
        assert!(json.contains("totalFiles"));
    }

    // --- collect_referenced_files tests ---

    use tempfile::TempDir;

    /// Helper: create a file with the given content, creating parent dirs as needed.
    fn create_file(base: &Path, relative: &str, content: &str) {
        let path = base.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&path, content).unwrap();
    }

    /// Helper: create a dummy image file (1 byte).
    fn create_image(base: &Path, relative: &str) {
        let path = base.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&path, b"\xff").unwrap();
    }

    #[test]
    fn test_collect_referenced_files_basic() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        // Set up galleries.json with one gallery (new wrapped format)
        create_file(
            root,
            "galleries.json",
            r#"{"schemaVersion":1,"galleries":[{"name":"Sunset","slug":"sunset","date":"Feb 2026","cover":"sunset/01.jpg"}]}"#,
        );

        // Set up gallery-details.json with two photos
        create_file(
            root,
            "sunset/gallery-details.json",
            r#"{"name":"Sunset","slug":"sunset","date":"Feb 2026","description":"","photos":[
                {"thumbnail":"01.jpg","full":"01.jpg","alt":"01"},
                {"thumbnail":"02.jpg","full":"02.jpg","alt":"02"}
            ]}"#,
        );
        create_image(root, "sunset/01.jpg");
        create_image(root, "sunset/02.jpg");

        // Untracked folder - should NOT be included
        create_image(root, "untracked/photo.jpg");
        create_file(
            root,
            "untracked/gallery-details.json",
            r#"{"name":"Untracked","slug":"untracked","photos":[]}"#,
        );

        let result = collect_referenced_files(root).unwrap();

        // Should include: galleries.json, sunset/gallery-details.json, sunset/01.jpg, sunset/02.jpg
        assert_eq!(result.len(), 4);
        assert!(result.contains(&root.join("galleries.json")));
        assert!(result.contains(&root.join("sunset/gallery-details.json")));
        assert!(result.contains(&root.join("sunset/01.jpg")));
        assert!(result.contains(&root.join("sunset/02.jpg")));

        // Should NOT include untracked files
        assert!(!result.contains(&root.join("untracked/photo.jpg")));
        assert!(!result.contains(&root.join("untracked/gallery-details.json")));
    }

    #[test]
    fn test_collect_referenced_files_legacy_format() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        // Legacy format: plain array (no schemaVersion wrapper)
        create_file(
            root,
            "galleries.json",
            r#"[{"name":"Sunset","slug":"sunset","date":"Feb 2026","cover":"sunset/01.jpg"}]"#,
        );
        create_file(
            root,
            "sunset/gallery-details.json",
            r#"{"name":"Sunset","slug":"sunset","date":"Feb 2026","description":"","photos":[
                {"thumbnail":"01.jpg","full":"01.jpg","alt":"01"}
            ]}"#,
        );
        create_image(root, "sunset/01.jpg");

        let result = collect_referenced_files(root).unwrap();
        assert_eq!(result.len(), 3);
        assert!(result.contains(&root.join("galleries.json")));
        assert!(result.contains(&root.join("sunset/gallery-details.json")));
        assert!(result.contains(&root.join("sunset/01.jpg")));
    }

    #[test]
    fn test_collect_referenced_files_empty_galleries() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        create_file(root, "galleries.json", r#"{"schemaVersion":1,"galleries":[]}"#);

        let result = collect_referenced_files(root).unwrap();
        assert_eq!(result.len(), 1);
        assert!(result.contains(&root.join("galleries.json")));
    }

    #[test]
    fn test_collect_referenced_files_missing_gallery_details() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        create_file(
            root,
            "galleries.json",
            r#"{"schemaVersion":1,"galleries":[{"name":"Sunset","slug":"sunset","date":"Feb 2026","cover":"sunset/01.jpg"}]}"#,
        );

        // Create the cover image but NO gallery-details.json
        create_image(root, "sunset/01.jpg");

        let result = collect_referenced_files(root).unwrap();

        // Should include galleries.json + cover image only
        assert_eq!(result.len(), 2);
        assert!(result.contains(&root.join("galleries.json")));
        assert!(result.contains(&root.join("sunset/01.jpg")));
    }

    #[test]
    fn test_collect_referenced_files_deduplication() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        // Cover image is the same as a photo entry
        create_file(
            root,
            "galleries.json",
            r#"{"schemaVersion":1,"galleries":[{"name":"Sunset","slug":"sunset","date":"Feb 2026","cover":"sunset/01.jpg"}]}"#,
        );
        create_file(
            root,
            "sunset/gallery-details.json",
            r#"{"name":"Sunset","slug":"sunset","date":"Feb 2026","description":"","photos":[
                {"thumbnail":"01.jpg","full":"01.jpg","alt":"01"}
            ]}"#,
        );
        create_image(root, "sunset/01.jpg");

        let result = collect_referenced_files(root).unwrap();

        // galleries.json + gallery-details.json + 01.jpg (deduplicated)
        assert_eq!(result.len(), 3);
    }

    #[test]
    fn test_collect_referenced_files_ignores_untracked_folders() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        create_file(
            root,
            "galleries.json",
            r#"{"schemaVersion":1,"galleries":[{"name":"A","slug":"a","date":"","cover":""}]}"#,
        );
        create_file(
            root,
            "a/gallery-details.json",
            r#"{"name":"A","slug":"a","date":"","description":"","photos":[]}"#,
        );

        // Untracked folders with various file types
        create_image(root, "b/photo1.jpg");
        create_image(root, "b/photo2.png");
        create_file(root, "b/gallery-details.json", "{}");
        create_image(root, "c/nested/deep/img.webp");

        let result = collect_referenced_files(root).unwrap();

        assert_eq!(result.len(), 2); // galleries.json + a/gallery-details.json
        assert!(result.contains(&root.join("galleries.json")));
        assert!(result.contains(&root.join("a/gallery-details.json")));
    }

    #[test]
    fn test_collect_referenced_files_missing_image_on_disk() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        // Reference an image that doesn't exist on disk
        create_file(
            root,
            "galleries.json",
            r#"{"schemaVersion":1,"galleries":[{"name":"Sunset","slug":"sunset","date":"","cover":"sunset/missing.jpg"}]}"#,
        );
        create_file(
            root,
            "sunset/gallery-details.json",
            r#"{"name":"Sunset","slug":"sunset","date":"","description":"","photos":[
                {"thumbnail":"missing.jpg","full":"missing.jpg","alt":"missing"}
            ]}"#,
        );

        let result = collect_referenced_files(root).unwrap();

        // Only galleries.json + gallery-details.json (missing image is skipped)
        assert_eq!(result.len(), 2);
        assert!(result.contains(&root.join("galleries.json")));
        assert!(result.contains(&root.join("sunset/gallery-details.json")));
    }

    #[test]
    fn test_collect_referenced_files_multiple_galleries() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        create_file(
            root,
            "galleries.json",
            r#"{"schemaVersion":1,"galleries":[
                {"name":"A","slug":"a","date":"","cover":"a/img.jpg"},
                {"name":"B","slug":"b","date":"","cover":"b/img.jpg"}
            ]}"#,
        );
        create_file(
            root,
            "a/gallery-details.json",
            r#"{"name":"A","slug":"a","date":"","description":"","photos":[
                {"thumbnail":"img.jpg","full":"img.jpg","alt":"img"}
            ]}"#,
        );
        create_file(
            root,
            "b/gallery-details.json",
            r#"{"name":"B","slug":"b","date":"","description":"","photos":[
                {"thumbnail":"img.jpg","full":"img.jpg","alt":"img"}
            ]}"#,
        );
        create_image(root, "a/img.jpg");
        create_image(root, "b/img.jpg");

        // Untracked gallery
        create_image(root, "c/img.jpg");

        let result = collect_referenced_files(root).unwrap();

        // galleries.json + 2 gallery-details + 2 images = 5
        assert_eq!(result.len(), 5);
        assert!(!result.contains(&root.join("c/img.jpg")));
    }

    // --- collect_website_files tests ---

    #[test]
    fn test_collect_website_files_bucket_root() {
        // Files are embedded at compile time; just verify s3 keys and that paths exist after collection.
        let files = collect_website_files("").unwrap();
        assert_eq!(files.len(), 3);

        let s3_keys: Vec<&str> = files.iter().map(|(_, k)| k.as_str()).collect();
        assert!(s3_keys.contains(&"index.html"));
        assert!(s3_keys.contains(&"afterglow/css/styles.css"));
        assert!(s3_keys.contains(&"afterglow/js/app.js"));

        for (path, _) in &files {
            assert!(path.exists(), "temp file should exist: {}", path.display());
        }
    }

    #[test]
    fn test_collect_website_files_with_s3_root() {
        let files = collect_website_files("my-site/").unwrap();
        assert_eq!(files.len(), 3);

        let s3_keys: Vec<&str> = files.iter().map(|(_, k)| k.as_str()).collect();
        assert!(s3_keys.contains(&"my-site/index.html"));
        assert!(s3_keys.contains(&"my-site/afterglow/css/styles.css"));
        assert!(s3_keys.contains(&"my-site/afterglow/js/app.js"));
    }

    #[test]
    fn test_website_index_html_has_updated_asset_paths() {
        // Verify the bundled index.html references afterglow/css/... not css/... directly
        let html = std::str::from_utf8(WEBSITE_INDEX_HTML).unwrap();
        assert!(html.contains("afterglow/css/styles.css"), "index.html should reference afterglow/css/styles.css");
        assert!(html.contains("afterglow/js/app.js"), "index.html should reference afterglow/js/app.js");
        assert!(!html.contains("href=\"css/"), "index.html should not have old css/ reference");
        assert!(!html.contains("src=\"js/"), "index.html should not have old js/ reference");
    }

    #[test]
    fn test_collect_referenced_files_no_galleries_json() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        let result = collect_referenced_files(root);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("galleries.json not found"));
    }
}
