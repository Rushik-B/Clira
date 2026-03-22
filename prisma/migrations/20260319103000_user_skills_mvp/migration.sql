-- CreateTable
CREATE TABLE "UserSkill" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "catalogSummary" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSkill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserSkill_userId_slug_key"
ON "UserSkill"("userId", "slug");

-- CreateIndex
CREATE INDEX "UserSkill_userId_archivedAt_enabled_idx"
ON "UserSkill"("userId", "archivedAt", "enabled");

-- CreateIndex
CREATE INDEX "UserSkill_userId_updatedAt_idx"
ON "UserSkill"("userId", "updatedAt");

-- AddForeignKey
ALTER TABLE "UserSkill"
ADD CONSTRAINT "UserSkill_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
