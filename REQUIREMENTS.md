# AfterGlowManager -- Requirements Document

**Version:** 1.0.0-draft
**Date:** 2026-02-10
**Status:** Pre-implementation

---

## 1. Overview and Purpose

AfterGlowManager is a cross-platform desktop application for visually managing the JSON metadata that powers AfterGlow, a static photo gallery website. AfterGlow renders galleries from structured JSON files; AfterGlowManager provides a graphical interface for creating, editing, and organizing those files without hand-editing JSON.

### Problem Statement

Maintaining gallery metadata by hand is tedious and error-prone. Users must keep `galleries.json` and per-gallery `gallery-details.json` files in sync with the actual image files on disk. AfterGlowManager eliminates this friction by presenting the metadata visually, detecting untracked images and galleries automatically, and writing valid JSON on every edit.

### Target Users

Photographers and site maintainers who publish galleries through AfterGlow and need a fast, reliable way to manage gallery metadata on their local machine before deploying.

### Design Principles

- **What you see is what AfterGlow renders.** Tile previews in the manager mirror AfterGlow's dark-themed tile layout so users can judge appearance before publishing.
- **Non-destructive.** The app never deletes image files from disk. Delete operations only remove entries from JSON.
- **Auto-save.** Edits persist on field blur with no explicit save button. The user never loses work.
- **Convention over configuration.** Sensible defaults are generated for every new entry so the user can add a gallery or image with a single click.

---

## 2. Technical Architecture

### Stack

| Layer | Technology | Role |
|-------|-----------|------|
| Native shell | Tauri 2.x (Rust) | Window management, filesystem access, native dialogs |
| Frontend framework | React 18+ | UI rendering, state management |
| Language | TypeScript (strict mode) | Type safety across frontend |
| Component library | Shadcn/ui | Accessible, composable primitives |
| Styling | Tailwind CSS 3+ | Utility-first styling, AfterGlow theme tokens |
| Build tooling | Vite | Frontend bundling for Tauri |

### Target Platforms

- macOS (Apple Silicon and Intel)
- Windows 10/11 (x86_64)

### Architecture Diagram

```
┌──────────────────────────────────────────────────────┐
│                    Tauri Shell                        │
│  ┌────────────────────┐  ┌────────────────────────┐  │
│  │   Rust Backend     │  │   React Frontend       │  │
│  │                    │  │                        │  │
│  │  - FS read/write   │◄─┤  - Tree view           │  │
│  │  - Directory scan  │  │  - Galleries view      │  │
│  │  - JSON parse/     │─►│  - Gallery detail view │  │
│  │    serialize       │  │  - Info pane + forms   │  │
│  │  - Image path      │  │  - Tile grid previews  │  │
│  │    resolution      │  │                        │  │
│  │  - Native dialogs  │  │  Shadcn/ui + Tailwind  │  │
│  └────────────────────┘  └────────────────────────┘  │
│              ▲                       ▲                │
│              │    Tauri IPC          │                │
│              └───────────────────────┘                │
└──────────────────────────────────────────────────────┘
               │
               ▼
    ┌─────────────────────┐
    │   Local Filesystem  │
    │                     │
    │  galleries/         │
    │  ├─ galleries.json  │
    │  ├─ coastal-sunset/ │
    │  │  ├─ gallery-     │
    │  │  │  details.json │
    │  │  ├─ 01.jpg       │
    │  │  └─ 02.jpg       │
    │  └─ mountain-dawn/  │
    │     ├─ gallery-     │
    │     │  details.json │
    │     ├─ 01.jpg       │
    │     └─ 02.jpg       │
    └─────────────────────┘
```

### Tauri Command Surface (Rust Backend)

The Rust backend exposes the following IPC commands to the frontend:

| Command | Input | Output | Description |
|---------|-------|--------|-------------|
| `open_folder_dialog` | none | `Option<String>` | Native folder picker; returns absolute path |
| `scan_directory` | `path: String` | `DirListing` | Returns subdirectories and image files |
| `read_json_file` | `path: String` | `serde_json::Value` | Read and parse a JSON file |
| `write_json_file` | `path: String, data: Value` | `Result<()>` | Atomically write JSON (write to temp, then rename) |
| `file_exists` | `path: String` | `bool` | Check if a file exists |
| `get_image_uri` | `abs_path: String` | `String` | Convert absolute image path to `asset://` URI for display |

### Frontend State Architecture

State management uses React context plus `useReducer` for the workspace, avoiding external state libraries for this scope:

