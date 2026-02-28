# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AfterGlow Manager is a Tauri 2.x + React 19 desktop app for managing JSON metadata that powers a static photo gallery website. It provides a GUI for editing `galleries.json` and per-gallery `gallery-details.json` files, with S3 publishing and CloudFront invalidation.

The static website itself (`afterglow-website/`) is bundled into this repo and published to S3 alongside the gallery data. It consists of `index.html`, `afterglow/css/styles.css`, and `afterglow/js/app.js` — plain HTML/CSS/JS with no build step.

## Commands

```bash
# Development (Tauri + Vite hot reload)
npm run tauri dev

# Frontend only (no Tauri window, for styling work)
npm run dev

# Run all frontend tests
npm test

# Watch mode
npm run test:watch

# Run a single test file
npx vitest run src/test/reducer.test.ts

# Rust tests
cargo test --manifest-path src-tauri/Cargo.toml

# TypeScript type check (no dedicated lint command)
npx tsc --noEmit

# Production build (outputs to src-tauri/target/release/bundle/)
npm run tauri build
```

## Architecture

**Tauri IPC boundary** separates the app into two layers:

- **Rust backend** (`src-tauri/src/`): File I/O, native dialogs, OS keychain for AWS credentials, S3 sync/publish logic. All IPC commands are registered in `lib.rs` and bound in the frontend via `src/commands.ts`.
- **React frontend** (`src/`): UI with React Context + `useReducer` for state management (no Redux). State lives in `WorkspaceContext.tsx` which is the central hub — all gallery/image edits dispatch reducer actions, then auto-save to disk via Tauri IPC with 300ms debounce.

**Key Rust modules:**
- `lib.rs` — IPC command registration and all `#[tauri::command]` handlers. Also contains `WatcherState` managed state and fs-watching logic (see File System Watching below).
- `settings.rs` — AppSettings persistence (JSON file + OS keychain), AWS credential validation via STS
- `publish.rs` — S3 sync: preview plan generation, execute with progress events, cancel support. Syncs gallery data files (reachable from `galleries.json`) plus the bundled website assets from `s3Root` (the `afterglow-website/` directory). Also generates and publishes `galleries/search-index.json` at publish time. At publish time, generates WebP thumbnails and rewrites JSON paths (see Thumbnail Generation below).
- `thumbnails.rs` — Thumbnail generation: `build_thumbnail_specs`, `ensure_thumbnails`, `generate_thumbnail`, `is_thumbnail_fresh`. Invoked from `publish_preview`.

**Frontend layout:** 3-column structure in `AppShell.tsx` — tree sidebar, tile grid (galleries or images), and info/edit pane. Uses `@dnd-kit` for drag-and-drop reordering, Shadcn/ui components with Tailwind, and Sonner for toasts. `TagInput` (`src/components/TagInput.tsx`) is a multi-tag autocomplete component used in both info panes, with suggestions drawn from `state.knownTags` (populated via `get_all_tags` IPC on workspace open). Tag casing is preserved as entered; first-occurrence casing wins when the same tag (case-insensitive) is entered again — `TagInput.addTag` resolves canonical casing from `knownTags`. The `mergeKnownTags` helper in `WorkspaceContext.tsx` does case-insensitive deduplication when updating `knownTags` in `UPDATE_GALLERY` and `UPDATE_PHOTO`. Website search (`app.js` `matchesItem`) matches tags case-insensitively (query tags are always lowercased; stored tags may have mixed case). `DateInput` (`src/components/DateInput.tsx`) is a date picker used in `GalleryInfoPane` and `GalleryHeader` — text input with `dd/MM/yyyy` format, a `CalendarDays` icon button, and a calendar popover rendered via `createPortal` (see Gallery Date Picker below). `AppShell` also manages the fs watcher lifecycle (start on workspace open, stop on close) and handles `workspace-fs-change` events. `UntrackedImageGrid` (`src/components/UntrackedImageGrid.tsx`) renders untracked images as a 2-column thumbnail grid in the image info pane — double-click to add an image, with "Add All" support. The generic `UntrackedList` component handles untracked galleries (text list).

## Data Model

