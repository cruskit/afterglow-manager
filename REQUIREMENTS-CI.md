# CI/CD Pipeline Requirements

## Overview

GitHub Actions workflow for AfterGlow Manager (Tauri 2.x desktop app) providing continuous integration on all branches and automated release builds with binary publishing on `main`.

---

## 1. Workflow Triggers

| Trigger | Scope | Actions |
|---------|-------|---------|
| `push` to any branch | All branches | Run tests |
| `push` to `main` | Main only | Run tests + build binaries + create GitHub release |

Pull request builds are out of scope for now but the workflow structure should not preclude adding them later.

---

## 2. Test Job (All Branches)

Runs on every push to any branch.

### 2.1 Steps

1. Checkout repository
2. Setup Node.js (LTS)
3. Install npm dependencies (`npm ci`)
4. Run TypeScript type checking (`tsc --noEmit`)
5. Run frontend tests (`npm test` — Vitest)

### 2.2 Runner

- `ubuntu-latest` — tests are frontend-only (jsdom/Vitest) and don't require a native Tauri build, so a single Linux runner is sufficient.

### 2.3 Notes

- Rust backend tests are not currently present. If Rust tests are added later (`cargo test`), a step should be added to this job.
- The test job must pass before the release job runs (dependency via `needs:`).

---

## 3. Release Build Job (Main Only)

Runs only on pushes to `main`, after the test job passes.

### 3.1 Platform Matrix

| Platform | Runner | Tauri Build Args | Output |
|----------|--------|------------------|--------|
| macOS ARM (Apple Silicon) | `macos-latest` | `--target aarch64-apple-darwin` | `.dmg`, `.app` |
| macOS Intel | `macos-latest` | `--target x86_64-apple-darwin` | `.dmg`, `.app` |
| Windows | `windows-latest` | _(none)_ | `.msi`, `.exe` (NSIS) |

Linux is explicitly excluded per requirements.

### 3.2 Steps (per matrix entry)

1. Checkout repository
2. Setup Node.js (LTS)
3. Install Rust stable toolchain (with appropriate target for cross-compilation)
4. Install npm dependencies (`npm ci`)
5. Run `tauri-apps/tauri-action` to build and upload release assets

### 3.3 Tauri Action Configuration

```yaml
uses: tauri-apps/tauri-action@v0
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
with:
  tagName: v__VERSION__
  releaseName: 'AfterGlow Manager v__VERSION__'
  releaseBody: 'See the assets below to download the installer for your platform.'
  releaseDraft: true
  prerelease: false
```

Key points:
- `__VERSION__` is automatically replaced by the action with the version from `tauri.conf.json`.
- `releaseDraft: true` — releases are created as drafts so they can be reviewed before publishing. This can be changed to `false` if fully automated publishing is preferred.
- The action handles creating the GitHub release and uploading all platform binaries to it.
- All matrix jobs upload to the same release (the action finds the existing release by tag).

### 3.4 Code Signing (Future)

- macOS: Will require an Apple Developer certificate and notarization. Not in scope for initial implementation but the workflow should have placeholder comments indicating where signing env vars would go.
- Windows: Will require a code signing certificate. Same approach — placeholder comments only.

---

## 4. Versioning Strategy

The app version currently lives in three places that must stay in sync:
- `package.json` → `version`
- `src-tauri/Cargo.toml` → `version`
- `src-tauri/tauri.conf.json` → `version`

### 4.1 Options

#### Option A: Manual Version Bumps (Recommended to start)

**How it works:** The developer manually updates the version in all three files before merging to `main`. The CI reads the version from `tauri.conf.json` and creates a tag/release matching it.

**Pros:**
- Simple, predictable, full control over when versions change
- No magic — the version in the code always matches what gets released
- Works well with semantic versioning (developer decides if a change is patch/minor/major)

**Cons:**
- Easy to forget to bump, or to bump in one file but not the others
- Requires discipline

**Mitigation:** Add a CI check that verifies all three version fields are in sync. Optionally add a helper script (`scripts/bump-version.sh`) that updates all three files at once.

#### Option B: Conventional Commits + Automated Bumps

