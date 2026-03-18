-- CreateEnum
CREATE TYPE "PendingMcpActionStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'CONSUMED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "PendingMcpAction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "modelToolName" TEXT NOT NULL,
    "displayTitle" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "actionClass" "McpActionClass" NOT NULL,
    "trustClass" "McpTrustClass" NOT NULL,
    "userRequest" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "previewText" TEXT NOT NULL,
    "previewSummary" JSONB,
    "status" "PendingMcpActionStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "resultSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingMcpAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingMcpAction_userId_conversationId_status_idx"
ON "PendingMcpAction"("userId", "conversationId", "status");

-- CreateIndex
CREATE INDEX "PendingMcpAction_userId_conversationId_createdAt_idx"
ON "PendingMcpAction"("userId", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "PendingMcpAction_connectionId_status_createdAt_idx"
ON "PendingMcpAction"("connectionId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PendingMcpAction_expiresAt_status_idx"
ON "PendingMcpAction"("expiresAt", "status");

-- CreateIndex
CREATE INDEX "PendingMcpAction_idempotencyKey_idx"
ON "PendingMcpAction"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "PendingMcpAction"
ADD CONSTRAINT "PendingMcpAction_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingMcpAction"
ADD CONSTRAINT "PendingMcpAction_connectionId_fkey"
FOREIGN KEY ("connectionId") REFERENCES "McpConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
