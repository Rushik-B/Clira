// Prisma 7+ reads connection URLs from `prisma.config.ts` (not schema.prisma).
// Note: environment variables in `.env` are NOT loaded automatically by Prisma.
import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: './prisma/schema.prisma',
  migrations: {
    path: './prisma/migrations',
  },
  datasource: {
    // Use a direct connection for migration/introspection tooling.
    // If this is undefined, Prisma CLI commands that need a database connection will fail loudly.
    url: process.env['DIRECT_URL'],
    // Optional shadow database for commands that need it (e.g. `prisma migrate diff --from-migrations ...`).
    // MUST NOT point at your production schema.
    shadowDatabaseUrl: process.env['SHADOW_DATABASE_URL'],
  },
})