**How it works:** Use [Conventional Commits](https://www.conventionalcommits.org/) format for commit messages (e.g., `feat:`, `fix:`, `chore:`). A tool like `standard-version` or `release-please` analyzes commits since the last release and automatically determines the next semantic version.

**Pros:**
- Fully automated — no manual version management
- Changelog is auto-generated from commit messages
- Semantic version bumps are derived from commit types (`fix:` → patch, `feat:` → minor, `feat!:` or `BREAKING CHANGE:` → major)

**Cons:**
- Requires the team to consistently use conventional commit format
- Adds complexity (an extra GitHub Action or bot manages PRs/releases)
- Less direct control over exact version numbers

**Implementation:** Google's [release-please-action](https://github.com/googleapis/release-please-action) is the most common choice. It creates a "release PR" that, when merged, triggers the actual build and release.

#### Option C: Git Tag-Driven Releases

**How it works:** The developer pushes a semver git tag (e.g., `v1.2.0`) to trigger the release build. The workflow only runs the release job when a tag matching `v*` is pushed.

**Pros:**
- Clear, explicit release trigger
- Version is the tag itself — no file synchronization issues
- Works well for projects that don't release on every merge to main

**Cons:**
- Version in code files may drift from the tag
- Requires a separate step to update version files (or a pre-release script that writes the tag version into the files)
- Two-step process: update files + push tag

**Implementation:** Change the workflow trigger to `on: push: tags: ['v*']` for the release job, and use the tag as the version source.

### 4.2 Recommendation

**Start with Option A** (manual bumps + sync check) for simplicity. Add a `scripts/bump-version.sh` helper that takes a semver argument and updates all three files. This gives full control with minimal tooling.

When the project matures or if multiple contributors are involved, migrate to **Option B** (conventional commits + release-please) for full automation.

### 4.3 Version Sync Validation

Regardless of which option is chosen, the test job should include a step that verifies the version is consistent across all three files:

```yaml
- name: Verify version sync
  run: |
    PKG_VERSION=$(node -p "require('./package.json').version")
    TAURI_VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
    CARGO_VERSION=$(grep '^version' src-tauri/Cargo.toml | head -1 | sed 's/.*"\(.*\)"/\1/')
    if [ "$PKG_VERSION" != "$TAURI_VERSION" ] || [ "$PKG_VERSION" != "$CARGO_VERSION" ]; then
      echo "Version mismatch: package.json=$PKG_VERSION, tauri.conf.json=$TAURI_VERSION, Cargo.toml=$CARGO_VERSION"
      exit 1
    fi
    echo "All versions in sync: $PKG_VERSION"
```

---

## 5. Version Bump Helper Script

Create `scripts/bump-version.sh` that:

1. Accepts a semver version string as an argument (e.g., `1.2.0`)
2. Updates `package.json` → `version`
3. Updates `src-tauri/tauri.conf.json` → `version`
4. Updates `src-tauri/Cargo.toml` → `version` (under `[package]`)
5. Runs `cargo generate-lockfile` in `src-tauri/` to update `Cargo.lock`
6. Prints a summary of changes

---

## 6. Workflow File Structure

Single workflow file: `.github/workflows/ci.yml`

```
on:
  push:
    branches: ['**']        # all branches

jobs:
  test:                     # runs on all branches
    ...
  release:                  # runs only on main, needs: [test]
    if: github.ref == 'refs/heads/main'
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: macos-latest
            args: '--target aarch64-apple-darwin'
          - platform: macos-latest
            args: '--target x86_64-apple-darwin'
          - platform: windows-latest
            args: ''
    ...
```

---

## 7. Secrets and Permissions

| Secret / Permission | Purpose | Required Now? |
|---------------------|---------|---------------|
| `GITHUB_TOKEN` | Create releases, upload assets | Yes (automatic) |
| `APPLE_CERTIFICATE` | macOS code signing | No (future) |
| `APPLE_CERTIFICATE_PASSWORD` | macOS code signing | No (future) |
| `APPLE_SIGNING_IDENTITY` | macOS code signing | No (future) |
| `APPLE_ID` / `APPLE_PASSWORD` | macOS notarization | No (future) |
| `WINDOWS_CERTIFICATE` | Windows code signing | No (future) |

The `GITHUB_TOKEN` is provided automatically by GitHub Actions — no manual secret setup needed for the initial implementation.

---

## 8. Deliverables Summary

1. **`.github/workflows/ci.yml`** — Main workflow file with test + release jobs
2. **`scripts/bump-version.sh`** — Version bump helper script
3. **Version sync check** — Integrated into the test job
4. **Documentation update** — Add a "Releasing" section to README.md describing the release process

---

## 9. Open Questions / Decisions Needed

1. **Draft vs. published releases?** Current recommendation is draft releases (`releaseDraft: true`) so binaries can be reviewed before publishing. Should releases be published automatically instead?

2. **macOS universal binary?** Instead of separate ARM and Intel builds, Tauri supports universal binaries (`--target universal-apple-darwin`). This produces a single binary that runs natively on both architectures but is larger. Preference?

3. **NSIS vs MSI for Windows?** Tauri can produce both. NSIS is more modern and customizable; MSI is more enterprise-friendly. The default builds both — is that acceptable or should we limit to one?

4. **Versioning approach?** Option A (manual), B (conventional commits), or C (tag-driven) as described in section 4.1?
