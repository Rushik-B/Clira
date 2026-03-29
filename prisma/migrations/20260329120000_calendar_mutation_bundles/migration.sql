ALTER TYPE "PendingCalendarChangeStatus" ADD VALUE IF NOT EXISTS 'FAILED';
ALTER TYPE "PendingCalendarChangeStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED';

ALTER TABLE "PendingCalendarChange"
ADD COLUMN "failure" JSONB,
ADD COLUMN "failedAt" TIMESTAMP(3),
ADD COLUMN "supersededAt" TIMESTAMP(3);
