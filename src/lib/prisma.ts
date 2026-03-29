import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  return parsed
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Runtime traffic should use DATABASE_URL so deployments can point app traffic at a
// pooled endpoint while keeping DIRECT_URL reserved for migrations and admin tooling.
const connectionString = requireEnv('DATABASE_URL')
const poolMax = parsePositiveIntEnv('CLIRA_DB_POOL_MAX', 3)

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Prisma 7+ requires a Driver Adapter (or Accelerate).
    // We use the Postgres adapter (requires `@prisma/adapter-pg` + `pg`).
    adapter: new PrismaPg({
      connectionString,
      max: poolMax,
    }),
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
