import { handleRequest } from './src/SqliteAdmin.mjs'

const args = process.argv.slice(2)

if (args[0] === 'update') {
  const { runUpdate } = await import('./src/update.mjs')
  const ref = args.includes('--ref') ? args[args.indexOf('--ref') + 1] : undefined
  const force = args.includes('--force')
  try {
    await runUpdate({ ref, force })
  } catch (e) {
    console.error('error:', e.message)
    process.exit(1)
  }
  process.exit(0)
}

const argPort = args.includes('--port') ? args[args.indexOf('--port') + 1] : null
const port = parseInt(argPort ?? process.env.PORT ?? '4269', 10)
const routeBase = process.env.SQLITE_ADMIN_BASE_PATH ?? '/sqlite-admin'

const server = Bun.serve({ port, fetch: handleRequest })

console.log(`SQLite Admin running at http://localhost:${server.port}${routeBase}`)
