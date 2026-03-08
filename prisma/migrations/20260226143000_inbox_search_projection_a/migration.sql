-- Phase 1 / Migration A: projection tables, btree + GIN indexes, RLS

-- Create pgvector extension for embedding storage
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "InboxBackfillState" AS ENUM ('PENDING', 'SEEDING', 'BACKFILLING', 'COMPLETE', 'PAUSED_AUTH_REVOKED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "InboxSearchDocument" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "mailboxId" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "from" TEXT NOT NULL,
  "to" TEXT[] NOT NULL,
  "cc" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "subject" TEXT NOT NULL,
  "snippet" TEXT,
  "bodyText" TEXT NOT NULL,
  "sentAt" TIMESTAMP(3) NOT NULL,
  "hasAttachment" BOOLEAN NOT NULL DEFAULT false,
  "contentHash" TEXT NOT NULL,
  "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "isDeleted" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "InboxSearchDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "InboxSearchChunk" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "chunkIndex" INTEGER NOT NULL,
  "chunkText" TEXT NOT NULL,
  "tokenCount" INTEGER NOT NULL,
  "embedding" vector(768),
  "embeddingModel" TEXT,
  "embeddedAt" TIMESTAMP(3),
  CONSTRAINT "InboxSearchChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "InboxSearchCheckpoint" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "mailboxId" TEXT NOT NULL,
  "lastHistoryIdIndexed" TEXT,
  "backfillState" "InboxBackfillState" NOT NULL DEFAULT 'PENDING',
  "lastBackfillCursor" TEXT,
  "lastIndexedAt" TIMESTAMP(3),
  "lagEstimate" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InboxSearchCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "InboxSearchDocument_mailboxId_messageId_key"
ON "InboxSearchDocument"("mailboxId", "messageId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InboxSearchDocument_userId_sentAt_idx"
ON "InboxSearchDocument"("userId", "sentAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InboxSearchDocument_userId_mailboxId_sentAt_idx"
ON "InboxSearchDocument"("userId", "mailboxId", "sentAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InboxSearchDocument_userId_from_idx"
ON "InboxSearchDocument"("userId", "from");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "InboxSearchChunk_documentId_chunkIndex_key"
ON "InboxSearchChunk"("documentId", "chunkIndex");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InboxSearchChunk_documentId_idx"
ON "InboxSearchChunk"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "InboxSearchCheckpoint_userId_mailboxId_key"
ON "InboxSearchCheckpoint"("userId", "mailboxId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InboxSearchCheckpoint_backfillState_lastIndexedAt_idx"
ON "InboxSearchCheckpoint"("backfillState", "lastIndexedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InboxSearchDocument_fts_idx"
ON "InboxSearchDocument"
USING GIN (to_tsvector('english', COALESCE("subject", '') || ' ' || COALESCE("bodyText", '')));

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'InboxSearchDocument_userId_fkey'
  ) THEN
    ALTER TABLE "InboxSearchDocument"
    ADD CONSTRAINT "InboxSearchDocument_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'InboxSearchDocument_mailboxId_fkey'
  ) THEN
    ALTER TABLE "InboxSearchDocument"
    ADD CONSTRAINT "InboxSearchDocument_mailboxId_fkey"
    FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'InboxSearchChunk_documentId_fkey'
  ) THEN
    ALTER TABLE "InboxSearchChunk"
    ADD CONSTRAINT "InboxSearchChunk_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "InboxSearchDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'InboxSearchCheckpoint_userId_fkey'
  ) THEN
    ALTER TABLE "InboxSearchCheckpoint"
    ADD CONSTRAINT "InboxSearchCheckpoint_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'InboxSearchCheckpoint_mailboxId_fkey'
  ) THEN
    ALTER TABLE "InboxSearchCheckpoint"
    ADD CONSTRAINT "InboxSearchCheckpoint_mailboxId_fkey"
    FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Enable RLS
ALTER TABLE "InboxSearchDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InboxSearchDocument" FORCE ROW LEVEL SECURITY;
ALTER TABLE "InboxSearchChunk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InboxSearchChunk" FORCE ROW LEVEL SECURITY;
ALTER TABLE "InboxSearchCheckpoint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InboxSearchCheckpoint" FORCE ROW LEVEL SECURITY;

-- RLS policies for user scoping
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'InboxSearchDocument'
      AND policyname = 'InboxSearchDocument_user_scope_policy'
  ) THEN
    CREATE POLICY "InboxSearchDocument_user_scope_policy"
      ON "InboxSearchDocument"
      USING ("userId" = current_setting('app.current_user_id', true))
      WITH CHECK ("userId" = current_setting('app.current_user_id', true));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'InboxSearchCheckpoint'
      AND policyname = 'InboxSearchCheckpoint_user_scope_policy'
  ) THEN
    CREATE POLICY "InboxSearchCheckpoint_user_scope_policy"
      ON "InboxSearchCheckpoint"
      USING ("userId" = current_setting('app.current_user_id', true))
      WITH CHECK ("userId" = current_setting('app.current_user_id', true));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'InboxSearchChunk'
      AND policyname = 'InboxSearchChunk_user_scope_policy'
  ) THEN
    CREATE POLICY "InboxSearchChunk_user_scope_policy"
      ON "InboxSearchChunk"
      USING (
        EXISTS (
          SELECT 1
          FROM "InboxSearchDocument" d
          WHERE d."id" = "InboxSearchChunk"."documentId"
            AND d."userId" = current_setting('app.current_user_id', true)
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM "InboxSearchDocument" d
          WHERE d."id" = "InboxSearchChunk"."documentId"
            AND d."userId" = current_setting('app.current_user_id', true)
        )
      );
  END IF;
END $$;
