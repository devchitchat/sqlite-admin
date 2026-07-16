#!/usr/bin/env bun
// Build a deliverable zip of the sqlite-admin source tree.
//
// Usage:
//   bun scripts/package.mjs                   → writes sqlite-admin-src.zip to repo root
//   bun scripts/package.mjs dist/custom.zip   → custom output path

import * as path from 'node:path'
import * as fs from 'node:fs/promises'

const SOURCE_FILES = ['src', 'server.js', 'package.json', 'README.md']
const EXCLUDED = ['node_modules/*', 'sqlite-admin-src.zip', '.git/*', '**/.DS_Store']

const root = path.resolve(import.meta.dir, '..')
const args = process.argv.slice(2)
const out = args[0] ?? path.join(root, 'sqlite-admin-src.zip')
const absOut = path.resolve(out)

try { await fs.unlink(absOut) } catch {}

const present = []
for (const f of SOURCE_FILES) {
  try { await fs.stat(path.join(root, f)); present.push(f) } catch {}
}
if (present.length === 0) throw new Error(`no source files found under ${root}`)

const proc = Bun.spawn(['zip', '-rq', absOut, ...present, '-x', ...EXCLUDED], {
  cwd: root,
  stdout: 'pipe',
  stderr: 'pipe',
})
const exit = await proc.exited
if (exit !== 0) {
  const err = await new Response(proc.stderr).text()
  throw new Error(`zip failed (exit ${exit}): ${err.trim()}`)
}

const size = Bun.file(absOut).size
console.log(`wrote ${absOut} (${formatBytes(size)})`)
console.log('included:')
for (const f of present) console.log(`  ${f}`)

function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}