- `galleries.json` at workspace root: `{ schemaVersion, galleries: [{ name, slug, date, cover, tags? }] }`
- `gallery-details.json` inside each gallery subfolder: `{ schemaVersion, name, slug, date, description, photos: [{ thumbnail, full, alt, tags? }] }`
- Both files include a `schemaVersion` field (currently `1`). On load, `src/migrations.ts` detects old formats (v0 = no `schemaVersion`) and migrates them automatically, then re-saves.
- `date` field stored as `dd/MM/yyyy` (e.g. `"28/02/2026"`). Old free-text values (e.g. `"February 2026"`) are backward-compatible — the manager shows them as-is without error; the website renders them unchanged.
- `tags` is optional on both `GalleryEntry` and `PhotoEntry`. Omitted from JSON when empty (no noise for untagged galleries/photos). Missing `tags` is treated as `[]`.
- Supported image extensions: jpg, jpeg, png, gif, webp, avif, bmp, tiff, tif

## Testing

Frontend tests use Vitest + React Testing Library with Tauri API mocks defined in `src/test/setup.ts`. Test files:
- `reducer.test.ts` — workspace reducer actions (includes `SET_KNOWN_TAGS` and tag handling in `UPDATE_GALLERY`/`UPDATE_PHOTO`)
- `migrations.test.ts` — schema migration logic for both JSON file types (includes tags round-trip)
- `components.test.tsx` — individual component behavior (includes `TagInput` tests)
- `publish.test.tsx` — settings dialog and publish preview
- `App.test.tsx` — app-level routing

Rust unit tests are inline in `settings.rs`, `publish.rs`, and `thumbnails.rs`.

## File System Watching (v1.9.0+)

`notify-debouncer-mini` (500ms debounce) watches the workspace root recursively. Events are filtered in `classify_fs_event` and emitted to the frontend as `workspace-fs-change` with a typed payload.

**Rust side (`lib.rs`):**
- `WatcherState(Mutex<Option<Debouncer<RecommendedWatcher>>>)` — managed state, registered via `.manage()`
- `classify_fs_event(path, workspace)` — filters to depth ≤ 2, skips hidden paths (starting with `.`) and `.json` files. Depth-1 directory events → `dir-created`/`dir-removed`; depth-2 image file events → `image-created`/`image-removed`
- `start_watching` / `stop_watching` — IPC commands called by frontend on workspace open/close
- `remove_photo_from_gallery_details` — atomically removes a photo entry from `gallery-details.json` by filename match (used when a tracked image is deleted while its gallery is not the active view)

**Frontend side:**
- `AppShell.tsx` uses `useRef(state)` (stateRef pattern) for non-stale event handler access
- `handleFsChange` dispatches: `dir-created` → `loadSubdirectories()`; `dir-removed` → reload sidebar + delete from `galleries.json` if tracked; `image-created` → reload dir images + refresh count; `image-removed` → reload dir images + auto-remove from `galleryDetails` state (if currently viewing) or disk (if not), + refresh count
- `WorkspaceContext` exposes `refreshGalleryCount(slug)` — re-scans a single gallery dir and updates `galleryCounts` for that slug only

## Gallery Date Picker (v1.12.0+)

Gallery dates are stored and edited as `dd/MM/yyyy` strings. The `DateInput` component (`src/components/DateInput.tsx`) is used in both `GalleryInfoPane` and `GalleryHeader`.

**DateInput behavior:**
- Text input with `placeholder="dd/MM/yyyy"` and a `CalendarDays` icon button (lucide-react)
- Calendar popover rendered via `createPortal` into `document.body`, positioned fixed below the input using `getBoundingClientRect()`
- Week starts Monday; selected day highlighted in `bg-[#c9a84c] text-[#0e0e0e]`; today (unselected) in accent border
- `onMouseDown` + `e.preventDefault()` on all calendar buttons prevents input blur before day selection fires
- Validation on blur: non-empty input that fails `dd/MM/yyyy` parse → `border-destructive` + "Use dd/MM/yyyy format" helper text; empty or valid → no error
- `useEffect([value])` syncs `inputText` when parent value changes (e.g. selecting a different gallery)
- Old free-text dates (e.g. `"February 2026"`) are shown as-is in the input and do not trigger an error on blur

**Website rendering (`app.js`):**
- `formatDate(str)` converts `dd/MM/yyyy` → long form (e.g. `"12th January 2026"`) using `ordinal(n)` helper
- Falls back to `str` for non-matching input (backward compat for old format dates)
- Applied in: search results gallery tiles, homepage gallery tiles, gallery detail header

