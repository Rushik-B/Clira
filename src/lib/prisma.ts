import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// DIRECT_URL is for connection pooler setups (e.g. PgBouncer). For local/Docker
// deployments without a pooler, fall back to DATABASE_URL.
const connectionString = process.env.DIRECT_URL || requireEnv('DATABASE_URL')

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Prisma 7+ requires a Driver Adapter (or Accelerate).
    // We use the Postgres adapter (requires `@prisma/adapter-pg` + `pg`).
    adapter: new PrismaPg({
      connectionString,
    }),
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma