-- CreateTable
CREATE TABLE "ReplyInstructionDoc" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeKey" TEXT,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReplyInstructionDoc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReplyInstructionDoc_userId_target_scope_scopeKey_isActive_idx"
ON "ReplyInstructionDoc"("userId", "target", "scope", "scopeKey", "isActive");

-- CreateIndex
CREATE INDEX "ReplyInstructionDoc_userId_isActive_idx"
ON "ReplyInstructionDoc"("userId", "isActive");

-- AddForeignKey
ALTER TABLE "ReplyInstructionDoc"
ADD CONSTRAINT "ReplyInstructionDoc_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
