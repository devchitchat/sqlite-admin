import { describe, it, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { formatBytes, listTables } from '../src/SqliteAdmin.mjs'

describe('SqliteAdmin', () => {
  it('formats byte sizes for display', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.00 KB')
  })

  it('returns per-table size information when dbstat is available', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-admin-test-'))
    const dbPath = path.join(tempDir, 'test.sqlite')

    try {
      const db = new Database(dbPath)
      db.exec(`
        CREATE TABLE widgets (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL
        );
        INSERT INTO widgets (name) VALUES ('alpha'), ('beta'), ('gamma');
      `)

      const tables = listTables(db)
      db.close()

      expect(tables.map(({ name }) => name)).toEqual(['widgets'])
      expect(typeof tables[0].sizeBytes).toBe('number')
      expect(tables[0].sizeBytes).toBeGreaterThan(0)
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
})
