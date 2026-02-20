-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "TelegramConversationStatus" AS ENUM ('ACTIVE', 'PENDING_CONFIRMATION', 'COMPLETED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "TelegramMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "TelegramMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "TelegramPairingStatus" AS ENUM ('PENDING', 'APPROVED', 'EXPIRED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "NotificationDeliveryChannel" AS ENUM ('WHATSAPP', 'TELEGRAM', 'BOTH');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "TelegramConversation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "telegramUserId" TEXT NOT NULL,
  "status" "TelegramConversationStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TelegramConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TelegramMessage" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "telegramUpdateId" INTEGER,
  "telegramMessageId" TEXT,
  "direction" "TelegramMessageDirection" NOT NULL,
  "content" TEXT NOT NULL,
  "role" "TelegramMessageRole" NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TelegramMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TelegramLink" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "telegramUserId" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "telegramUsername" TEXT,
  "telegramFirstName" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3),
  "deactivatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TelegramLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TelegramPairingRequest" (
  "id" TEXT NOT NULL,
  "telegramUserId" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "telegramUsername" TEXT,
  "telegramFirstName" TEXT,
  "pairingCode" TEXT NOT NULL,
  "status" "TelegramPairingStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "approvedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "approvedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TelegramPairingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TelegramPollerState" (
  "id" TEXT NOT NULL,
  "workerKey" TEXT NOT NULL,
  "lastUpdateId" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TelegramPollerState_pkey" PRIMARY KEY ("id")
);

-- AddColumn
ALTER TABLE "UserSettings"
ADD COLUMN IF NOT EXISTS "notificationDeliveryChannel" "NotificationDeliveryChannel" NOT NULL DEFAULT 'BOTH';

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TelegramConversation_userId_chatId_key"
ON "TelegramConversation"("userId", "chatId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TelegramConversation_userId_idx"
ON "TelegramConversation"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TelegramConversation_userId_status_idx"
ON "TelegramConversation"("userId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TelegramConversation_userId_updatedAt_idx"
ON "TelegramConversation"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TelegramMessage_telegramUpdateId_key"
ON "TelegramMessage"("telegramUpdateId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TelegramMessage_conversationId_idx"
ON "TelegramMessage"("conversationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TelegramMessage_conversationId_createdAt_idx"
ON "TelegramMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TelegramMessage_telegramMessageId_idx"
ON "TelegramMessage"("telegramMessageId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TelegramLink_telegramUserId_key"
ON "TelegramLink"("telegramUserId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TelegramLink_userId_idx"
ON "TelegramLink"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TelegramLink_userId_isActive_idx"
ON "TelegramLink"("userId", "isActive");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TelegramLink_userId_updatedAt_idx"
ON "TelegramLink"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TelegramPairingRequest_pairingCode_key"
ON "TelegramPairingRequest"("pairingCode");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TelegramPairingRequest_telegramUserId_chatId_idx"
ON "TelegramPairingRequest"("telegramUserId", "chatId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TelegramPairingRequest_status_expiresAt_idx"
ON "TelegramPairingRequest"("status", "expiresAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TelegramPairingRequest_approvedByUserId_status_idx"
ON "TelegramPairingRequest"("approvedByUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TelegramPollerState_workerKey_key"
ON "TelegramPollerState"("workerKey");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'TelegramConversation_userId_fkey'
  ) THEN
    ALTER TABLE "TelegramConversation"
    ADD CONSTRAINT "TelegramConversation_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'TelegramMessage_conversationId_fkey'
  ) THEN
    ALTER TABLE "TelegramMessage"
    ADD CONSTRAINT "TelegramMessage_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "TelegramConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'TelegramLink_userId_fkey'
  ) THEN
    ALTER TABLE "TelegramLink"
    ADD CONSTRAINT "TelegramLink_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
