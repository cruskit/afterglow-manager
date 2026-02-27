use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[derive(Debug, Clone)]
pub struct ThumbnailSpec {
    pub source_path: PathBuf,
    pub dest_path: PathBuf,
    /// S3 key, e.g. "galleries/sunset/.thumbs/01.webp"
    pub s3_key: String,
    /// Gallery slug (or cover parent dir) this thumbnail belongs to.
    pub slug: String,
    /// Thumbnail filename, e.g. "01.webp"
    pub thumb_filename: String,
}

pub struct ThumbnailResults {
    pub generated: usize,
    pub skipped: usize,
    pub errors: Vec<(PathBuf, String)>,
}

/// Parse galleries array from either legacy (plain array) or current ({ schemaVersion, galleries })
/// format. Returns an empty Vec on unexpected format.
pub(crate) fn parse_galleries_array(raw: &serde_json::Value) -> Vec<serde_json::Value> {
    if let Some(arr) = raw.as_array() {
        arr.clone()
    } else if let Some(obj) = raw.as_object() {
        obj.get("galleries")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
    } else {
        Vec::new()
    }
}

/// Build thumbnail specs for all referenced images in the workspace.
///
/// Covers the cover images from `galleries.json` and photo thumbnails from each
/// `gallery-details.json`. Deduplicates by dest_path so an image used as both
/// cover and thumbnail is processed only once.
pub fn build_thumbnail_specs(
    root: &Path,
    galleries_json: &serde_json::Value,
    s3_root: &str,
) -> Vec<ThumbnailSpec> {
    let galleries = parse_galleries_array(galleries_json);
    let galleries_prefix = format!("{}galleries/", s3_root);
    let thumb_cache = root.join(".data").join("thumbnails");
    let mut specs = Vec::new();
    let mut seen_dest: HashSet<PathBuf> = HashSet::new();

    for gallery in &galleries {
        let slug = match gallery.get("slug").and_then(|v| v.as_str()) {
            Some(s) => s,
            None => continue,
        };

        // Cover image — path is relative to root, e.g. "sunset/01.jpg"
        if let Some(cover) = gallery.get("cover").and_then(|v| v.as_str()) {
            if !cover.is_empty() {
                let source_path = root.join(cover);
                if source_path.exists() && source_path.is_file() {
                    let cover_path = Path::new(cover);
                    // parent dir of cover path (e.g. "sunset" for "sunset/01.jpg")
                    let cover_dir = cover_path
                        .parent()
                        .map(|p| p.to_string_lossy().into_owned())
                        .unwrap_or_else(|| slug.to_string());
                    if let Some(stem) = cover_path.file_stem().and_then(|s| s.to_str()) {
                        let thumb_filename = format!("{}.webp", stem);
                        let dest_path = thumb_cache.join(&cover_dir).join(&thumb_filename);
                        if seen_dest.insert(dest_path.clone()) {
                            let s3_key = format!(
                                "{}{}/.thumbs/{}",
                                galleries_prefix, cover_dir, thumb_filename
                            );
                            specs.push(ThumbnailSpec {
                                source_path,
                                dest_path,
                                s3_key,
                                slug: cover_dir,
                                thumb_filename,
                            });
                        }
                    }
                }
            }
        }

        // Photo thumbnails from gallery-details.json
        let details_path = root.join(slug).join("gallery-details.json");
        if details_path.exists() {
            if let Ok(dc) = fs::read_to_string(&details_path) {
                if let Ok(dv) = serde_json::from_str::<serde_json::Value>(&dc) {
                    if let Some(photos) = dv.get("photos").and_then(|v| v.as_array()) {
                        for photo in photos {
                            if let Some(thumbnail) =
                                photo.get("thumbnail").and_then(|v| v.as_str())
                            {
                                if !thumbnail.is_empty() {
                                    let source_path = root.join(slug).join(thumbnail);
                                    if source_path.exists() && source_path.is_file() {
                                        let thumb_path = Path::new(thumbnail);
                                        if let Some(stem) =
                                            thumb_path.file_stem().and_then(|s| s.to_str())
                                        {
                                            let thumb_filename = format!("{}.webp", stem);
                                            let dest_path = thumb_cache
                                                .join(slug)
                                                .join(&thumb_filename);
                                            if seen_dest.insert(dest_path.clone()) {
                                                let s3_key = format!(
                                                    "{}{}/.thumbs/{}",
                                                    galleries_prefix, slug, thumb_filename
                                                );
                                                specs.push(ThumbnailSpec {
                                                    source_path,
                                                    dest_path,
                                                    s3_key,
                                                    slug: slug.to_string(),
                                                    thumb_filename,
                                                });
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

    specs
}

/// Returns true if the thumbnail at `dest` is up to date relative to `source`.
/// A thumbnail is fresh when it exists and its mtime ≥ the source's mtime.
pub fn is_thumbnail_fresh(source: &Path, dest: &Path) -> bool {
    if !dest.exists() {
        return false;
    }
    let source_mtime = fs::metadata(source)
        .and_then(|m| m.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH);
    let dest_mtime = fs::metadata(dest)
        .and_then(|m| m.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH);
    dest_mtime >= source_mtime
}

/// Generate a lossy WebP thumbnail from `source` and write it atomically to `dest`.
///
/// Downscales to a maximum of 800 px on the longest side (preserving aspect ratio).
/// Images already within that limit are re-encoded without resizing.
pub fn generate_thumbnail(source: &Path, dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create dir {}: {}", parent.display(), e))?;
    }

    let img = image::open(source)
        .map_err(|e| format!("Failed to open {}: {}", source.display(), e))?;

    let resized = if img.width() > 800 || img.height() > 800 {
        img.resize(800, 800, image::imageops::FilterType::Lanczos3)
    } else {
        img
    };

    let encoder = webp::Encoder::from_image(&resized)
        .map_err(|e| format!("WebP encoder error for {}: {}", source.display(), e))?;
    let webp_data = encoder.encode(85.0);

    // Atomic write: .tmp → rename
    let tmp = dest.with_extension("webp.tmp");
    fs::write(&tmp, &*webp_data)
        .map_err(|e| format!("Failed to write tmp {}: {}", tmp.display(), e))?;
    fs::rename(&tmp, dest)
        .map_err(|e| format!("Failed to rename to {}: {}", dest.display(), e))?;

    Ok(())
}

/// Generate or skip thumbnails for all specs.  Failures are non-fatal and
/// collected in `ThumbnailResults::errors`.
pub fn ensure_thumbnails(specs: &[ThumbnailSpec]) -> ThumbnailResults {
    ensure_thumbnails_with_progress(specs, |_, _, _| {})
}

/// Like `ensure_thumbnails` but calls `on_progress(current_1based, total, spec)` after
/// each spec is processed (whether generated, skipped, or errored).
pub fn ensure_thumbnails_with_progress<F>(specs: &[ThumbnailSpec], on_progress: F) -> ThumbnailResults
where
    F: Fn(usize, usize, &ThumbnailSpec),
{
    let total = specs.len();
    let mut generated = 0;
    let mut skipped = 0;
    let mut errors = Vec::new();

    for (i, spec) in specs.iter().enumerate() {
        if is_thumbnail_fresh(&spec.source_path, &spec.dest_path) {
            skipped += 1;
        } else {
            match generate_thumbnail(&spec.source_path, &spec.dest_path) {
                Ok(()) => generated += 1,
                Err(e) => errors.push((spec.source_path.clone(), e)),
            }
        }
        on_progress(i + 1, total, spec);
    }

    ThumbnailResults { generated, skipped, errors }
}

/// Delete any `.webp` files in `thumbnail_cache_root` that are not listed in `specs`.
/// Also removes now-empty slug subdirectories. Non-fatal — errors are logged via `eprintln!`.
/// Returns the number of files deleted. No-op if the cache directory doesn't exist.
pub fn cleanup_stale_thumbnails(thumbnail_cache_root: &Path, specs: &[ThumbnailSpec]) -> usize {
    if !thumbnail_cache_root.exists() {
        return 0;
    }

    let expected: HashSet<PathBuf> = specs.iter().map(|s| s.dest_path.clone()).collect();
    let mut deleted = 0usize;

    // Pass 1: delete stale .webp files
    let Ok(read_dir) = fs::read_dir(thumbnail_cache_root) else {
        eprintln!("[thumbnails] cleanup: cannot read {:?}", thumbnail_cache_root);
        return 0;
    };
    for entry in read_dir.flatten() {
        let subdir = entry.path();
        if !subdir.is_dir() { continue; }
        let Ok(files) = fs::read_dir(&subdir) else { continue; };
        for file_entry in files.flatten() {
            let file_path = file_entry.path();
            if file_path.extension().and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("webp")).unwrap_or(false)
                && !expected.contains(&file_path)
            {
                match fs::remove_file(&file_path) {
                    Ok(()) => deleted += 1,
                    Err(e) => eprintln!("[thumbnails] cleanup: failed to delete {:?}: {}", file_path, e),
                }
            }
        }
    }

    // Pass 2: remove now-empty slug subdirectories
    if let Ok(read_dir2) = fs::read_dir(thumbnail_cache_root) {
        for entry in read_dir2.flatten() {
            let subdir = entry.path();
            if subdir.is_dir() {
                let is_empty = fs::read_dir(&subdir).map(|mut rd| rd.next().is_none()).unwrap_or(false);
                if is_empty {
                    if let Err(e) = fs::remove_dir(&subdir) {
                        eprintln!("[thumbnails] cleanup: failed to remove empty dir {:?}: {}", subdir, e);
                    }
                }
            }
        }
    }

    if deleted > 0 {
        println!("[thumbnails] cleanup: deleted {} stale cache file(s)", deleted);
    }
    deleted
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_jpeg(path: &Path, width: u32, height: u32) {
        let img = image::RgbImage::new(width, height);
        let dyn_img = image::DynamicImage::ImageRgb8(img);
        let mut file = fs::File::create(path).unwrap();
        dyn_img
            .write_to(&mut file, image::ImageFormat::Jpeg)
            .unwrap();
    }

    #[test]
    fn is_thumbnail_fresh_missing_dest_returns_false() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("src.jpg");
        make_jpeg(&src, 100, 100);
        let dest = tmp.path().join("dest.webp");
        assert!(!is_thumbnail_fresh(&src, &dest));
    }

    #[test]
    fn is_thumbnail_fresh_dest_exists_returns_true() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("src.jpg");
        make_jpeg(&src, 100, 100);
        // Write dest after src so dest mtime >= src mtime
        let dest = tmp.path().join("dest.webp");
        fs::write(&dest, b"dummy").unwrap();
        // Force dest mtime to be at least as new as src
        assert!(is_thumbnail_fresh(&src, &dest));
    }

    #[test]
    fn generate_thumbnail_creates_webp() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("photo.jpg");
        make_jpeg(&src, 200, 150);
        let dest = tmp.path().join("photo.webp");
        generate_thumbnail(&src, &dest).unwrap();
        assert!(dest.exists());
        // Should be decodable as WebP
        let decoded = image::open(&dest).unwrap();
        assert!(decoded.width() <= 200);
        assert!(decoded.height() <= 150);
    }

    #[test]
    fn generate_thumbnail_downscales_large_image() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("large.jpg");
        make_jpeg(&src, 3200, 2400);
        let dest = tmp.path().join("large.webp");
        generate_thumbnail(&src, &dest).unwrap();
        let decoded = image::open(&dest).unwrap();
        assert!(decoded.width() <= 800);
        assert!(decoded.height() <= 800);
    }

    #[test]
    fn generate_thumbnail_preserves_aspect_ratio() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("wide.jpg");
        // 4:3 aspect ratio, larger than 800
        make_jpeg(&src, 3200, 2400);
        let dest = tmp.path().join("wide.webp");
        generate_thumbnail(&src, &dest).unwrap();
        let decoded = image::open(&dest).unwrap();
        // Longest side capped at 800, other side scaled proportionally
        assert_eq!(decoded.width(), 800);
        assert_eq!(decoded.height(), 600);
    }

    #[test]
    fn build_thumbnail_specs_empty_galleries() {
        let tmp = TempDir::new().unwrap();
        let raw = serde_json::json!({ "schemaVersion": 1, "galleries": [] });
        let specs = build_thumbnail_specs(tmp.path(), &raw, "");
        assert!(specs.is_empty());
    }

    #[test]
    fn build_thumbnail_specs_cover_and_photo() {
        let tmp = TempDir::new().unwrap();
        let gallery_dir = tmp.path().join("sunset");
        fs::create_dir_all(&gallery_dir).unwrap();

        // Create source files
        make_jpeg(&gallery_dir.join("cover.jpg"), 100, 100);
        make_jpeg(&gallery_dir.join("photo.jpg"), 100, 100);

        // Write gallery-details.json
        let details = serde_json::json!({
            "schemaVersion": 1, "name": "Sunset", "slug": "sunset",
            "date": "2024-01-01", "description": "",
            "photos": [{ "thumbnail": "photo.jpg", "full": "photo.jpg", "alt": "" }]
        });
        fs::write(
            gallery_dir.join("gallery-details.json"),
            serde_json::to_string_pretty(&details).unwrap(),
        ).unwrap();

        let raw = serde_json::json!({
            "schemaVersion": 1,
            "galleries": [{ "name": "Sunset", "slug": "sunset", "date": "2024-01-01", "cover": "sunset/cover.jpg" }]
        });
        let specs = build_thumbnail_specs(tmp.path(), &raw, "");

        // cover.jpg and photo.jpg are different → 2 specs
        assert_eq!(specs.len(), 2);
        // cover spec
        let cover_spec = specs.iter().find(|s| s.source_path.ends_with("cover.jpg")).unwrap();
        assert_eq!(cover_spec.s3_key, "galleries/sunset/.thumbs/cover.webp");
        assert_eq!(cover_spec.thumb_filename, "cover.webp");
        // photo spec
        let photo_spec = specs.iter().find(|s| s.source_path.ends_with("photo.jpg")).unwrap();
        assert_eq!(photo_spec.s3_key, "galleries/sunset/.thumbs/photo.webp");
    }

    #[test]
    fn build_thumbnail_specs_deduplicates_same_image() {
        let tmp = TempDir::new().unwrap();
        let gallery_dir = tmp.path().join("beach");
        fs::create_dir_all(&gallery_dir).unwrap();

        make_jpeg(&gallery_dir.join("01.jpg"), 100, 100);

        // Write gallery-details.json where the cover and thumbnail are the same file
        let details = serde_json::json!({
            "schemaVersion": 1, "name": "Beach", "slug": "beach",
            "date": "2024-01-01", "description": "",
            "photos": [{ "thumbnail": "01.jpg", "full": "01.jpg", "alt": "" }]
        });
        fs::write(
            gallery_dir.join("gallery-details.json"),
            serde_json::to_string_pretty(&details).unwrap(),
        ).unwrap();

        let raw = serde_json::json!({
            "schemaVersion": 1,
            "galleries": [{ "name": "Beach", "slug": "beach", "date": "2024-01-01", "cover": "beach/01.jpg" }]
        });
        let specs = build_thumbnail_specs(tmp.path(), &raw, "");
        // Same image → deduplicated to 1 spec
        assert_eq!(specs.len(), 1);
    }

    #[test]
    fn ensure_thumbnails_generates_missing() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("src.jpg");
        make_jpeg(&src, 100, 100);
        let dest = tmp.path().join("thumbs").join("src.webp");
        let specs = vec![ThumbnailSpec {
            source_path: src,
            dest_path: dest.clone(),
            s3_key: "galleries/test/.thumbs/src.webp".to_string(),
            slug: "test".to_string(),
            thumb_filename: "src.webp".to_string(),
        }];
        let results = ensure_thumbnails(&specs);
        assert_eq!(results.generated, 1);
        assert_eq!(results.skipped, 0);
        assert!(results.errors.is_empty());
        assert!(dest.exists());
    }

    #[test]
    fn ensure_thumbnails_skips_fresh() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("src.jpg");
        make_jpeg(&src, 100, 100);
        let dest = tmp.path().join("src.webp");
        // Write dest so it's fresh
        fs::write(&dest, b"dummy").unwrap();

        let specs = vec![ThumbnailSpec {
            source_path: src,
            dest_path: dest,
            s3_key: "galleries/test/.thumbs/src.webp".to_string(),
            slug: "test".to_string(),
            thumb_filename: "src.webp".to_string(),
        }];
        let results = ensure_thumbnails(&specs);
        assert_eq!(results.generated, 0);
        assert_eq!(results.skipped, 1);
    }

    #[test]
    fn cleanup_stale_thumbnails_no_op_when_cache_missing() {
        let tmp = TempDir::new().unwrap();
        let cache = tmp.path().join("does_not_exist");
        let deleted = cleanup_stale_thumbnails(&cache, &[]);
        assert_eq!(deleted, 0);
    }

    #[test]
    fn cleanup_stale_thumbnails_removes_stale_keeps_expected() {
        let tmp = TempDir::new().unwrap();
        let cache = tmp.path().join("thumbnails");
        let slug_dir = cache.join("sunset");
        fs::create_dir_all(&slug_dir).unwrap();

        let stale = slug_dir.join("stale.webp");
        let kept = slug_dir.join("kept.webp");
        fs::write(&stale, b"stale").unwrap();
        fs::write(&kept, b"kept").unwrap();

        let specs = vec![ThumbnailSpec {
            source_path: tmp.path().join("sunset").join("kept.jpg"),
            dest_path: kept.clone(),
            s3_key: "galleries/sunset/.thumbs/kept.webp".to_string(),
            slug: "sunset".to_string(),
            thumb_filename: "kept.webp".to_string(),
        }];

        let deleted = cleanup_stale_thumbnails(&cache, &specs);
        assert_eq!(deleted, 1);
        assert!(!stale.exists());
        assert!(kept.exists());
    }

    #[test]
    fn cleanup_stale_thumbnails_removes_empty_subdir() {
        let tmp = TempDir::new().unwrap();
        let cache = tmp.path().join("thumbnails");
        let slug_dir = cache.join("old_gallery");
        fs::create_dir_all(&slug_dir).unwrap();
        // Put a stale file so pass 1 deletes it, leaving the dir empty
        let stale = slug_dir.join("photo.webp");
        fs::write(&stale, b"x").unwrap();

        let deleted = cleanup_stale_thumbnails(&cache, &[]);
        assert_eq!(deleted, 1);
        assert!(!slug_dir.exists());
    }
}
