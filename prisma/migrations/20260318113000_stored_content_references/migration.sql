-- Create durable stored content references so content refs can survive process
-- restarts and be reused for downstream delivery actions.
CREATE TABLE "StoredContentReference" (
    "id" TEXT NOT NULL,
    "contentRefId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "locator" TEXT NOT NULL,
    "displayName" TEXT,
    "mimeHint" TEXT,
    "trustClass" TEXT NOT NULL,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "capability" TEXT NOT NULL,
    "provenance" JSONB NOT NULL,
    "data" BYTEA NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoredContentReference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StoredContentReference_contentRefId_key" ON "StoredContentReference"("contentRefId");
CREATE INDEX "StoredContentReference_ownerUserId_createdAt_idx" ON "StoredContentReference"("ownerUserId", "createdAt" DESC);

ALTER TABLE "StoredContentReference"
ADD CONSTRAINT "StoredContentReference_ownerUserId_fkey"
FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
