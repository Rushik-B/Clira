ALTER TABLE "EmailSort"
ALTER COLUMN "batchSortJobId" DROP NOT NULL;

ALTER TABLE "EmailSort"
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'batch_sort',
ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "EmailSort_dedupeKey_key" ON "EmailSort"("dedupeKey");