**`getMonthYear()` in `WorkspaceContext.tsx`** returns today as `dd/MM/yyyy` for new gallery defaults.

## Lightbox Layout & Download (v1.11.0+)

The lightbox uses a **column flex layout** so tags always appear below the image with no overlap:
- `.lightbox` is `flex-direction: column; align-items: stretch`
- `.lightbox-img-container` has `flex: 1; overflow: hidden` and `max-height: 100%` on the image
- `.lightbox-footer` sits below the image container: `display: flex; align-items: center; justify-content: center` with tags (`.lightbox-caption`) and a download button (`.lightbox-download`) side by side

**Download button**: uses `fetch()` + `URL.createObjectURL()` to trigger a blob download of the full-resolution image. Falls back to `window.open()` if CORS is not configured. Requires CloudFront Response headers policy set to **SimpleCORS** (`Access-Control-Allow-Origin: *`) for cross-origin fetch to work.

## Thumbnail Generation (v1.7.0+)

At publish time, `publish_preview` generates WebP thumbnails for all referenced images:

- **Local cache**: `{workspace}/.data/thumbnails/{slug}/{stem}.webp`
- **Staleness check**: thumbnail is regenerated if source mtime > thumbnail mtime (or thumbnail missing)
- **Format**: WebP, 85% quality, max 800 px on longest side (Lanczos3 downscale only)
- **S3 path**: `galleries/{slug}/.thumbs/{stem}.webp`
- **JSON rewriting** (publish-time only, local files unchanged):
  - `galleries.json` cover field: `"sunset/01.jpg"` → `"sunset/.thumbs/01.webp"`
  - `gallery-details.json` thumbnail field: `"01.jpg"` → `".thumbs/01.webp"` (full field unchanged)
  - `search-index.json` photo thumbnail field: same rewriting
- **No website JS changes needed**: `app.js` already constructs image URLs from the JSON `thumbnail` field
- **AVIF excluded**: the `image` crate's `avif` feature requires native system libs; AVIF source images fail gracefully (non-fatal error, original published instead)
- **UI**: `PublishPreviewDialog` shows "Generating thumbnails..." → "Scanning files..." as it progresses

## Conventions

- Strict TypeScript (`tsconfig.json` has strict, noUnusedLocals, noUnusedParameters)
- Serde `rename_all = "camelCase"` on Rust structs — splits on underscores only. Use `cloud_front_distribution_id` (not `cloudfront_distribution_id`) to get `cloudFrontDistributionId` in JSON.
- Atomic file writes in Rust: write to temp file, then rename
- AWS credentials are stored in OS keychain, never exposed to the frontend
- Dark theme with AfterGlow brand colors (bg: `#0e0e0e`, accent: `#c9a84c`)

## CI

GitHub Actions (`.github/workflows/ci.yml`): every push runs type check + Vitest. Pushes to main trigger release builds (macOS aarch64 + Windows) with code signing, requiring `production` environment approval.

## Version Sync

Version must match across `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`. CI verifies this. Use `scripts/bump-version.sh <new-version>` to update all four files — it also updates the `AfterGlow vX.Y.Z` string in `afterglow-website/index.html`.

**Do NOT touch version files in feature branches.** CI auto-bumps the version after every merge to main.

Use Conventional Commits in PR titles so CI can determine the bump type:
- `fix: description` → patch (x.y.Z)
- `feat: description` → minor (x.Y.0)
- `feat!: description` or `BREAKING CHANGE:` → major (X.0.0)

The `prepare` CI job parses the merge commit message, runs `bump-version.sh`, commits the result, and pushes using `GITHUB_TOKEN` (which does not trigger a second pipeline run). The `release` job then checks out the bumped commit SHA and builds the release artifacts.

## Keeping CLAUDE.md Current

After implementing any new feature, update this file to reflect the change. Specifically:

- Add or update the relevant section (Architecture, Data Model, Conventions, etc.) to describe new modules, IPC commands, components, or data structures
- If a feature introduces a new pattern (e.g., a new managed state type, a new event flow, a new publish-time transform), document it the same way existing patterns are documented above
- Version-tag notable features inline (e.g., `(v1.9.0+)`) so the history is traceable
- Remove or correct any sections that are no longer accurate after a refactor or removal
