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
#   - package.json         (version field)
#   - src-tauri/tauri.conf.json (version field)
#   - src-tauri/Cargo.toml      (version field under [package])
#   - src-tauri/Cargo.lock      (regenerated)

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
sed -i "0,/^version = \".*\"/s//version = \"$NEW_VERSION\"/" "$CARGO_TOML"
echo "Cargo.toml: $OLD_CARGO -> $NEW_VERSION"

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
