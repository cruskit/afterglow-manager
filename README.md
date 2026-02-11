# AfterGlowManager

A cross-platform desktop application for visually managing the JSON metadata that powers [AfterGlow](https://github.com/afterglow), a static photo gallery website. Instead of hand-editing `galleries.json` and `gallery-details.json` files, AfterGlowManager provides a graphical interface for creating, editing, and organizing gallery metadata with live tile previews that mirror AfterGlow's dark-themed layout.

## Features

- **Visual tile previews** that replicate AfterGlow's dark gallery theme so you can judge appearance before publishing
- **Auto-save** on every edit (field blur, drag-and-drop reorder, add/delete) with 300ms debounce and atomic writes
- **Untracked detection** automatically finds subdirectories and images on disk that aren't yet in your JSON metadata
- **Drag-and-drop reordering** for both gallery tiles and image tiles, persisted immediately to JSON
- **Non-destructive** -- delete operations only remove entries from JSON; image files on disk are never touched
- **Sensible defaults** generated for every new gallery and image entry (date, paths, alt text) so you can add with a single click

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Native shell | Tauri 2.x (Rust) |
| Frontend | React 19, TypeScript (strict) |
| Styling | Tailwind CSS 3, Shadcn/ui primitives |
| Drag-and-drop | @dnd-kit |
| Build tooling | Vite |
| Testing | Vitest, React Testing Library |

## Prerequisites

- **Node.js** >= 18
- **npm** >= 8
- **Rust** (stable toolchain) -- install via [rustup](https://rustup.rs/)
- **Tauri 2.x system dependencies** -- see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/) for your OS (macOS needs Xcode Command Line Tools; Windows needs Visual Studio Build Tools and WebView2)

## Getting Started

### Install dependencies

```bash
npm install
```

### Run in development mode

```bash
npm run tauri dev
```

This starts the Vite dev server with hot reload and launches the Tauri window. Rust backend changes trigger a recompile automatically.

### Run the frontend only (no Tauri window)

```bash
npm run dev
```

Opens at `http://localhost:1420`. Tauri IPC calls will fail, but this is useful for working on layout and styling.

## Building for Production

```bash
npm run tauri build
```

This compiles the Rust backend in release mode and bundles the frontend. Output artifacts are placed in `src-tauri/target/release/bundle/`:

- **macOS**: `.dmg` and `.app` in `bundle/dmg/` and `bundle/macos/`
- **Windows**: `.msi` and `.exe` in `bundle/msi/` and `bundle/nsis/`

## Running Tests

```bash
# Run all tests once
npm test

# Run tests in watch mode
npm run test:watch
```

The test suite includes 47 tests across 3 files:

- **`reducer.test.ts`** -- 25 tests covering all workspace reducer actions (add, delete, reorder, update galleries/photos, error handling, state reset)
- **`components.test.tsx`** -- 20 tests for UI components (WelcomeScreen, ConfirmDialog, UntrackedList, GalleryTile, ImageTile)
- **`App.test.tsx`** -- 2 integration tests for app-level routing

## Project Structure

```
afterglow-manager/
├── src-tauri/                    # Rust backend
│   ├── Cargo.toml
│   ├── capabilities/default.json # Tauri permission scopes
│   ├── tauri.conf.json           # App window config, bundler settings
│   └── src/
│       ├── main.rs               # Entry point
│       └── lib.rs                # 7 Tauri IPC commands
├── src/                          # React frontend
│   ├── main.tsx                  # Entry with WorkspaceProvider
│   ├── App.tsx                   # Welcome / main view router
│   ├── types.ts                  # TypeScript interfaces and action types
│   ├── commands.ts               # Tauri IPC command bindings
│   ├── index.css                 # Tailwind directives + CSS variables
│   ├── lib/utils.ts              # cn() class merge utility
│   ├── context/
│   │   └── WorkspaceContext.tsx   # useReducer state + all workspace logic
│   ├── components/
│   │   ├── WelcomeScreen.tsx     # Open folder landing page
│   │   ├── AppShell.tsx          # 3-column layout + keyboard shortcuts
│   │   ├── TreeView.tsx          # Folder tree sidebar (240px)
│   │   ├── GalleriesView.tsx     # Gallery tile grid with drag-and-drop
│   │   ├── GalleryTile.tsx       # Single gallery tile (cover, name, date)
│   │   ├── GalleryDetailView.tsx # Image tile grid with drag-and-drop
│   │   ├── GalleryHeader.tsx     # Editable name, date, slug, description
│   │   ├── ImageTile.tsx         # Single image tile (image, alt text)
│   │   ├── GalleryInfoPane.tsx   # Gallery metadata editor + untracked list
│   │   ├── ImageInfoPane.tsx     # Image metadata editor + untracked list
│   │   ├── UntrackedList.tsx     # Add / Add All for untracked items
│   │   └── ConfirmDialog.tsx     # Destructive action confirmation modal
│   └── test/                     # Test files
│       ├── setup.ts              # Vitest setup + Tauri mocks
│       ├── test-utils.tsx        # renderWithProviders helper
│       ├── reducer.test.ts
│       ├── components.test.tsx
│       └── App.test.tsx
├── REQUIREMENTS.md               # Full requirements specification
├── tailwind.config.js
├── postcss.config.js
├── vite.config.ts
└── package.json
```

## How It Works

1. **Open a folder** -- pick a directory that contains (or will contain) gallery subfolders and a `galleries.json` file.
2. **Galleries View** -- the root node shows all galleries as tiles. Click to select and edit metadata in the info pane. Double-click or use the tree to drill into a gallery.
3. **Gallery Detail View** -- shows all images in a gallery as tiles with an editable header. Select images to edit alt text and paths.
4. **Untracked detection** -- subdirectories without a matching `slug` in `galleries.json` appear in the "Untracked Galleries" list. Image files not referenced in `gallery-details.json` appear in "Untracked Images". Click "Add" or "Add All" to track them with sensible defaults.
5. **Auto-save** -- every edit saves to disk automatically via atomic write (temp file + rename). No save button needed.

## Data Files

AfterGlowManager reads and writes two types of JSON files:

- **`galleries.json`** -- array of `{ name, slug, date, cover }` entries at the workspace root
- **`gallery-details.json`** -- `{ name, slug, date, description, photos: [{ thumbnail, full, alt }] }` inside each gallery subfolder

All paths in JSON are site-relative with forward slashes (e.g., `galleries/coastal-sunset/01.jpg`). See [REQUIREMENTS.md](./REQUIREMENTS.md) for the full specification.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Escape` | Clear current selection (gallery or image) |
| `Tab` | Move between editable fields |

## IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## License

Private project.
