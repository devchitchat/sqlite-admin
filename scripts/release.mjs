#!/usr/bin/env bun
// Release orchestrator — bumps version, commits, tags, and packages.
//
// Usage:
//   bun scripts/release.mjs              → auto-detect bump from commits
//   bun scripts/release.mjs breaking     → force major bump
//   bun scripts/release.mjs fix          → force minor bump (bug fixes)
//   bun scripts/release.mjs patch        → force patch bump
//   bun scripts/release.mjs --dry-run    → preview without making changes
//   bun scripts/release.mjs --force      → allow dirty working tree

import * as path from 'node:path'
import * as fs from 'node:fs/promises'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const force = args.includes('--force')
const explicitBump = args.find(a => ['breaking', 'fix', 'patch'].includes(a)) ?? null

// --- helpers ---

const run = async (cmd, opts = {}) => {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', ...opts })
  const [out, err, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exit !== 0 && !opts.ignoreError) throw new Error(`${cmd.join(' ')} failed:\n${err.trim()}`)
  return out.trim()
}

const isBreaking = (msg) => /^[a-z]+(\([^)]+\))?!:/.test(msg) || /^BREAKING[- ]CHANGE/i.test(msg)
const isFix = (msg) => /^fix(\([^)]+\))?:/.test(msg)

// --- working tree check ---

if (!force) {
  const status = await run(['git', 'status', '--porcelain'])
  if (status) {
    console.error('error: working tree is dirty. Commit or stash changes first.')
    console.error('       Run with --force to override.')
    process.exit(1)
  }
}

// --- read current version ---

const pkgPath = path.resolve(import.meta.dir, '../package.json')
const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'))
const [major, minor, patch] = pkg.version.split('.').map(Number)

// --- detect bump type ---

let bump = explicitBump
if (!bump) {
  const lastTag = await run(['git', 'describe', '--tags', '--abbrev=0'], { ignoreError: true })
  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD'
  const commits = await run(['git', 'log', range, '--oneline'])
  const msgs = commits ? commits.split('\n').map(l => l.replace(/^[0-9a-f]+ /, '')) : []

  if (msgs.some(isBreaking)) bump = 'breaking'
  else if (msgs.some(isFix)) bump = 'fix'
  else bump = 'patch'

  console.log(`==> detected bump type: ${bump} (from ${msgs.length} commit(s))`)
}

// --- compute new version ---

let newVersion
if (bump === 'breaking') newVersion = `${major + 1}.0.0`
else if (bump === 'fix') newVersion = `${major}.${minor + 1}.0`
else newVersion = `${major}.${minor}.${patch + 1}`

const tag = `v${newVersion}`
console.log(`==> ${pkg.version} → ${newVersion} (${tag})`)

if (dryRun) {
  console.log('(dry run — no changes made)')
  process.exit(0)
}

// --- update package.json ---

pkg.version = newVersion
await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log(`==> updated package.json to ${newVersion}`)

// --- commit and tag ---

await run(['git', 'add', 'package.json'])
await run(['git', 'commit', '-m', `release ${tag}`])
await run(['git', 'tag', tag])
console.log(`==> committed and tagged ${tag}`)

// --- build zip ---

console.log('==> packaging...')
await run(['bun', 'run', 'package'], { stdout: 'inherit', stderr: 'inherit' })

// --- done ---

console.log('')
console.log(`${tag} is ready. Push it:`)
console.log('  git push && git push --tags')
