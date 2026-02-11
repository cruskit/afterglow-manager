import { invoke } from "@tauri-apps/api/core";
import type { DirListing } from "./types";

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
