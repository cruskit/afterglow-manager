mod publish;
mod settings;
mod thumbnails;

use notify_debouncer_mini::Debouncer;
use notify_debouncer_mini::notify::RecommendedWatcher;
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

pub struct WatcherState(pub Mutex<Option<Debouncer<RecommendedWatcher>>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FsChangeEvent {
    kind: String,
    gallery_slug: Option<String>,
    filename: Option<String>,
}

fn classify_fs_event(path: &Path, workspace: &Path) -> Option<FsChangeEvent> {
    let rel = path.strip_prefix(workspace).ok()?;
    let components: Vec<_> = rel.components().collect();

    // Skip empty paths
    if components.is_empty() {
        return None;
    }

    // Skip any path with a hidden component
    for comp in &components {
        if let std::path::Component::Normal(name) = comp {
            if name.to_string_lossy().starts_with('.') {
                return None;
            }
        }
    }

    match components.len() {
        1 => {
            if let std::path::Component::Normal(n) = components[0] {
                let name = n.to_string_lossy();
                // Skip json files at root level (e.g. galleries.json)
                if name.ends_with(".json") {
                    return None;
                }
                let slug = name.to_string();
                if path.exists() {
                    if path.is_dir() {
                        Some(FsChangeEvent {
                            kind: "dir-created".to_string(),
                            gallery_slug: Some(slug),
                            filename: None,
                        })
                    } else {
                        None // file at workspace root, not a gallery dir
                    }
                } else {
                    Some(FsChangeEvent {
                        kind: "dir-removed".to_string(),
                        gallery_slug: Some(slug),
                        filename: None,
                    })
                }
            } else {
                None
            }
        }
        2 => {
            if let (
                std::path::Component::Normal(slug_os),
                std::path::Component::Normal(file_os),
            ) = (components[0], components[1])
            {
                let filename = file_os.to_string_lossy().to_string();
                // Skip json files
                if filename.ends_with(".json") {
                    return None;
                }
                // Must be an image
                if !is_image_file(path) {
                    return None;
                }
                let slug = slug_os.to_string_lossy().to_string();
                let kind = if path.exists() {
                    "image-created".to_string()
                } else {
                    "image-removed".to_string()
                };
                Some(FsChangeEvent {
                    kind,
                    gallery_slug: Some(slug),
                    filename: Some(filename),
                })
            } else {
                None
            }
        }
        _ => None,
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DirListing {
    pub directories: Vec<String>,
    pub images: Vec<String>,
}

const IMAGE_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "tiff", "tif",
];

fn is_image_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| IMAGE_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

#[tauri::command]
async fn open_folder_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app
        .dialog()
        .file()
        .blocking_pick_folder();
    Ok(folder.map(|p| p.to_string()))
}

#[tauri::command]
async fn scan_directory(path: String) -> Result<DirListing, String> {
    let dir_path = PathBuf::from(&path);
    if !dir_path.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    let mut directories = Vec::new();
    let mut images = Vec::new();

    let entries = fs::read_dir(&dir_path).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files/dirs
        if name.starts_with('.') {
            continue;
        }

        if file_type.is_dir() {
            directories.push(name);
        } else if file_type.is_file() && is_image_file(&entry.path()) {
            images.push(name);
        }
    }

    directories.sort();
    images.sort();

    Ok(DirListing { directories, images })
}

#[tauri::command]
async fn read_json_file(path: String) -> Result<serde_json::Value, String> {
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(value)
}

#[tauri::command]
async fn write_json_file(path: String, data: serde_json::Value) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let parent = target.parent().ok_or("No parent directory")?;

    // Ensure parent directory exists
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;

    // Atomic write: write to temp file, then rename
    let temp_path = parent.join(format!(
        ".{}.tmp",
        target
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
    ));

    let json_string = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(&temp_path, &json_string).map_err(|e| e.to_string())?;
    fs::rename(&temp_path, &target).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn file_exists(path: String) -> Result<bool, String> {
    Ok(PathBuf::from(&path).exists())
}

#[tauri::command]
async fn get_file_modified_time(path: String) -> Result<u64, String> {
    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
    let modified = metadata
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_err(|e| e.to_string())?;
    Ok(modified.as_secs())
}

#[tauri::command]
async fn get_image_uri(abs_path: String) -> Result<String, String> {
    let path = PathBuf::from(&abs_path);
    if !path.exists() {
        return Err(format!("Image not found: {}", abs_path));
    }
    // Return the absolute path; frontend uses convertFileSrc() to create asset URI
    Ok(abs_path)
}

