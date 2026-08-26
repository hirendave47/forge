#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Forge CLI Agent - Automated Build & Local Install Script
# Compiles workspace packages, builds standalone linux-x64 binary via Bun/Docker,
# and installs the executable to /usr/local/bin/forge.
# ==============================================================================

SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
if [[ -f "$SCRIPT_DIR/package.json" ]]; then
  REPO_ROOT="$SCRIPT_DIR"
else
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

TARGET_DIR="/usr/local/bin"
TARGET_BIN="$TARGET_DIR/forge"
SKIP_PACKAGE_BUILD=false

for arg in "$@"; do
  case "$arg" in
    --skip-build)
      SKIP_PACKAGE_BUILD=true
      shift
      ;;
    --target-dir=*)
      TARGET_DIR="${arg#*=}"
      TARGET_BIN="$TARGET_DIR/forge"
      shift
      ;;
    -h|--help)
      echo "Usage: ./scripts/build-and-install.sh [options]"
      echo ""
      echo "Options:"
      echo "  --skip-build          Skip npm run build:offline (use existing dist files)"
      echo "  --target-dir=<dir>    Installation directory (default: /usr/local/bin)"
      echo "  -h, --help            Show this help message"
      exit 0
      ;;
  esac
done

cd "$REPO_ROOT"

echo "========================================================"
echo "  Forge CLI Agent - Build & Install to $TARGET_BIN"
echo "========================================================"

# 1. Build workspace packages
if [[ "$SKIP_PACKAGE_BUILD" == "false" ]]; then
  echo ""
  echo "==> [1/4] Building workspace packages (offline mode)..."
  npm run build:offline
else
  echo ""
  echo "==> [1/4] Skipping workspace package build (--skip-build)"
fi

# 2. Build standalone linux-x64 binary with Bun inside Docker
echo ""
echo "==> [2/4] Compiling standalone binary using Docker + Bun..."
docker run --rm --network host --entrypoint /bin/bash -v "$REPO_ROOT":/src -w /src oven/bun /src/scripts/build-binaries.sh \
  --skip-install --skip-deps --skip-build --offline-model-data --platform linux-x64 --out /src/out

# Fix permissions on generated output folder
USER_ID="$(id -u)"
GROUP_ID="$(id -g)"
docker run --rm --entrypoint chown -v "$REPO_ROOT":/src oven/bun -R "${USER_ID}:${GROUP_ID}" /src/out

BINARY_SRC="$REPO_ROOT/out/linux-x64/forge"

# 3. Verify generated binary
echo ""
echo "==> [3/4] Verifying generated binary..."
if [[ ! -f "$BINARY_SRC" ]]; then
  echo "Error: Binary not found at $BINARY_SRC" >&2
  exit 1
fi
chmod +x "$BINARY_SRC"
"$BINARY_SRC" --version

# 4. Copy to target directory
echo ""
echo "==> [4/4] Installing binary to $TARGET_BIN..."
if [[ -w "$TARGET_DIR" ]]; then
  cp "$BINARY_SRC" "$TARGET_BIN"
  chmod +x "$TARGET_BIN"
elif command -v docker &>/dev/null; then
  echo "==> Installing to $TARGET_DIR using container permissions..."
  docker run --rm -v "$(dirname "$BINARY_SRC")":/src -v "$TARGET_DIR":/dest oven/bun /bin/sh -c "cp /src/$(basename "$BINARY_SRC") /dest/$(basename "$TARGET_BIN") && chmod +x /dest/$(basename "$TARGET_BIN")"
else
  echo "==> Elevated permissions required to write to $TARGET_DIR. Running sudo cp..."
  sudo cp "$BINARY_SRC" "$TARGET_BIN"
  sudo chmod +x "$TARGET_BIN"
fi

echo ""
echo "========================================================"
echo "✓ Successfully installed Forge CLI to $TARGET_BIN"
echo "========================================================"
"$TARGET_BIN" --version
echo ""
echo "Run 'forge --help' or 'forge' to start."

