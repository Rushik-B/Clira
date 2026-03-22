ALTER TYPE "ReminderStatus" ADD VALUE IF NOT EXISTS 'DELIVERING';

ALTER TABLE "Reminder"
ADD COLUMN IF NOT EXISTS "deliveryClaimId" TEXT;

CREATE INDEX IF NOT EXISTS "Reminder_deliveryClaimId_idx" ON "Reminder"("deliveryClaimId");