- **WorkspaceContext** -- holds the opened folder path, `galleries.json` data, the currently selected tree node, and the currently selected item within a view.
- All mutations flow through reducer actions that trigger corresponding Tauri IPC write commands.
- Optimistic UI: the frontend updates state immediately, then writes to disk. On write failure, state rolls back and a toast notification appears.

---

## 3. Data Model

### 3.1 `galleries.json`

**Location:** Root of the opened folder (e.g., `galleries/galleries.json`).
**Structure:** JSON array at root.

```typescript
interface GalleryEntry {
  name: string;   // Display name shown on tile and in AfterGlow
  slug: string;   // Subdirectory name; matches folder on disk
  date: string;   // Human-readable date string (e.g., "February 2026")
  cover: string;  // Relative path from site root to cover image
}

type GalleriesJson = GalleryEntry[];
```

### 3.2 `gallery-details.json`

**Location:** Inside each gallery subfolder (e.g., `galleries/coastal-sunset/gallery-details.json`).
**Structure:** JSON object at root.

```typescript
interface PhotoEntry {
  thumbnail: string;  // Relative path from site root to thumbnail image
  full: string;       // Relative path from site root to full-size image
  alt: string;        // Alt text for accessibility
}

interface GalleryDetails {
  name: string;         // Display name
  slug: string;         // Folder name
  date: string;         // Human-readable date
  description: string;  // Gallery description (may be empty string)
  photos: PhotoEntry[];
}
```

### 3.3 Supported Image Extensions

The application recognizes files with the following extensions as images (case-insensitive): `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.avif`, `.bmp`, `.tiff`, `.tif`.

---

## 4. Functional Requirements

### 4.1 Application Shell

**FR-SHELL-01: Folder Opening**
- On launch the app shows a centered welcome screen with an "Open Folder" button.
- Clicking triggers the native OS folder picker dialog via Tauri.
- The selected folder becomes the workspace root. Its name appears as the tree root.
- The app reads or creates `galleries.json` in the root.

**FR-SHELL-02: Tree View Sidebar**
- Fixed-width left sidebar (240px default) displays the folder tree.
- Root node: the opened folder name (e.g., "galleries").
- Child nodes: each immediate subdirectory of the root, sorted alphabetically.
- Files and nested subdirectories are not shown.
- Clicking root node navigates to the Galleries View.
- Clicking a subdirectory node navigates to the Gallery Detail View for that folder.
- The currently active node is visually highlighted.

**FR-SHELL-03: No File Menu Save**
- There is no File > Save command. All edits are persisted automatically (see Section 5).

### 4.2 Galleries View

Displayed when the root node is selected in the tree.

**FR-GAL-01: Data Source**
- Reads `galleries.json` from the workspace root.
- If the file does not exist, creates it with an empty array `[]`.
- If the file exists but is not valid JSON or not an array, shows an error banner with the parse error and a "Reset to empty" action.

