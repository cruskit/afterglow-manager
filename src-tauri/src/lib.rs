mod publish;
mod settings;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(Mutex::new(publish::PublishState::new()))
        .invoke_handler(tauri::generate_handler![
            open_folder_dialog,
            scan_directory,
            read_json_file,
            write_json_file,
            file_exists,
            get_file_modified_time,
            get_image_uri,
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
