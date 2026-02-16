# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AfterGlow Manager is a Tauri 2.x + React 19 desktop app for managing JSON metadata that powers a static photo gallery website. It provides a GUI for editing `galleries.json` and per-gallery `gallery-details.json` files, with S3 publishing and CloudFront invalidation.

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
- `lib.rs` — IPC command registration and all `#[tauri::command]` handlers
- `settings.rs` — AppSettings persistence (JSON file + OS keychain), AWS credential validation via STS
- `publish.rs` — S3 sync: preview plan generation, execute with progress events, cancel support. Only syncs files reachable from `galleries.json`.

**Frontend layout:** 3-column structure in `AppShell.tsx` — tree sidebar, tile grid (galleries or images), and info/edit pane. Uses `@dnd-kit` for drag-and-drop reordering, Shadcn/ui components with Tailwind, and Sonner for toasts.

## Data Model

- `galleries.json` at workspace root: array of `{ name, slug, date, cover }` entries
- `gallery-details.json` inside each gallery subfolder: `{ name, slug, date, description, photos: [{ thumbnail, full, alt }] }`
- Supported image extensions: jpg, jpeg, png, gif, webp, avif, bmp, tiff, tif

## Testing

Frontend tests use Vitest + React Testing Library with Tauri API mocks defined in `src/test/setup.ts`. Test files:
- `reducer.test.ts` — workspace reducer actions
- `components.test.tsx` — individual component behavior
- `publish.test.tsx` — settings dialog and publish preview
- `App.test.tsx` — app-level routing

Rust unit tests are inline in `settings.rs` and `publish.rs`.

## Conventions

- Strict TypeScript (`tsconfig.json` has strict, noUnusedLocals, noUnusedParameters)
- Serde `rename_all = "camelCase"` on Rust structs — splits on underscores only. Use `cloud_front_distribution_id` (not `cloudfront_distribution_id`) to get `cloudFrontDistributionId` in JSON.
- Atomic file writes in Rust: write to temp file, then rename
- AWS credentials are stored in OS keychain, never exposed to the frontend
- Dark theme with AfterGlow brand colors (bg: `#0e0e0e`, accent: `#c9a84c`)

## CI

GitHub Actions (`.github/workflows/ci.yml`): every push runs type check + Vitest. Pushes to main trigger release builds (macOS aarch64 + Windows) with code signing, requiring `production` environment approval.

## Version Sync

Version must match across `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`. CI verifies this. Use `scripts/bump-version.sh <new-version>` to update all three.

**When creating a PR**, always bump the version and include it in the PR commit. Determine the semver bump type from the changes:
- **patch** (x.y.Z): bug fixes, minor tweaks, docs
- **minor** (x.Y.0): new features, non-breaking enhancements
- **major** (X.0.0): breaking changes
