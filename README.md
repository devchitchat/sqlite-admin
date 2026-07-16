# sqlite-admin

A lightweight web UI for browsing and querying SQLite databases. No build step — runs directly with [Bun](https://bun.sh).

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/devchitchat/sqlite-admin/main/install.sh | bash
```

Installs the source to `~/.local/share/sqlite-admin` and a shim to `~/.local/bin/sqlite-admin`. Requires Bun to be installed.

**Options:**

```bash
# Pin to a specific release
curl -fsSL .../install.sh | SQLITE_ADMIN_REF=v1.2.0 bash

# Install from main branch (bleeding edge)
curl -fsSL .../install.sh | SQLITE_ADMIN_REF=main bash

# Custom install locations
curl -fsSL .../install.sh | INSTALL_DIR=~/apps/sqlite-admin BIN_DIR=~/bin bash
```

If `~/.local/bin` is not in your `PATH`, add this to your shell profile:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Run

Point it at a database file and it starts a web server:

```bash
DB_FILE_PATH=/path/to/your.db sqlite-admin
```

Then open [http://localhost:4269/sqlite-admin](http://localhost:4269/sqlite-admin).

**Update to the latest release:**

```bash
sqlite-admin update             # update to latest release
sqlite-admin update --ref v1.2.0  # pin to a specific version
sqlite-admin update --force     # reinstall even if already on the latest
```

**Options:**

```bash
sqlite-admin --port 7889     # override port via CLI flag
PORT=9000 sqlite-admin       # or via environment variable (CLI flag takes precedence)
```

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_FILE_PATH` | — | Path to the SQLite file to open (required, or set in the UI) |
| `PORT` | `4269` | Port to listen on (overridden by `--port`) |
| `SQLITE_ADMIN_BASE_PATH` | `/sqlite-admin` | URL prefix for all routes |

You can also set the database path from the UI — there is a path field at the top of every page. It is persisted in a browser cookie for the session.

## Development

**Prerequisites:** [Bun](https://bun.sh/docs/installation) ≥ 1.3

```bash
git clone git@github.com:devchitchat/sqlite-admin.git
cd sqlite-admin
```

No dependencies to install — the project uses only Bun built-ins (`bun:sqlite`, `Bun.serve`).

**Start with file watching:**

```bash
DB_FILE_PATH=/path/to/your.db bun run dev
```

**Run tests:**

```bash
bun test
```

**Project layout:**

```
src/
  SqliteAdmin.mjs   — request handler, all routes, HTML rendering
server.js           — Bun.serve() entry point
scripts/
  package.mjs       — builds sqlite-admin-src.zip for release
  release.mjs       — bumps version, commits, tags, packages
tests/
  SqliteAdmin.test.mjs
install.sh          — curl-installable installer
```

## Releasing

Uses conventional commits to determine the version bump automatically.

```bash
bun run release          # auto-detect: fix: → minor, feat!:/BREAKING → major, else patch
bun run release:fix      # force minor bump
bun run release:breaking # force major bump
```

Then push:

```bash
git push && git push --tags
```

Pushing the tag triggers the [GitHub Actions release workflow](.github/workflows/release.yml), which builds `sqlite-admin-src.zip` and attaches it to a GitHub Release. That asset is what the install script downloads.

To preview what a release would do without making changes:

```bash
bun run release --dry-run
```
