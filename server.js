import { handleRequest } from './src/SqliteAdmin.mjs'

const args = process.argv.slice(2)
const argPort = args.includes('--port') ? args[args.indexOf('--port') + 1] : null

const port = parseInt(argPort ?? process.env.PORT ?? '4269', 10)
const routeBase = process.env.SQLITE_ADMIN_BASE_PATH ?? '/sqlite-admin'

const server = Bun.serve({ port, fetch: handleRequest })

console.log(`SQLite Admin running at http://localhost:${server.port}${routeBase}`)