#[tauri::command]
async fn get_all_tags(workspace_path: String) -> Result<Vec<String>, String> {
    use std::collections::HashSet;
    let root = PathBuf::from(&workspace_path);
    let mut tags: HashSet<String> = HashSet::new();

    // Read gallery-level tags from galleries.json
    let galleries_path = root.join("galleries.json");
    if galleries_path.exists() {
        let content = fs::read_to_string(&galleries_path).map_err(|e| e.to_string())?;
        let raw: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        let galleries = if let Some(arr) = raw.as_array() {
            arr.clone()
        } else if let Some(obj) = raw.as_object() {
            obj.get("galleries")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default()
        } else {
            Vec::new()
        };

        for gallery in &galleries {
            if let Some(tag_arr) = gallery.get("tags").and_then(|v| v.as_array()) {
                for t in tag_arr {
                    if let Some(s) = t.as_str() {
                        tags.insert(s.to_string());
                    }
                }
            }

            // Read photo-level tags from each gallery-details.json
            let slug = match gallery.get("slug").and_then(|v| v.as_str()) {
                Some(s) => s,
                None => continue,
            };
            let details_path = root.join(slug).join("gallery-details.json");
            if !details_path.exists() {
                continue;
            }
            if let Ok(dc) = fs::read_to_string(&details_path) {
                if let Ok(dv) = serde_json::from_str::<serde_json::Value>(&dc) {
                    if let Some(photos) = dv.get("photos").and_then(|v| v.as_array()) {
                        for photo in photos {
                            if let Some(tag_arr) = photo.get("tags").and_then(|v| v.as_array()) {
                                for t in tag_arr {
                                    if let Some(s) = t.as_str() {
                                        tags.insert(s.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let mut result: Vec<String> = tags.into_iter().collect();
    result.sort();
    Ok(result)
}

#[tauri::command]
async fn start_watching(
    workspace_path: String,
    app: tauri::AppHandle,
    watcher_state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    use notify_debouncer_mini::notify::RecursiveMode;
    use std::time::Duration;

    let workspace = PathBuf::from(&workspace_path);
    let workspace_for_closure = workspace.clone();
    let app_handle = app.clone();

    let mut debouncer = notify_debouncer_mini::new_debouncer(
        Duration::from_millis(500),
        move |result: notify_debouncer_mini::DebounceEventResult| {
            if let Ok(events) = result {
                for event in events {
                    if let Some(payload) = classify_fs_event(&event.path, &workspace_for_closure) {
                        let _ = app_handle.emit("workspace-fs-change", payload);
                    }
                }
            }
        },
    )
    .map_err(|e| e.to_string())?;

    debouncer
        .watcher()
        .watch(&workspace, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    *watcher_state.0.lock().unwrap() = Some(debouncer);
    Ok(())
}

#[tauri::command]
async fn stop_watching(watcher_state: tauri::State<'_, WatcherState>) -> Result<(), String> {
    *watcher_state.0.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
async fn remove_photo_from_gallery_details(
    workspace_path: String,
    slug: String,
    filename: String,
) -> Result<(), String> {
    let path = PathBuf::from(&workspace_path)
        .join(&slug)
        .join("gallery-details.json");

    if !path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut value: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;

    if let Some(photos) = value.get_mut("photos").and_then(|p| p.as_array_mut()) {
        photos.retain(|photo| {
            let thumb = photo.get("thumbnail").and_then(|v| v.as_str()).unwrap_or("");
            let full = photo.get("full").and_then(|v| v.as_str()).unwrap_or("");
            !thumb.ends_with(&*filename) && !full.ends_with(&*filename)
        });
    }

    let parent = path.parent().ok_or("No parent directory")?;
    let temp_path = parent.join(format!(
        ".{}.tmp",
        path.file_name().unwrap_or_default().to_string_lossy()
    ));
    let json_string = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    fs::write(&temp_path, &json_string).map_err(|e| e.to_string())?;
    fs::rename(&temp_path, &path).map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(Mutex::new(publish::PublishState::new()))
        .manage(WatcherState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            open_folder_dialog,
            scan_directory,
            read_json_file,
            write_json_file,
            file_exists,
            get_file_modified_time,
            get_image_uri,
            get_all_tags,
            start_watching,
            stop_watching,
            remove_photo_from_gallery_details,
            settings::load_settings,
            settings::save_settings,
            settings::save_credentials,
            settings::has_credentials,
            settings::get_credential_hint,
            settings::delete_credentials,
            settings::validate_credentials,
            publish::publish_preview,
            publish::publish_execute,
            publish::publish_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