**FR-GAL-02: Tile Grid (left region)**
- Displays one tile per entry in `galleries.json`.
- Tiles are rendered in the order they appear in the JSON array.
- Each tile shows:
  - Cover image (loaded from the `cover` path resolved against the workspace root's parent directory)
  - Gallery name overlaid at the bottom-left
  - Date overlaid at the bottom-right
- Tiles follow AfterGlow's visual styling (see Section 4.5).
- Clicking a tile selects that gallery (populates the info pane). It does NOT navigate to the gallery detail view.
- Double-clicking a tile navigates to the Gallery Detail View (equivalent to clicking the subdirectory in the tree).
- If the cover image cannot be loaded, display a placeholder with the gallery name in text.

**FR-GAL-03: Info Pane -- No Selection State**
- When no gallery tile is selected, the info pane shows the text: "Select a gallery to view details."

**FR-GAL-04: Info Pane -- Gallery Selected**
- Displays editable fields:
  - **Name** -- text input, pre-filled with `name`. Required; cannot be blank.
  - **Date** -- text input, pre-filled with `date`. Free-form text (not a date picker).
  - **Cover** -- text input showing the `cover` path. Below it, a small image preview of the cover.
- Displays read-only field:
  - **Slug** -- displayed as plain text (not editable because it corresponds to the directory name).
- Displays a "Delete Gallery" button (destructive styling).
  - Clicking shows a confirmation dialog: "Remove {name} from galleries.json? This will not delete files from disk."
  - On confirm: removes the entry from `galleries.json`, writes to disk, clears selection.

**FR-GAL-05: Untracked Galleries List (below info pane)**
- Scans subdirectories of the workspace root.
- Filters out any subdirectory whose name matches a `slug` already in `galleries.json`.
- Remaining directories are listed under the heading "Untracked Galleries".
- Each entry shows the directory name and an "Add" button.
- If the list is empty, shows: "All subdirectories are tracked."

**FR-GAL-06: Adding an Untracked Gallery**
- Clicking "Add" on an untracked directory:
  1. Creates a new `GalleryEntry` with default values (see Section 6).
  2. Appends the entry to the `galleries.json` array.
  3. Writes `galleries.json` to disk.
  4. If `gallery-details.json` does not exist in the subdirectory, creates it with default values (see Section 6), including a `photos` array populated with all recognized images in that subdirectory.
  5. Selects the newly added gallery in the tile grid.
  6. Focuses the Name field in the info pane so the user can immediately rename.

### 4.3 Gallery Detail View

Displayed when a subdirectory node is selected in the tree.

**FR-DET-01: Data Source**
- Reads `gallery-details.json` from the selected subdirectory.
- If the file does not exist, auto-creates it with all images in the directory (see Section 6).
- If the file exists but is invalid JSON, shows an error banner with "Reset to default" action.

**FR-DET-02: Gallery Header**
- At the top of the view, display the gallery name, date, and description as editable fields.
- Changes auto-save on blur to `gallery-details.json`.
- The slug is displayed as read-only text.

**FR-DET-03: Image Tile Grid (left region)**
- Displays one tile per entry in the `photos` array of `gallery-details.json`.
- Tiles are rendered in JSON array order.
- Each tile shows:
  - The image (loaded from the `full` path, since thumbnail = full for now).
  - The `alt` text overlaid at the bottom.
- Tiles use a 3:2 aspect ratio with `object-fit: cover`.
- Clicking a tile selects that image (populates the info pane).

**FR-DET-04: Info Pane -- No Selection State**
- When no image tile is selected, the info pane shows: "Select an image to view details."

**FR-DET-05: Info Pane -- Image Selected**
- Displays editable fields:
  - **Alt Text** -- text input, pre-filled with `alt`.
  - **Full Image Path** -- text input showing the `full` path.
- The `thumbnail` field is NOT displayed (it mirrors `full` for now).
- Below the fields, a larger preview of the selected image is shown.
- Displays a "Remove Image" button (destructive styling).
  - Clicking shows a confirmation dialog: "Remove this image from the gallery metadata? The file will remain on disk."
  - On confirm: removes the photo entry from the `photos` array, writes `gallery-details.json`, clears selection.

**FR-DET-06: Untracked Images List (below info pane)**
- Scans the subdirectory for recognized image files (see Section 3.3).
- Filters out any image whose filename matches the filename portion of any `full` path in the `photos` array.
- Remaining images are listed under "Untracked Images".
- Each entry shows the filename and an "Add" button.
- An "Add All" button appears at the top of the list when there is more than one untracked image.
- If the list is empty, shows: "All images are tracked."

**FR-DET-07: Adding a Single Untracked Image**
- Clicking "Add" on an untracked image:
  1. Creates a new `PhotoEntry` with default values (see Section 6).
  2. Appends it to the `photos` array.
  3. Writes `gallery-details.json` to disk.
  4. Selects the new image in the tile grid.
  5. Focuses the Alt Text field in the info pane.

**FR-DET-08: Adding All Untracked Images**
- Clicking "Add All":
  1. For each untracked image, creates a `PhotoEntry` with defaults.
  2. Appends all new entries to the `photos` array (sorted alphabetically by filename).
  3. Writes `gallery-details.json` to disk once.
  4. Selects the first newly added image.

### 4.4 Drag-and-Drop Reordering

**FR-DND-01: Gallery Tile Reorder**
- In the Galleries View, tiles can be reordered via drag-and-drop.
- Reordering changes the position in the `galleries.json` array and auto-saves.

**FR-DND-02: Image Tile Reorder**
- In the Gallery Detail View, image tiles can be reordered via drag-and-drop.
- Reordering changes the position in the `photos` array and auto-saves.

### 4.5 AfterGlow Tile Styling

All tile previews in the manager replicate AfterGlow's visual language:

| Token | Value |
|-------|-------|
| Background | `#0e0e0e` |
| Surface / tile bg | `#1a1a1a` |
| Primary text | `#e8e8e8` |
| Accent (gold) | `#c9a84c` |
| Tile aspect ratio | 3:2 |
| Tile border radius | 8px |
| Tile hover | Translate Y -4px, subtle shadow increase |
| Grid layout | `repeat(auto-fill, minmax(300px, 1fr))` |
| Name overlay | Bottom-left, semi-transparent dark gradient band |
| Date overlay | Bottom-right, same gradient band |

The tile grid area uses the dark AfterGlow background so the preview feels authentic. The rest of the application (info pane, tree view, toolbar) uses the system-native Shadcn/ui theme (light or dark, following OS preference).

---

## 5. Auto-Save Behavior

**FR-SAVE-01: Trigger**
- Auto-save fires on the `blur` event of any editable text field.
- Auto-save also fires on drag-and-drop reorder completion.
- Auto-save also fires immediately on Add and Delete operations.

**FR-SAVE-02: Debounce**
- If multiple fields blur in rapid succession (e.g., tabbing through fields), writes are debounced with a 300ms trailing delay so that only one disk write occurs.

**FR-SAVE-03: Atomic Write**
- The Rust backend writes to a temporary file in the same directory, then performs an atomic rename. This prevents data corruption if the process is interrupted.

**FR-SAVE-04: Write Failure Handling**
- On write failure, the frontend reverts the in-memory state to the last known good state.
- A toast notification appears: "Failed to save {filename}: {error message}."
- The toast includes a "Retry" action.

**FR-SAVE-05: Concurrent Edit Guard**
- Before writing, the backend checks the file's last-modified timestamp against the timestamp recorded at last read.
- If the file was modified externally, the app prompts: "This file was modified outside AfterGlowManager. Overwrite with your changes or reload from disk?"

**FR-SAVE-06: Thumbnail Mirroring**
- When the `full` path of a photo entry is edited, the `thumbnail` field is automatically set to the same value before writing.

---

## 6. Default Value Generation Rules

### 6.1 New Gallery Entry (added to `galleries.json`)

Given a subdirectory named `{dirName}`:

| Field | Default Value | Rule |
|-------|--------------|------|
| `name` | `{dirName}` | Directory name used as-is |
| `slug` | `{dirName}` | Exact directory name |
| `date` | Current month and year | Formatted as `"MMMM YYYY"` (e.g., "February 2026") |
| `cover` | `{folderName}/{dirName}/{firstImage}` | First image file (alphabetically); `{folderName}` is the opened root folder name. Empty string if no images. |

### 6.2 New Gallery Details File (`gallery-details.json`)

| Field | Default Value |
|-------|--------------|
| `name` | `{dirName}` |
| `slug` | `{dirName}` |
| `date` | Current month and year (`"MMMM YYYY"`) |
| `description` | `""` (empty string) |
| `photos` | One `PhotoEntry` per recognized image file, sorted alphabetically |

### 6.3 New Photo Entry

Given an image file `{filename}` in subdirectory `{dirName}` inside root folder `{folderName}`:

| Field | Default Value | Example |
|-------|--------------|---------|
| `thumbnail` | `{folderName}/{dirName}/{filename}` | `galleries/coastal-sunset/01.jpg` |
| `full` | `{folderName}/{dirName}/{filename}` | `galleries/coastal-sunset/01.jpg` |
| `alt` | `{filenameWithoutExtension}` | `01` |

---

## 7. Screen Layouts

### 7.1 Welcome Screen (no folder open)

```
┌─────────────────────────────────────────────────────────────────┐
│  AfterGlowManager                                        _ □ X │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                                                                 │
│                    ┌─────────────────────┐                      │
│                    │   AfterGlow Logo    │                      │
│                    └─────────────────────┘                      │
│                                                                 │
│                      AfterGlowManager                           │
│                   Manage your galleries                          │
│                                                                 │
│                   ┌──────────────────┐                           │
│                   │   Open Folder    │                           │
│                   └──────────────────┘                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 Galleries View (root selected, gallery selected)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  AfterGlowManager                                                    _ □ X │
├───────────┬────────────────────────────────────────────┬───────────────────┤
│           │                                            │                   │
│  TREE     │  TILE GRID (AfterGlow dark theme)          │  INFO PANE        │
│  VIEW     │                                            │                   │
│           │  ┌──────────────┐  ┌──────────────┐        │  Gallery Details   │
│  ► galler │  │              │  │              │        │  ───────────────   │
│    ├─ coa │  │  [cover img] │  │  [cover img] │        │                   │
│    ├─ mou │  │              │  │              │        │  Name:            │
│    ├─ cit │  │──────────────│  │──────────────│        │  ┌─────────────┐  │
│    └─ for │  │coastal-  Feb │  │mountain  Jan │        │  │coastal-suns │  │
│           │  │sunset   2026│  │-dawn    2026│        │  └─────────────┘  │
│           │  └──────────────┘  └──────────────┘        │                   │
│           │                                            │  Date:            │
│           │  ┌──────────────┐  ┌──────────────┐        │  ┌─────────────┐  │
│           │  │              │  │              │        │  │February 202 │  │
│           │  │  [cover img] │  │  [cover img] │        │  └─────────────┘  │
│           │  │              │  │              │        │                   │
│           │  │──────────────│  │──────────────│        │  Cover:           │
│           │  │city-     Mar │  │forest-  Dec │        │  ┌─────────────┐  │
│           │  │lights   2025│  │trail   2025│        │  │galleries/co │  │
│           │  └──────────────┘  └──────────────┘        │  └─────────────┘  │
│           │                                            │  ┌─────────────┐  │
│           │                                            │  │ [cover      │  │
│           │                                            │  │  preview]   │  │
│           │                                            │  └─────────────┘  │
│           │                                            │                   │
│           │                                            │  Slug: coastal-   │
│           │                                            │  sunset (readonly)│
│           │                                            │                   │
│           │                                            │  ┌──────────────┐ │
│           │                                            │  │Delete Gallery│ │
│           │                                            │  └──────────────┘ │
│           │                                            │                   │
│           │                                            │  ───────────────  │
│           │                                            │  Untracked        │
│           │                                            │  Galleries        │
│           │                                            │  ───────────────  │
│           │                                            │  autumn-leaves    │
│           │                                            │       [Add]       │
│           │                                            │  spring-bloom     │
│           │                                            │       [Add]       │
│           │                                            │                   │
├───────────┼────────────────────────────────────────────┼───────────────────┤
│  240px    │              flex: 1                       │     320px         │
└───────────┴────────────────────────────────────────────┴───────────────────┘
```

### 7.3 Gallery Detail View (image selected)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  AfterGlowManager                                                    _ □ X │
├───────────┬────────────────────────────────────────────┬───────────────────┤
│           │                                            │                   │
│  TREE     │  GALLERY HEADER                            │  INFO PANE        │
│  VIEW     │  ┌─────────────────────────────────────┐   │                   │
│           │  │ Name: [coastal-sunset          ]    │   │  Image Details    │
│  ► galler │  │ Date: [February 2026           ]    │   │  ─────────────   │
│    ├─ coa │  │ Slug: coastal-sunset (read-only)    │   │                   │
│    ├─ mou │  │ Desc: [                        ]    │   │  Alt Text:        │
│    └─ cit │  └─────────────────────────────────────┘   │  ┌─────────────┐  │
│           │                                            │  │01           │  │
│           │  IMAGE TILE GRID (AfterGlow dark theme)    │  └─────────────┘  │
│           │                                            │                   │
│           │  ┌──────────┐ ┌──────────┐ ┌──────────┐   │  Full Path:       │
│           │  │          │ │          │ │          │   │  ┌─────────────┐  │
│           │  │ [image]  │ │ [image]  │ │ [image]  │   │  │galleries/co│  │
│           │  │          │ │ SELECTED │ │          │   │  │astal-sunset│  │
│           │  │──────────│ │──────────│ │──────────│   │  │/01.jpg     │  │
│           │  │  01      │ │  02      │ │  03      │   │  └─────────────┘  │
│           │  └──────────┘ └──────────┘ └──────────┘   │                   │
│           │                                            │  ┌─────────────┐  │
│           │  ┌──────────┐ ┌──────────┐                 │  │ [image      │  │
│           │  │ [image]  │ │ [image]  │                 │  │  preview]   │  │
│           │  │──────────│ │──────────│                 │  └─────────────┘  │
│           │  │  04      │ │  05      │                 │                   │
│           │  └──────────┘ └──────────┘                 │  ┌──────────────┐ │
│           │                                            │  │Remove Image │ │
│           │                                            │  └──────────────┘ │
│           │                                            │                   │
│           │                                            │  ───────────────  │
│           │                                            │  Untracked Images │
│           │                                            │  ───────────────  │
│           │                                            │  [Add All]        │
│           │                                            │  06.jpg   [Add]   │
│           │                                            │  07.jpg   [Add]   │
│           │                                            │                   │
└───────────┴────────────────────────────────────────────┴───────────────────┘
```

---

## 8. Path Convention Rules

**Rule 1: All JSON paths are site-relative.**
Paths stored in JSON are relative to the AfterGlow site root, not to the JSON file itself and not absolute. Example: `galleries/coastal-sunset/01.jpg`.

**Rule 2: The opened folder name is the first path segment.**
When the user opens a folder named `galleries`, all generated paths start with `galleries/`. If the folder were named `photos`, paths would start with `photos/`.

**Rule 3: Path construction formula.**
```
{rootFolderName}/{subdirectoryName}/{filename}
```

**Rule 4: Path resolution for display.**
To load an image for display, resolve as:
```
{absolute path to opened folder's PARENT}/{jsonPath}
```

**Rule 5: Forward slashes only.**
All paths in JSON use forward slashes regardless of OS.

**Rule 6: No leading slash.**
Paths never start with `/`. They are relative.

---

## 9. Non-Functional Requirements

### 9.1 Performance
- **NFR-PERF-01:** Load a gallery with up to 500 images without perceptible lag (< 1 second).
- **NFR-PERF-02:** Image tiles use lazy loading -- only visible images are loaded.
- **NFR-PERF-03:** JSON writes complete within 100ms for files under 1MB.
- **NFR-PERF-04:** Virtualized rendering for grids exceeding 100 items.

### 9.2 Reliability
- **NFR-REL-01:** Atomic JSON writes (temp file + rename).
- **NFR-REL-02:** Graceful handling of missing image files (placeholder, no crash).
- **NFR-REL-03:** Graceful handling of malformed JSON (error banner, reset option).
- **NFR-REL-04:** Detect deleted workspace folder and return to welcome screen.

### 9.3 Usability
- **NFR-USE-01:** OS light/dark mode for chrome; AfterGlow dark theme for tile grids.
- **NFR-USE-02:** All destructive actions require confirmation dialogs.
- **NFR-USE-03:** Keyboard: Tab between fields, Escape clears selection, Delete triggers remove confirmation.
- **NFR-USE-04:** Toast notifications for save failures, bulk additions, and external changes.

### 9.4 Cross-Platform
- **NFR-PLAT-01:** Native title bar and file dialogs on macOS and Windows.
- **NFR-PLAT-02:** Forward slashes in JSON, OS-native paths for filesystem operations.
- **NFR-PLAT-03:** Bundled as `.dmg` (macOS) and `.msi`/`.exe` (Windows) via Tauri bundler.

### 9.5 Security
- **NFR-SEC-01:** File access restricted to the opened folder and subdirectories via Tauri scope.
- **NFR-SEC-02:** No network access. Fully offline.

---

## 10. Future Roadmap (Out of Scope for v1.0)

| Feature | Description |
|---------|-------------|
| Thumbnail Generation | Auto-generate thumbnails from full-size photos |
| Watermarking | Apply watermark overlays to images |
| Image Reprocessing | Resize/optimize, WebP/AVIF conversion |
| Metadata from EXIF | Auto-populate date/description from EXIF data |
| Multi-folder Workspace | Open multiple gallery roots simultaneously |
| Publish / Deploy | Built-in S3/rsync upload |
| Undo/Redo | Full undo/redo stack |
| Search | Filter galleries/images by name/alt text |

---

## Appendix A: Component Inventory

| Component | Responsibility |
|-----------|---------------|
| `App` | Workspace provider, router between welcome / main |
| `WelcomeScreen` | Centered open-folder CTA |
| `AppShell` | Three-column layout: tree + content + info pane |
| `TreeView` | Folder tree with root + subdirectories |
| `GalleriesView` | Tile grid for `galleries.json` |
| `GalleryTile` | Single gallery tile with cover, name, date overlay |
| `GalleryDetailView` | Header + image tile grid for `gallery-details.json` |
| `GalleryHeader` | Editable name, date, slug, description |
| `ImageTile` | Single image tile with thumbnail and alt overlay |
| `InfoPane` | Context-sensitive detail editor |
| `GalleryInfoPane` | Fields for gallery metadata |
| `ImageInfoPane` | Fields for image metadata |
| `UntrackedList` | Lists untracked items with Add buttons |
| `ConfirmDialog` | Reusable confirmation dialog (Shadcn AlertDialog) |
| `Toast` | Notification toasts (Shadcn Sonner/Toast) |

---

## Appendix B: Tauri Permission Scope

- Allow read/write access only within the user-selected directory and subdirectories.
- Tauri 2.x `fs` plugin with scope: opened folder path + `/**`.
- `asset` protocol scope to load images from the opened folder.
- Deny all network access.
