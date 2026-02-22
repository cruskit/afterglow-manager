#!/usr/bin/env bash
#
# Bump the application version across all config files.
#
# Usage:
#   ./scripts/bump-version.sh <version>
#
# Example:
#   ./scripts/bump-version.sh 1.2.0
#
# Updates:
#   - package.json              (version field)
#   - src-tauri/tauri.conf.json (version field)
#   - src-tauri/Cargo.toml      (version field under [package])
#   - src-tauri/Cargo.lock      (regenerated)
#   - afterglow-website/index.html (AfterGlow vX.Y.Z in footer)

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <version>"
  echo "Example: $0 1.2.0"
  exit 1
fi

NEW_VERSION="$1"

# Validate semver format (major.minor.patch with optional pre-release/build)
if ! echo "$NEW_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$'; then
  echo "Error: '$NEW_VERSION' is not a valid semantic version (expected X.Y.Z)"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# --- package.json ---
PACKAGE_JSON="$REPO_ROOT/package.json"
OLD_PKG=$(node -p "require('$PACKAGE_JSON').version")
TMP=$(mktemp)
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('$PACKAGE_JSON', 'utf8'));
  pkg.version = '$NEW_VERSION';
  fs.writeFileSync('$TMP', JSON.stringify(pkg, null, 2) + '\n');
"
mv "$TMP" "$PACKAGE_JSON"
echo "package.json: $OLD_PKG -> $NEW_VERSION"

# --- tauri.conf.json ---
TAURI_CONF="$REPO_ROOT/src-tauri/tauri.conf.json"
OLD_TAURI=$(node -p "require('$TAURI_CONF').version")
TMP=$(mktemp)
node -e "
  const fs = require('fs');
  const conf = JSON.parse(fs.readFileSync('$TAURI_CONF', 'utf8'));
  conf.version = '$NEW_VERSION';
  fs.writeFileSync('$TMP', JSON.stringify(conf, null, 2) + '\n');
"
mv "$TMP" "$TAURI_CONF"
echo "tauri.conf.json: $OLD_TAURI -> $NEW_VERSION"

# --- Cargo.toml ---
CARGO_TOML="$REPO_ROOT/src-tauri/Cargo.toml"
OLD_CARGO=$(grep '^version' "$CARGO_TOML" | head -1 | sed 's/.*"\(.*\)"/\1/')
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('$CARGO_TOML', 'utf8');
  const updated = content.replace(/^version = \".*\"/m, 'version = \"$NEW_VERSION\"');
  fs.writeFileSync('$CARGO_TOML', updated);
"
echo "Cargo.toml: $OLD_CARGO -> $NEW_VERSION"

# --- afterglow-website/index.html ---
WEBSITE_HTML="$REPO_ROOT/afterglow-website/index.html"
OLD_WEB=$(grep -oE 'AfterGlow v[0-9]+\.[0-9]+\.[0-9]+' "$WEBSITE_HTML" || echo "not found")
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('$WEBSITE_HTML', 'utf8');
  const updated = content.replace(/AfterGlow v[0-9]+\.[0-9]+\.[0-9]+/, 'AfterGlow v$NEW_VERSION');
  fs.writeFileSync('$WEBSITE_HTML', updated);
"
echo "afterglow-website/index.html: $OLD_WEB -> AfterGlow v$NEW_VERSION"

# --- Cargo.lock ---
if command -v cargo &> /dev/null; then
  echo "Updating Cargo.lock..."
  (cd "$REPO_ROOT/src-tauri" && cargo generate-lockfile 2>/dev/null) || echo "Warning: cargo generate-lockfile failed, Cargo.lock may need manual update"
else
  echo "Warning: cargo not found, skipping Cargo.lock update"
fi

echo ""
echo "Version bumped to $NEW_VERSION across all files."
echo "Review changes with: git diff"
