// galleries.json entry
export interface GalleryEntry {
  name: string;
  slug: string;
  date: string;
  cover: string;
}

export type GalleriesJson = GalleryEntry[];

// File-level types (with schema version wrapper)
export interface GalleriesFile {
  schemaVersion: number;
  galleries: GalleryEntry[];
}

export interface GalleryDetailsFile {
  schemaVersion: number;
  name: string;
  slug: string;
  date: string;
  description: string;
  photos: PhotoEntry[];
}

// gallery-details.json photo entry
export interface PhotoEntry {
  thumbnail: string;
  full: string;
  alt: string;
}

// gallery-details.json root
export interface GalleryDetails {
  name: string;
  slug: string;
  date: string;
  description: string;
  photos: PhotoEntry[];
}

// Rust backend types
export interface DirListing {
  directories: string[];
  images: string[];
}

// Workspace state
export type ViewMode = "welcome" | "galleries" | "gallery-detail";

export interface WorkspaceState {
  folderPath: string | null;
  folderName: string;
  galleries: GalleriesJson;
  galleriesLastModified: number | null;
  selectedTreeNode: string | null; // null = root, string = subdirectory name
  selectedGalleryIndex: number | null;
  selectedImageIndex: number | null;
  galleryDetails: GalleryDetails | null;
  galleryDetailsLastModified: number | null;
  subdirectories: string[];
  currentDirImages: string[];
  viewMode: ViewMode;
  error: string | null;
}

// Settings & Publishing types
export interface AppSettings {
  bucket: string;
  region: string;
  /** S3 site root prefix (e.g. "" for bucket root, "my-site/" for subdirectory).
   *  Gallery files are published under {s3Prefix}galleries/ automatically. */
  s3Prefix: string;
  lastValidatedUser: string;
  lastValidatedAccount: string;
  lastValidatedArn: string;
  cloudFrontDistributionId: string;
  schemaVersion: number;
}

export interface ValidationResult {
  user: string;
  account: string;
  arn: string;
}

export interface SyncFile {
  localPath: string;
  s3Key: string;
  sizeBytes: number;
  contentType: string;
}

export interface PublishPlan {
  planId: string;
  toUpload: SyncFile[];
  toDelete: string[];
  unchanged: number;
  totalFiles: number;
}

export interface PublishProgress {
  current: number;
  total: number;
  file: string;
  action: "upload" | "delete" | "invalidate";
}

export interface PublishResult {
  uploaded: number;
  deleted: number;
  unchanged: number;
}

export interface PublishError {
  error: string;
  file: string;
}

export type WorkspaceAction =
  | { type: "SET_FOLDER"; path: string; name: string }
  | { type: "SET_GALLERIES"; galleries: GalleriesJson; lastModified: number | null }
  | { type: "SET_SUBDIRECTORIES"; subdirectories: string[] }
  | { type: "SELECT_TREE_NODE"; node: string | null }
  | { type: "SELECT_GALLERY"; index: number | null }
  | { type: "SELECT_IMAGE"; index: number | null }
  | { type: "UPDATE_GALLERY"; index: number; entry: Partial<GalleryEntry> }
  | { type: "DELETE_GALLERY"; index: number }
  | { type: "ADD_GALLERY"; entry: GalleryEntry }
  | { type: "REORDER_GALLERIES"; fromIndex: number; toIndex: number }
  | { type: "SET_GALLERY_DETAILS"; details: GalleryDetails; lastModified: number | null }
  | { type: "UPDATE_GALLERY_DETAILS_HEADER"; updates: Partial<Omit<GalleryDetails, "photos">> }
  | { type: "UPDATE_PHOTO"; index: number; entry: Partial<PhotoEntry> }
  | { type: "DELETE_PHOTO"; index: number }
  | { type: "ADD_PHOTO"; entry: PhotoEntry }
  | { type: "ADD_PHOTOS"; entries: PhotoEntry[] }
  | { type: "REORDER_PHOTOS"; fromIndex: number; toIndex: number }
  | { type: "SET_DIR_IMAGES"; images: string[] }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "RESET" };
