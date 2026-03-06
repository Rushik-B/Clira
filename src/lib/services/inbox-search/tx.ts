import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export async function runInboxSearchTransaction<T>(
  userId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
      return fn(tx);
    },
    {
      // Inbox search can perform heavier read-only ranking queries on cold or
      // smaller droplets. The default 5s interactive transaction budget is too
      // tight and can fail after the main query has already completed.
      maxWait: 5_000,
      timeout: 20_000,
    },
  );
}
