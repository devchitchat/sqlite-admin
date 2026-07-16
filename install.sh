#!/usr/bin/env bash
# sqlite-admin installer — downloads source from GitHub and installs via bun.
#
# Usage (latest release):
#   curl -fsSL https://raw.githubusercontent.com/devchitchat/sqlite-admin/main/install.sh | bash
#
# Usage (pinned tag):
#   curl -fsSL https://raw.githubusercontent.com/devchitchat/sqlite-admin/main/install.sh | SQLITE_ADMIN_REF=v1.2.3 bash
#
# Environment overrides:
#   SQLITE_ADMIN_REPO   GitHub "owner/repo"  (default: devchitchat/sqlite-admin)
#   SQLITE_ADMIN_REF    branch, tag, or SHA  (default: latest release tag)
#   INSTALL_DIR         where source lands   (default: ~/.local/share/sqlite-admin)
#   BIN_DIR             where shim lands     (default: ~/.local/bin)

set -euo pipefail

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: $1 is required but not found" >&2
    echo "       $2" >&2
    exit 1
  fi
}

need bun   "install from https://bun.sh/docs/installation"
need unzip "brew install unzip  (or apt install unzip)"
need curl  "brew install curl   (or apt install curl)"

SQLITE_ADMIN_REPO="${SQLITE_ADMIN_REPO:-devchitchat/sqlite-admin}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/share/sqlite-admin}"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"

# Resolve SQLITE_ADMIN_REF: if unset, fetch the latest release tag from GitHub API.
if [[ -z "${SQLITE_ADMIN_REF:-}" ]]; then
  SQLITE_ADMIN_REF="$(curl -fsSL "https://api.github.com/repos/$SQLITE_ADMIN_REPO/releases/latest" \
    | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')"
  if [[ -z "$SQLITE_ADMIN_REF" ]]; then
    echo "error: could not resolve latest release from GitHub API" >&2
    exit 1
  fi
  echo "==> resolved latest release: $SQLITE_ADMIN_REF"
fi

mkdir -p "$INSTALL_DIR" "$BIN_DIR"

TMP="$(mktemp -d -t sqlite-admin-install)"
trap 'rm -rf "$TMP"' EXIT

echo "==> downloading sqlite-admin ($SQLITE_ADMIN_REPO @ $SQLITE_ADMIN_REF)..."

# For version tags (v*), prefer the release asset (sqlite-admin-src.zip uploaded by CI).
# Fall back to GitHub's archive API for branch names or SHAs.
if [[ "$SQLITE_ADMIN_REF" == v* ]]; then
  RELEASE_URL="https://github.com/$SQLITE_ADMIN_REPO/releases/download/$SQLITE_ADMIN_REF/sqlite-admin-src.zip"
  if curl -fsSL "$RELEASE_URL" -o "$TMP/src.zip" 2>/dev/null; then
    echo "    (from release asset)"
  else
    echo "    (release asset not found, falling back to tag archive)"
    curl -fsSL "https://github.com/$SQLITE_ADMIN_REPO/archive/refs/tags/$SQLITE_ADMIN_REF.zip" \
      -o "$TMP/src.zip"
  fi
else
  curl -fsSL "https://github.com/$SQLITE_ADMIN_REPO/archive/refs/heads/$SQLITE_ADMIN_REF.zip" \
    -o "$TMP/src.zip"
fi

echo "==> extracting..."
unzip -oq "$TMP/src.zip" -d "$TMP/extracted"

# Release assets unzip flat. GitHub branch/tag archives unzip into a top-level
# directory like "sqlite-admin-main/". Detect which.
SRC_DIR="$(find "$TMP/extracted" -mindepth 1 -maxdepth 1 -type d | head -1)"
if [[ -z "$SRC_DIR" || ! -f "$SRC_DIR/package.json" ]]; then
  SRC_DIR="$TMP/extracted"
fi
if [[ ! -f "$SRC_DIR/package.json" ]]; then
  echo "error: could not find package.json in extracted source" >&2
  exit 1
fi

echo "==> installing to $INSTALL_DIR..."
rm -rf "$INSTALL_DIR/src" "$INSTALL_DIR/server.js" "$INSTALL_DIR/package.json" "$INSTALL_DIR/README.md"
cp -r "$SRC_DIR/." "$INSTALL_DIR/"

echo "==> writing shim to $BIN_DIR/sqlite-admin..."
cat > "$BIN_DIR/sqlite-admin" <<EOF
#!/usr/bin/env bash
exec bun "$INSTALL_DIR/server.js" "\$@"
EOF
chmod +x "$BIN_DIR/sqlite-admin"

echo ""
echo "sqlite-admin installed successfully."
echo "  source: $INSTALL_DIR"
echo "  shim:   $BIN_DIR/sqlite-admin"
echo ""
echo "Run it:"
echo "  DB_FILE_PATH=/path/to/your.db sqlite-admin"
echo ""
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo "Note: $BIN_DIR is not in your PATH. Add this to your shell profile:"
  echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
fi
