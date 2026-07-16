import { handleRequest } from './scripts/SqliteAdmin.mjs'

const port = parseInt(process.env.PORT ?? '3000', 10)
const routeBase = process.env.SQLITE_ADMIN_BASE_PATH ?? '/sqlite-admin'

const server = Bun.serve({ port, fetch: handleRequest })

console.log(`SQLite Admin running at http://localhost:${server.port}${routeBase}`)
