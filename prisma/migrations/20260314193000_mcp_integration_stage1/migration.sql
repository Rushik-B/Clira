-- CreateEnum
CREATE TYPE "McpTransportType" AS ENUM ('STDIO', 'STREAMABLE_HTTP');

-- CreateEnum
CREATE TYPE "McpAuthMode" AS ENUM ('NONE', 'BEARER_TOKEN', 'STATIC_HEADER');

-- CreateEnum
CREATE TYPE "McpConnectionStatus" AS ENUM ('PENDING', 'SYNCED', 'DEGRADED', 'DISABLED');

-- CreateEnum
CREATE TYPE "McpTrustClass" AS ENUM ('FIRST_PARTY', 'USER_CONFIGURED', 'THIRD_PARTY');

-- CreateEnum
CREATE TYPE "McpActionClass" AS ENUM ('READ', 'WRITE', 'DELETE', 'SIDE_EFFECTFUL');

-- CreateEnum
CREATE TYPE "McpLatencyClass" AS ENUM ('FAST', 'STANDARD', 'SLOW');

-- CreateTable
CREATE TABLE "McpConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serverKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "transportType" "McpTransportType" NOT NULL,
    "transportConfig" JSONB NOT NULL,
    "authMode" "McpAuthMode" NOT NULL DEFAULT 'NONE',
    "encryptedSecrets" TEXT,
    "status" "McpConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "trustClass" "McpTrustClass" NOT NULL DEFAULT 'USER_CONFIGURED',
    "degradedReason" TEXT,
    "syncDiagnostics" JSONB,
    "healthDiagnostics" JSONB,
    "lastSyncedAt" TIMESTAMP(3),
    "lastHealthCheckedAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "circuitOpenedAt" TIMESTAMP(3),
    "circuitOpenUntil" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpToolManifest" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "toolSlug" TEXT NOT NULL,
    "modelToolName" TEXT NOT NULL,
    "displayTitle" TEXT NOT NULL,
    "description" TEXT,
    "inputSchema" JSONB NOT NULL,
    "outputSchema" JSONB,
    "annotations" JSONB,
    "actionClass" "McpActionClass" NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "latencyClass" "McpLatencyClass" NOT NULL DEFAULT 'STANDARD',
    "safeForAutoUse" BOOLEAN NOT NULL DEFAULT false,
    "syncDiagnostics" JSONB,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpToolManifest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpExecutionAudit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "modelToolName" TEXT NOT NULL,
    "actionClass" "McpActionClass" NOT NULL,
    "args" JSONB,
    "resultSummary" JSONB,
    "latencyMs" INTEGER,
    "cacheHit" BOOLEAN NOT NULL DEFAULT false,
    "freshness" JSONB,
    "degraded" BOOLEAN NOT NULL DEFAULT false,
    "errorClass" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpExecutionAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "McpConnection_userId_serverKey_key"
ON "McpConnection"("userId", "serverKey");

-- CreateIndex
CREATE INDEX "McpConnection_userId_status_idx"
ON "McpConnection"("userId", "status");

-- CreateIndex
CREATE INDEX "McpConnection_userId_updatedAt_idx"
ON "McpConnection"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "McpToolManifest_connectionId_toolName_key"
ON "McpToolManifest"("connectionId", "toolName");

-- CreateIndex
CREATE UNIQUE INDEX "McpToolManifest_connectionId_modelToolName_key"
ON "McpToolManifest"("connectionId", "modelToolName");

-- CreateIndex
CREATE INDEX "McpToolManifest_connectionId_capabilityId_idx"
ON "McpToolManifest"("connectionId", "capabilityId");

-- CreateIndex
CREATE INDEX "McpToolManifest_connectionId_actionClass_idx"
ON "McpToolManifest"("connectionId", "actionClass");

-- CreateIndex
CREATE INDEX "McpExecutionAudit_userId_createdAt_idx"
ON "McpExecutionAudit"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "McpExecutionAudit_connectionId_createdAt_idx"
ON "McpExecutionAudit"("connectionId", "createdAt");

-- CreateIndex
CREATE INDEX "McpExecutionAudit_connectionId_toolName_createdAt_idx"
ON "McpExecutionAudit"("connectionId", "toolName", "createdAt");

-- AddForeignKey
ALTER TABLE "McpConnection"
ADD CONSTRAINT "McpConnection_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpToolManifest"
ADD CONSTRAINT "McpToolManifest_connectionId_fkey"
FOREIGN KEY ("connectionId") REFERENCES "McpConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpExecutionAudit"
ADD CONSTRAINT "McpExecutionAudit_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpExecutionAudit"
ADD CONSTRAINT "McpExecutionAudit_connectionId_fkey"
FOREIGN KEY ("connectionId") REFERENCES "McpConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
