// `sqlite-admin update` — refresh the source install in place.
//
// Downloads sqlite-admin-src.zip from the latest GitHub release (or a pinned
// tag via --ref vX.Y.Z), wipes tracked top-level entries, and re-extracts.
// The shim at ~/.local/bin/sqlite-admin keeps pointing at the same path, so
// the next invocation picks up the new source automatically.

import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import pkg from '../package.json' with { type: 'json' }

const REPO = 'devchitchat/sqlite-admin'

// Files the installer owns. Wiped before extracting so deletions in a new
// release don't leave orphaned files behind.
const TRACKED = ['src', 'server.js', 'package.json', 'README.md']

export async function runUpdate({ ref, force = false } = {}) {
  const installDir = resolveInstallDir()
  await assertNotDevCheckout(installDir)

  const tag = ref ?? await resolveLatestTag()
  const remoteVersion = tag.startsWith('v') ? tag.slice(1) : tag

  if (!force && remoteVersion === pkg.version) {
    console.log(`already at v${pkg.version}; nothing to do (pass --force to reinstall)`)
    return
  }

  const zipUrl = `https://github.com/${REPO}/releases/download/${tag}/sqlite-admin-src.zip`
  console.log(`downloading ${tag}...`)
  const res = await fetch(zipUrl, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`GET ${zipUrl} → ${res.status}`)
  const zip = new Uint8Array(await res.arrayBuffer())

  await extractAndApply(zip, installDir)
  console.log(`updated to v${remoteVersion}`)
}

// ---------- install-dir resolution ----------

function resolveInstallDir() {
  if (process.env.SQLITE_ADMIN_INSTALL_DIR) {
    return path.resolve(process.env.SQLITE_ADMIN_INSTALL_DIR)
  }

  // The shim written by install.sh is: exec bun "$INSTALL_DIR/server.js" "$@"
  // So argv[1] == $INSTALL_DIR/server.js when running through the shim.
  const entry = process.argv[1]
  if (entry && path.basename(entry) === 'server.js') {
    return path.dirname(path.resolve(entry))
  }

  throw new Error(
    [
      'cannot determine install directory.',
      '',
      "'sqlite-admin update' updates a source install created by install.sh.",
      'Set SQLITE_ADMIN_INSTALL_DIR if you installed to a custom path, or reinstall:',
      `  curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | bash`,
    ].join('\n')
  )
}

async function assertNotDevCheckout(installDir) {
  try {
    const s = await fs.stat(path.join(installDir, '.git'))
    if (s.isDirectory() || s.isFile()) {
      throw new Error(
        [
          `refusing to update ${installDir}: looks like a git checkout (has .git).`,
          '',
          "'sqlite-admin update' updates a source install (~/.local/share/sqlite-admin).",
          "For a dev checkout, use 'git pull'.",
        ].join('\n')
      )
    }
  } catch (e) {
    if (e?.code === 'ENOENT') return
    throw e
  }
}

// ---------- GitHub release ----------

async function resolveLatestTag() {
  console.log('checking latest release...')
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/releases/latest`,
    { signal: AbortSignal.timeout(10_000) }
  )
  if (!res.ok) throw new Error(`GitHub API → ${res.status}`)
  const data = await res.json()
  const tag = String(data.tag_name ?? '')
  if (!tag) throw new Error('could not determine latest release from GitHub API')
  console.log(`latest release: ${tag}`)
  return tag
}

// ---------- extract + apply ----------

async function extractAndApply(zip, installDir) {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-admin-update-'))
  try {
    const zipPath = path.join(work, 'sqlite-admin-src.zip')
    await fs.writeFile(zipPath, zip)
    const extracted = path.join(work, 'extracted')
    await fs.mkdir(extracted)
    await runCmd(['unzip', '-oq', zipPath, '-d', extracted], work)
    await applySource(extracted, installDir)
  } finally {
    await fs.rm(work, { recursive: true, force: true })
  }
}

async function applySource(src, installDir) {
  await fs.mkdir(installDir, { recursive: true })
  for (const name of TRACKED) {
    await fs.rm(path.join(installDir, name), { recursive: true, force: true })
  }
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const e of entries) {
    await fs.cp(path.join(src, e.name), path.join(installDir, e.name), {
      recursive: true,
      force: true,
    })
  }
}

async function runCmd(argv, cwd) {
  const proc = Bun.spawn(argv, { cwd, stdout: 'inherit', stderr: 'inherit' })
  const exit = await proc.exited
  if (exit !== 0) throw new Error(`${argv.join(' ')} failed (exit ${exit})`)
}
