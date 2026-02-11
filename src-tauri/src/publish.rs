use crate::settings::{extract_bucket_name, extract_distribution_id, get_credentials_from_keychain};
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
    IMAGE_EXTENSIONS.contains(&ext.as_str()) || ext == "json"
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
        "json" => "application/json",
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

/// Convert a site-relative path (e.g. "galleries/coastal-sunset/01.jpg") to a
/// workspace-relative path by stripping the first path segment.
/// Returns None if the path has fewer than 2 segments.
fn site_relative_to_workspace_relative(site_path: &str) -> Option<&str> {
    // Find the first '/' and return everything after it
    site_path.find('/').map(|idx| &site_path[idx + 1..])
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

    // Parse galleries.json
    let galleries_content =
        fs::read_to_string(&galleries_path).map_err(|e| format!("Failed to read galleries.json: {}", e))?;
    let galleries: Vec<serde_json::Value> =
        serde_json::from_str(&galleries_content).map_err(|e| format!("Failed to parse galleries.json: {}", e))?;

    for gallery in &galleries {
        let slug = match gallery.get("slug").and_then(|v| v.as_str()) {
            Some(s) => s,
            None => continue,
        };

        // Include cover image if referenced and exists
        if let Some(cover) = gallery.get("cover").and_then(|v| v.as_str()) {
            if !cover.is_empty() {
                if let Some(rel) = site_relative_to_workspace_relative(cover) {
                    let cover_path = root.join(rel);
                    if cover_path.exists() && cover_path.is_file() {
                        files.insert(cover_path);
                    }
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
                                        if let Some(rel) = site_relative_to_workspace_relative(path_str) {
                                            let photo_path = root.join(rel);
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
    }

    let mut result: Vec<PathBuf> = files.into_iter().collect();
    result.sort();
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
    prefix: String,
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
    let local_files = collect_referenced_files(&root)?;

    // Ensure prefix ends with /
    let prefix = if prefix.ends_with('/') {
        prefix
    } else {
        format!("{}/", prefix)
    };

    // Build local file map: s3_key -> (local_path, md5)
    let mut local_map: HashMap<String, (PathBuf, String)> = HashMap::new();
    for file_path in &local_files {
        let relative = file_path
            .strip_prefix(&root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        let s3_key = format!("{}{}", prefix, relative);
        let md5 = compute_md5(file_path)?;
        local_map.insert(s3_key, (file_path.clone(), md5));
    }

    // List all S3 objects under prefix
    let mut s3_objects: HashMap<String, String> = HashMap::new(); // key -> etag
    let mut continuation_token: Option<String> = None;
    loop {
        let mut req = s3_client.list_objects_v2().bucket(&bucket).prefix(&prefix);
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

    // Files to delete: in S3 but not local
    let to_delete: Vec<String> = s3_objects
        .keys()
        .filter(|key| key.starts_with(&prefix) && !local_map.contains_key(*key))
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
    // Read prefix from settings for safety check
    let prefix = if settings.s3_prefix.ends_with('/') {
        settings.s3_prefix.clone()
    } else {
        format!("{}/", settings.s3_prefix)
    };

    for s3_key in &plan.to_delete {
        // Safety: only delete keys under configured prefix
        if !s3_key.starts_with(&prefix) {
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

        let invalidation_path = format!("/{}*", prefix);
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
        assert_eq!(content_type_for_extension(Path::new("file.xyz")), "application/octet-stream");
    }

    #[test]
    fn test_is_syncable_file() {
        assert!(is_syncable_file(Path::new("photo.jpg")));
        assert!(is_syncable_file(Path::new("photo.JPEG")));
        assert!(is_syncable_file(Path::new("photo.png")));
        assert!(is_syncable_file(Path::new("data.json")));
        assert!(!is_syncable_file(Path::new(".DS_Store")));
        assert!(!is_syncable_file(Path::new("readme.txt")));
        assert!(!is_syncable_file(Path::new("file.md")));
        assert!(!is_syncable_file(Path::new(".gitignore")));
    }

    #[test]
    fn test_s3_key_construction() {
        let root = PathBuf::from("/workspace/galleries");
        let file = root.join("coastal-sunset/01.jpg");
        let relative = file
            .strip_prefix(&root)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");
        let prefix = "galleries/";
        let s3_key = format!("{}{}", prefix, relative);
        assert_eq!(s3_key, "galleries/coastal-sunset/01.jpg");
    }

    #[test]
    fn test_prefix_safety_check() {
        let prefix = "galleries/";
        let key_in_prefix = "galleries/coastal-sunset/01.jpg";
        let key_outside = "other/file.jpg";
        assert!(key_in_prefix.starts_with(prefix));
        assert!(!key_outside.starts_with(prefix));
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

    // --- site_relative_to_workspace_relative tests ---

    #[test]
    fn test_site_relative_standard_path() {
        assert_eq!(
            site_relative_to_workspace_relative("galleries/coastal-sunset/01.jpg"),
            Some("coastal-sunset/01.jpg")
        );
    }

    #[test]
    fn test_site_relative_nested_path() {
        assert_eq!(
            site_relative_to_workspace_relative("galleries/a/b/c/photo.jpg"),
            Some("a/b/c/photo.jpg")
        );
    }

    #[test]
    fn test_site_relative_no_slash() {
        assert_eq!(site_relative_to_workspace_relative("galleries"), None);
    }

    #[test]
    fn test_site_relative_empty_string() {
        assert_eq!(site_relative_to_workspace_relative(""), None);
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

        // Set up galleries.json with one gallery
        create_file(
            root,
            "galleries.json",
            r#"[{"name":"Sunset","slug":"sunset","date":"Feb 2026","cover":"galleries/sunset/01.jpg"}]"#,
        );

        // Set up gallery-details.json with two photos
        create_file(
            root,
            "sunset/gallery-details.json",
            r#"{"name":"Sunset","slug":"sunset","date":"Feb 2026","description":"","photos":[
                {"thumbnail":"galleries/sunset/01.jpg","full":"galleries/sunset/01.jpg","alt":"01"},
                {"thumbnail":"galleries/sunset/02.jpg","full":"galleries/sunset/02.jpg","alt":"02"}
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
    fn test_collect_referenced_files_empty_galleries() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        create_file(root, "galleries.json", "[]");

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
            r#"[{"name":"Sunset","slug":"sunset","date":"Feb 2026","cover":"galleries/sunset/01.jpg"}]"#,
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
            r#"[{"name":"Sunset","slug":"sunset","date":"Feb 2026","cover":"galleries/sunset/01.jpg"}]"#,
        );
        create_file(
            root,
            "sunset/gallery-details.json",
            r#"{"name":"Sunset","slug":"sunset","date":"Feb 2026","description":"","photos":[
                {"thumbnail":"galleries/sunset/01.jpg","full":"galleries/sunset/01.jpg","alt":"01"}
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
            r#"[{"name":"A","slug":"a","date":"","cover":""}]"#,
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
            r#"[{"name":"Sunset","slug":"sunset","date":"","cover":"galleries/sunset/missing.jpg"}]"#,
        );
        create_file(
            root,
            "sunset/gallery-details.json",
            r#"{"name":"Sunset","slug":"sunset","date":"","description":"","photos":[
                {"thumbnail":"galleries/sunset/missing.jpg","full":"galleries/sunset/missing.jpg","alt":"missing"}
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
            r#"[
                {"name":"A","slug":"a","date":"","cover":"galleries/a/img.jpg"},
                {"name":"B","slug":"b","date":"","cover":"galleries/b/img.jpg"}
            ]"#,
        );
        create_file(
            root,
            "a/gallery-details.json",
            r#"{"name":"A","slug":"a","date":"","description":"","photos":[
                {"thumbnail":"galleries/a/img.jpg","full":"galleries/a/img.jpg","alt":"img"}
            ]}"#,
        );
        create_file(
            root,
            "b/gallery-details.json",
            r#"{"name":"B","slug":"b","date":"","description":"","photos":[
                {"thumbnail":"galleries/b/img.jpg","full":"galleries/b/img.jpg","alt":"img"}
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

    #[test]
    fn test_collect_referenced_files_no_galleries_json() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        let result = collect_referenced_files(root);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("galleries.json not found"));
    }
}
