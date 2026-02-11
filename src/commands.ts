import { invoke } from "@tauri-apps/api/core";
import type { DirListing, AppSettings, ValidationResult, PublishPlan } from "./types";

export async function openFolderDialog(): Promise<string | null> {
  return invoke<string | null>("open_folder_dialog");
}

export async function scanDirectory(path: string): Promise<DirListing> {
  return invoke<DirListing>("scan_directory", { path });
}

export async function readJsonFile(path: string): Promise<unknown> {
  return invoke("read_json_file", { path });
}

export async function writeJsonFile(path: string, data: unknown): Promise<void> {
  return invoke("write_json_file", { path, data });
}

export async function fileExists(path: string): Promise<boolean> {
  return invoke<boolean>("file_exists", { path });
}

export async function getFileModifiedTime(path: string): Promise<number> {
  return invoke<number>("get_file_modified_time", { path });
}

// Settings commands
export async function loadSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("load_settings");
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  return invoke("save_settings", { settings });
}

export async function saveCredentials(keyId: string, secret: string): Promise<void> {
  return invoke("save_credentials", { keyId, secret });
}

export async function hasCredentials(): Promise<boolean> {
  return invoke<boolean>("has_credentials");
}

export async function getCredentialHint(): Promise<string | null> {
  return invoke<string | null>("get_credential_hint");
}

export async function deleteCredentials(): Promise<void> {
  return invoke("delete_credentials");
}

export async function validateCredentials(
  keyId: string,
  secret: string,
  bucket: string,
  region: string
): Promise<ValidationResult> {
  return invoke<ValidationResult>("validate_credentials", { keyId, secret, bucket, region });
}

// Publish commands
export async function publishPreview(
  folderPath: string,
  bucket: string,
  region: string,
  prefix: string
): Promise<PublishPlan> {
  return invoke<PublishPlan>("publish_preview", { folderPath, bucket, region, prefix });
}

export async function publishExecute(planId: string): Promise<void> {
  return invoke("publish_execute", { planId });
}

export async function publishCancel(planId: string): Promise<void> {
  return invoke("publish_cancel", { planId });
}
