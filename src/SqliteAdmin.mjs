import path from 'node:path'
import { Database } from 'bun:sqlite'

const DEFAULT_ROUTE = '/sqlite-admin'
const MAX_DEFAULT_ROWS = 100

const escapeHtml = (value) => {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

const normalizeLimit = (rawLimit) => {
  const parsed = Number.parseInt(rawLimit, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return MAX_DEFAULT_ROWS
  }
  return Math.min(parsed, 1000)
}

const parseCookies = (req) => {
  const header = req.headers.get('cookie') ?? ''
  if (!header) return {}
  return Object.fromEntries(
    header.split(';').flatMap((part) => {
      const idx = part.indexOf('=')
      if (idx === -1) return []
      return [[decodeURIComponent(part.slice(0, idx).trim()), decodeURIComponent(part.slice(idx + 1).trim())]]
    })
  )
}

const getDbPath = (req) => {
  const cookies = parseCookies(req)
  const raw = cookies.db_path || process.env.DB_FILE_PATH || ''
  if (!raw) return null
  return path.resolve(process.cwd(), raw)
}

const withDatabase = (dbPath, callback) => {
  const db = new Database(dbPath)
  try {
    return callback(db, dbPath)
  } finally {
    db.close()
  }
}

const formatBytes = (value) => {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) {
    return 'Unknown'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  const precision = unitIndex === 0 ? 0 : size >= 10 ? 1 : 2
  return `${size.toFixed(precision)} ${units[unitIndex]}`
}

const getTableSizes = (db) => {
  try {
    const sql = `
      SELECT name, SUM(pgsize) AS sizeBytes
      FROM dbstat
      WHERE name NOT LIKE 'sqlite_%'
      GROUP BY name
    `
    const rows = db.prepare(sql).all()
    return new Map(rows.map((row) => [row.name, Number(row.sizeBytes) || 0]))
  } catch {
    return new Map()
  }
}

const listTables = (db) => {
  const tableSizes = getTableSizes(db)
  const sql = `
    SELECT name
    FROM sqlite_master
    WHERE type='table'
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `
  return db.prepare(sql).all().map((table) => ({
    ...table,
    sizeBytes: tableSizes.get(table.name) ?? null
  }))
}

const getTableInfo = (db, tableName) => {
  return db.prepare(`PRAGMA table_info("${tableName.replaceAll('"', '""')}")`).all()
}

const getCreateStatement = (db, tableName) => {
  const row = db.prepare(`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'table'
      AND name = ?
  `).get(tableName)
  return row?.sql ?? ''
}

const runSql = (db, sql) => {
  const trimmed = sql.trim()
  if (!trimmed) {
    return { kind: 'empty' }
  }

  const isReader = /^(select|with|pragma|explain)\b/i.test(trimmed)
  const statement = db.prepare(trimmed)

  if (isReader) {
    return {
      kind: 'rows',
      rows: statement.all()
    }
  }

  const result = statement.run()
  return {
    kind: 'run',
    changes: result.changes ?? 0,
    lastInsertRowid: result.lastInsertRowid ?? null
  }
}

const renderRows = (rows) => {
  if (!rows || rows.length === 0) {
    return '<p>No rows returned.</p>'
  }

  const columns = Object.keys(rows[0] ?? {})
  const header = columns.map((col) => `<th>${escapeHtml(col)}</th>`).join('')
  const body = rows
    .map((row) => {
      const cells = columns
        .map((col) => `<td><pre>${escapeHtml(JSON.stringify(row[col]))}</pre></td>`)
        .join('')
      return `<tr>${cells}</tr>`
    })
    .join('')

  return `<div class="table-wrap"><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>`
}

const renderSchema = (tableInfo, createSql) => {
  if (!tableInfo || tableInfo.length === 0) {
    return '<p>No schema metadata found.</p>'
  }

  const body = tableInfo.map((col) => {
    return `<tr>
      <td>${escapeHtml(col.cid)}</td>
      <td>${escapeHtml(col.name)}</td>
      <td>${escapeHtml(col.type)}</td>
      <td>${escapeHtml(col.notnull ? 'YES' : 'NO')}</td>
      <td><pre>${escapeHtml(col.dflt_value)}</pre></td>
      <td>${escapeHtml(col.pk ? 'YES' : 'NO')}</td>
    </tr>`
  }).join('')

  const createBlock = createSql
    ? `<h4 style="margin:12px 0 6px;">CREATE SQL</h4><div class="table-wrap"><pre style="padding:10px;">${escapeHtml(createSql)}</pre></div>`
    : ''

  return `<h4 style="margin:0 0 6px;">Columns</h4>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>cid</th>
          <th>name</th>
          <th>type</th>
          <th>not null</th>
          <th>default</th>
          <th>pk</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  </div>
  ${createBlock}`
}

const renderPage = ({
  routeBase,
  dbPath,
  tables,
  selectedTable = '',
  selectedTableSizeBytes = null,
  limit = MAX_DEFAULT_ROWS,
  query = '',
  queryResultHtml = '',
  schemaHtml = '',
  tableRowsHtml = '',
  flash = ''
}) => {
  const tableLinks = tables
    .map(({ name, sizeBytes }) => `<li><a href="${routeBase}/table/${encodeURIComponent(name)}?limit=${limit}">${escapeHtml(name)}</a>${sizeBytes == null ? '' : ` <span style="color:var(--muted)">(${escapeHtml(formatBytes(sizeBytes))})</span>`}</li>`)
    .join('')

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SQLite Admin</title>
    <style>
      :root {
        --bg: #f7f4ea;
        --text: #1f1f1f;
        --muted: #555;
        --card: #ffffff;
        --line: #d5cfbf;
        --accent: #1e6f57;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "IBM Plex Sans", ui-sans-serif, -apple-system, sans-serif;
        color: var(--text);
        background: radial-gradient(circle at 12% -10%, #f2e7b9, transparent 35%), var(--bg);
      }
      main {
        max-width: 1100px;
        margin: 24px auto;
        padding: 0 16px 24px;
      }
      h1, h2, h3 { margin: 0 0 10px; }
      .meta {
        margin-bottom: 16px;
        color: var(--muted);
        font-size: 14px;
      }
      .grid {
        display: grid;
        grid-template-columns: 280px 1fr;
        gap: 16px;
      }
      .card {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 14px;
      }
      .table-list {
        margin: 0;
        padding-left: 18px;
        max-height: 500px;
        overflow: auto;
      }
      .table-list li { margin-bottom: 6px; }
      a {
        color: var(--accent);
        text-decoration: none;
      }
      a:hover { text-decoration: underline; }
      textarea, input {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 10px;
        font: inherit;
      }
      textarea {
        min-height: 130px;
        font-family: "IBM Plex Mono", ui-monospace, monospace;
      }
      label {
        display: block;
        margin: 8px 0 6px;
        font-weight: 600;
      }
      .db-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 16px;
        flex-wrap: wrap;
      }
      .db-bar label {
        margin: 0;
        font-size: 13px;
        color: var(--muted);
        white-space: nowrap;
      }
      .db-bar input[type="text"] {
        flex: 1;
        min-width: 200px;
        font-family: "IBM Plex Mono", ui-monospace, monospace;
        font-size: 13px;
        padding: 6px 10px;
        border-radius: 6px;
      }
      .btn {
        margin-top: 10px;
        border: none;
        border-radius: 8px;
        padding: 10px 12px;
        background: var(--accent);
        color: white;
        font-weight: 600;
        cursor: pointer;
      }
      .btn-sm {
        margin-top: 0;
        border: none;
        border-radius: 6px;
        padding: 6px 12px;
        background: var(--accent);
        color: white;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
      }
      .flash {
        margin: 8px 0 14px;
        border: 1px solid #cf9c9c;
        background: #fae1e1;
        color: #7a2020;
        border-radius: 8px;
        padding: 10px;
      }
      .table-wrap {
        overflow: auto;
        max-width: 100%;
        border: 1px solid var(--line);
        border-radius: 8px;
      }
      table {
        border-collapse: collapse;
        width: 100%;
        min-width: 700px;
      }
      th, td {
        border-bottom: 1px solid var(--line);
        padding: 8px;
        text-align: left;
        vertical-align: top;
      }
      th {
        position: sticky;
        top: 0;
        background: #ece7d9;
      }
      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
      }
      @media (max-width: 900px) {
        .grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <h1>SQLite Admin</h1>
      <form class="db-bar" method="post" action="${routeBase}/set-db">
        <label for="db_path">Database</label>
        <input id="db_path" name="db_path" type="text" value="${escapeHtml(dbPath)}" placeholder="/path/to/database.db" spellcheck="false" />
        <button class="btn-sm" type="submit">Open</button>
      </form>
      ${flash ? `<div class="flash">${escapeHtml(flash)}</div>` : ''}
      <div class="grid">
        <aside class="card">
          <h2>Tables (${tables.length})</h2>
          <ul class="table-list">${tableLinks || '<li><em>No tables found</em></li>'}</ul>
        </aside>
        <section class="card">
          <h2>Run SQL</h2>
          <form method="post" action="${routeBase}/query">
            <label for="query">SQL</label>
            <textarea id="query" name="query" spellcheck="false">${escapeHtml(query)}</textarea>
            <label for="limit">Preview row limit</label>
            <input id="limit" name="limit" type="number" min="1" max="1000" value="${limit}" />
            <button class="btn" type="submit">Execute</button>
          </form>
          ${queryResultHtml}
        </section>
      </div>
      ${selectedTable ? `<section class="card" style="margin-top:16px;"><h3>Table: ${escapeHtml(selectedTable)}${selectedTableSizeBytes == null ? '' : ` <span style="font-weight:400;color:var(--muted)">(${escapeHtml(formatBytes(selectedTableSizeBytes))} on disk)</span>`}</h3><div style="margin:10px 0 14px;">${schemaHtml}</div>${tableRowsHtml}</section>` : ''}
    </main>
  </body>
</html>`
}

const html = (body, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })

const routeBase = () => process.env.SQLITE_ADMIN_BASE_PATH || DEFAULT_ROUTE

export const handleRequest = async (req) => {
  const url = new URL(req.url)
  const base = routeBase()
  const { pathname } = url

  if (req.method === 'POST' && pathname === `${base}/set-db`) {
    const formData = await req.formData()
    const rawPath = String(formData.get('db_path') ?? '').trim()
    const cookie = rawPath
      ? `db_path=${encodeURIComponent(rawPath)}; Path=/; HttpOnly; SameSite=Lax`
      : `db_path=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
    return new Response(null, { status: 303, headers: { Location: base, 'Set-Cookie': cookie } })
  }

  if (req.method === 'GET' && pathname === base) {
    const dbPath = getDbPath(req)
    if (!dbPath) {
      return html(renderPage({ routeBase: base, dbPath: '', tables: [], flash: 'Enter a database path above to get started.' }))
    }
    try {
      const payload = withDatabase(dbPath, (db, resolvedPath) => ({ dbPath: resolvedPath, tables: listTables(db) }))
      return html(renderPage({ routeBase: base, dbPath: payload.dbPath, tables: payload.tables }))
    } catch (error) {
      return html(renderPage({ routeBase: base, dbPath, tables: [], flash: error.message }), 500)
    }
  }

  const tablePattern = new RegExp(`^${base}/table/([^/]+)$`)
  const tableMatch = pathname.match(tablePattern)
  if (req.method === 'GET' && tableMatch) {
    const tableName = decodeURIComponent(tableMatch[1])
    const limit = normalizeLimit(url.searchParams.get('limit'))
    const dbPath = getDbPath(req)
    if (!dbPath) {
      return new Response(null, { status: 303, headers: { Location: base } })
    }
    try {
      const payload = withDatabase(dbPath, (db, resolvedPath) => {
        const tables = listTables(db)
        const exists = tables.find((t) => t.name === tableName)
        if (!exists) throw new Error(`Table "${tableName}" does not exist.`)

        const tableInfo = getTableInfo(db, tableName)
        const createSql = getCreateStatement(db, tableName)
        const columns = tableInfo.map((col) => col.name)
        const columnSql = columns.length > 0
          ? columns.map((name) => `"${name.replaceAll('"', '""')}"`).join(', ')
          : '*'
        const rows = db.prepare(`SELECT ${columnSql} FROM "${tableName.replaceAll('"', '""')}" LIMIT ?`).all(limit)

        return { dbPath: resolvedPath, tables, rows, tableInfo, createSql, selectedTableSizeBytes: exists.sizeBytes ?? null }
      })

      return html(renderPage({
        routeBase: base,
        dbPath: payload.dbPath,
        tables: payload.tables,
        selectedTable: tableName,
        selectedTableSizeBytes: payload.selectedTableSizeBytes,
        limit,
        schemaHtml: renderSchema(payload.tableInfo, payload.createSql),
        tableRowsHtml: renderRows(payload.rows)
      }))
    } catch (error) {
      return html(renderPage({ routeBase: base, dbPath, tables: [], flash: error.message }), 400)
    }
  }

  if (req.method === 'POST' && pathname === `${base}/query`) {
    const formData = await req.formData()
    const query = String(formData.get('query') ?? '')
    const limit = normalizeLimit(formData.get('limit'))
    const dbPath = getDbPath(req)
    if (!dbPath) {
      return new Response(null, { status: 303, headers: { Location: base } })
    }

    try {
      const payload = withDatabase(dbPath, (db, resolvedPath) => {
        const tables = listTables(db)
        const result = runSql(db, query)
        return { dbPath: resolvedPath, tables, result }
      })

      let resultHtml = ''
      if (payload.result.kind === 'empty') {
        resultHtml = '<p>No SQL submitted.</p>'
      } else if (payload.result.kind === 'rows') {
        resultHtml = `<h3>Query Results</h3>${renderRows(payload.result.rows)}`
      } else {
        resultHtml = `<h3>Statement Result</h3><p>Changes: <strong>${payload.result.changes}</strong>${
          payload.result.lastInsertRowid != null ? ` | Last Insert RowID: <strong>${escapeHtml(payload.result.lastInsertRowid)}</strong>` : ''
        }</p>`
      }

      return html(renderPage({
        routeBase: base,
        dbPath: payload.dbPath,
        tables: payload.tables,
        limit,
        query,
        queryResultHtml: resultHtml
      }))
    } catch (error) {
      try {
        const fallback = withDatabase(dbPath, (db, resolvedPath) => ({ dbPath: resolvedPath, tables: listTables(db) }))
        return html(renderPage({
          routeBase: base,
          dbPath: fallback.dbPath,
          tables: fallback.tables,
          limit,
          query,
          flash: error.message
        }), 400)
      } catch (innerError) {
        return html(renderPage({ routeBase: base, dbPath, tables: [], limit, query, flash: innerError.message }), 500)
      }
    }
  }

  return new Response('Not Found', { status: 404 })
}

export { formatBytes, listTables }
