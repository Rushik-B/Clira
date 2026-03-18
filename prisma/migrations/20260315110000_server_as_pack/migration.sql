ALTER TABLE "McpConnection"
ADD COLUMN "packDescription" TEXT;

DROP INDEX IF EXISTS "McpToolManifest_connectionId_capabilityId_idx";

ALTER TABLE "McpToolManifest"
DROP COLUMN "capabilityId";

ALTER TABLE "PendingMcpAction"
DROP COLUMN "capabilityId";
