-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ActionHistoryType" AS ENUM ('EMAIL_SENT', 'EMAIL_REJECTED', 'EMAIL_EDITED', 'EMAIL_SNOOZED', 'EMAIL_ARCHIVED', 'CALENDAR_CHANGE_PROPOSED', 'CALENDAR_EVENT_CREATED', 'CALENDAR_EVENT_UPDATED', 'CALENDAR_EVENT_DELETED', 'ALERT_SKIPPED', 'ALERT_NOTIFIED', 'REMINDER_CREATED', 'REMINDER_DELIVERED', 'REMINDER_SNOOZED', 'REMINDER_DISMISSED', 'REMINDER_MISSED', 'MASTER_PROMPT_UPDATED', 'AUTONOMY_RULE_ADDED', 'SETTINGS_CHANGED', 'TRIAGE_ACTION_NEEDED', 'TRIAGE_READ_LATER', 'TRIAGE_FILE', 'TRIAGE_ARCHIVE', 'TRIAGE_DELETE');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'DELIVERED', 'DISMISSED', 'SNOOZED', 'COMPLETED', 'MISSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PendingCalendarChangeStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'CONSUMED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CredentialKind" AS ENUM ('ACCESS_TOKEN', 'REFRESH_TOKEN', 'BOTH');

-- CreateEnum
CREATE TYPE "EmailMappingType" AS ENUM ('EMAIL', 'DOMAIN', 'SUBJECT', 'SUBJECT_CONTAINS', 'SUBJECT_STARTS_WITH', 'SUBJECT_ENDS_WITH', 'SUBJECT_REGEX');

-- CreateEnum
CREATE TYPE "FeedbackAction" AS ENUM ('ACCEPTED', 'EDITED', 'REJECTED');

-- CreateEnum
CREATE TYPE "GeneratedDraftSource" AS ENUM ('AI', 'USER');

-- CreateEnum
CREATE TYPE "OnboardingPersona" AS ENUM ('GUARDIAN', 'COPILOT', 'AMPLIFIER');

-- CreateEnum
CREATE TYPE "ReplyScope" AS ENUM ('ALL_SENDERS', 'CONTACTS_ONLY');

-- CreateEnum
CREATE TYPE "TwilioConversationStatus" AS ENUM ('ACTIVE', 'PENDING_CONFIRMATION', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TwilioMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "TwilioMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "TwilioMessageType" AS ENUM ('SMS', 'RCS', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "WhatsAppConversationStatus" AS ENUM ('ACTIVE', 'PENDING_CONFIRMATION', 'COMPLETED');

-- CreateEnum
CREATE TYPE "WhatsAppMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "WhatsAppMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "TelegramConversationStatus" AS ENUM ('ACTIVE', 'PENDING_CONFIRMATION', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TelegramMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "TelegramMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "TelegramPairingStatus" AS ENUM ('PENDING', 'APPROVED', 'EXPIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "NotificationDeliveryChannel" AS ENUM ('WHATSAPP', 'TELEGRAM', 'BOTH');

-- CreateTable
CREATE TABLE "ActionHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actionType" "ActionHistoryType" NOT NULL,
    "actionSummary" TEXT NOT NULL,
    "actionDetails" JSONB,
    "emailReference" TEXT,
    "confidence" DOUBLE PRECISION,
    "undoable" BOOLEAN NOT NULL DEFAULT false,
    "promptState" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingCalendarChange" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "resolvedTarget" JSONB,
    "userTimezone" TEXT NOT NULL,
    "userRequest" TEXT NOT NULL,
    "status" "PendingCalendarChangeStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingCalendarChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchSortJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "emailsProcessed" INTEGER NOT NULL DEFAULT 0,
    "emailsSorted" INTEGER NOT NULL DEFAULT 0,
    "emailsToReview" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "llmTokensUsed" INTEGER NOT NULL DEFAULT 0,
    "gmailHistoryId" TEXT,

    CONSTRAINT "BatchSortJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Email" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "mailboxId" TEXT,
    "messageId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT[],
    "cc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "snippet" TEXT,
    "isSent" BOOLEAN NOT NULL DEFAULT false,
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "gmailThreadId" TEXT,
    "rfc2822MessageId" TEXT,
    "inReplyTo" TEXT,
    "references" TEXT,
    "isProcessing" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Email_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailCategorizationResult" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categorizedEmails" JSONB NOT NULL,
    "folderSuggestions" JSONB NOT NULL,
    "totalEmailsAnalyzed" INTEGER NOT NULL,
    "categorizationTimeMs" INTEGER NOT NULL,
    "llmTokensUsed" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailCategorizationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLearning" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailFrom" TEXT NOT NULL,
    "originalFolder" TEXT NOT NULL,
    "correctedFolder" TEXT NOT NULL,
    "userReason" TEXT,
    "aiSummary" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailLearning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMapping" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mailboxId" TEXT,
    "labelId" TEXT NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "domain" TEXT,
    "subjectPattern" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mappingType" "EmailMappingType" NOT NULL DEFAULT 'EMAIL',
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "context" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING',
    "recurrence" JSONB,
    "deliveredAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "snoozeCount" INTEGER NOT NULL DEFAULT 0,
    "linkedEmailId" TEXT,
    "linkedEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSort" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mailboxId" TEXT,
    "batchSortJobId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "gmailThreadId" TEXT,
    "confidence" DOUBLE PRECISION,
    "reasoning" TEXT,
    "wasManuallyOverridden" BOOLEAN NOT NULL DEFAULT false,
    "sortedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mailbox" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "displayName" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "gmailHistoryId" TEXT,
    "gmailWatchExpiration" TIMESTAMP(3),
    "gmailWatchResourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mailbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "action" "FeedbackAction" NOT NULL,
    "editDelta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedDraft" (
    "id" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "gmailDraftId" TEXT NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "createdBy" "GeneratedDraftSource" NOT NULL DEFAULT 'AI',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratedDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Label" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mailboxId" TEXT,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "emailCount" INTEGER NOT NULL DEFAULT 0,
    "exampleEmails" JSONB,
    "gmailLabelId" TEXT,
    "isCustom" BOOLEAN NOT NULL DEFAULT true,
    "isSystemDefault" BOOLEAN NOT NULL DEFAULT false,
    "isSystemLabel" BOOLEAN NOT NULL DEFAULT false,
    "labelListVisibility" TEXT,
    "lastBatchSort" TIMESTAMP(3),
    "messageListVisibility" TEXT,
    "metaPrompt" TEXT,
    "systemLocked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Label_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MasterPrompt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isGenerated" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MasterPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mailboxId" TEXT,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "scope" TEXT,
    "tokenType" TEXT,
    "expiresAt" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Thread" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mailboxId" TEXT,
    "subject" TEXT NOT NULL,
    "snippet" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "gmailThreadId" TEXT,

    CONSTRAINT "Thread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenAccessAudit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenType" "CredentialKind" NOT NULL DEFAULT 'BOTH',
    "purpose" TEXT NOT NULL,
    "requester" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenAccessAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwilioConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "status" "TwilioConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "messageType" "TwilioMessageType" NOT NULL DEFAULT 'SMS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TwilioConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwilioMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "twilioSid" TEXT,
    "direction" "TwilioMessageDirection" NOT NULL,
    "content" TEXT NOT NULL,
    "role" "TwilioMessageRole" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TwilioMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "masterPromptGenerated" BOOLEAN NOT NULL DEFAULT false,
    "masterPromptQualityGenerated" BOOLEAN NOT NULL DEFAULT false,
    "labelingOnboardingGenerated" BOOLEAN NOT NULL DEFAULT false,
    "labelingOnboardingQualityGenerated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "autonomyLevel" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "gmailHistoryId" TEXT,
    "allowedSenders" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blockedSenders" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enablePushNotifications" BOOLEAN NOT NULL DEFAULT true,
    "replyScope" "ReplyScope" NOT NULL DEFAULT 'CONTACTS_ONLY',
    "preferencesSaved" BOOLEAN NOT NULL DEFAULT false,
    "calendarTimezone" TEXT,
    "calendarContextCalendarIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "autoFileLowPriority" INTEGER NOT NULL DEFAULT 50,
    "autoSendConfidence" INTEGER NOT NULL DEFAULT 95,
    "newOnboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "autoSortingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "onboardingStep" TEXT,
    "persona" "OnboardingPersona",
    "whatsappPhoneNumber" TEXT,
    "whatsappVerified" BOOLEAN NOT NULL DEFAULT false,
    "twilioPhoneNumber" TEXT,
    "twilioVerified" BOOLEAN NOT NULL DEFAULT false,
    "whatsappPromoSeen" BOOLEAN NOT NULL DEFAULT false,
    "notificationDeliveryChannel" "NotificationDeliveryChannel" NOT NULL DEFAULT 'BOTH',

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "waId" TEXT NOT NULL,
    "status" "WhatsAppConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "waMessageId" TEXT,
    "direction" "WhatsAppMessageDirection" NOT NULL,
    "content" TEXT NOT NULL,
    "role" "WhatsAppMessageRole" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramConversation" (
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
CREATE TABLE "TelegramMessage" (
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
CREATE TABLE "TelegramLink" (
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
CREATE TABLE "TelegramPairingRequest" (
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
CREATE TABLE "TelegramPollerState" (
    "id" TEXT NOT NULL,
    "workerKey" TEXT NOT NULL,
    "lastUpdateId" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramPollerState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActionHistory_userId_createdAt_idx" ON "ActionHistory"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PendingCalendarChange_userId_conversationId_status_idx" ON "PendingCalendarChange"("userId", "conversationId", "status");

-- CreateIndex
CREATE INDEX "PendingCalendarChange_userId_conversationId_createdAt_idx" ON "PendingCalendarChange"("userId", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "PendingCalendarChange_expiresAt_status_idx" ON "PendingCalendarChange"("expiresAt", "status");

-- CreateIndex
CREATE INDEX "BatchSortJob_startedAt_idx" ON "BatchSortJob"("startedAt");

-- CreateIndex
CREATE INDEX "BatchSortJob_userId_idx" ON "BatchSortJob"("userId");

-- CreateIndex
CREATE INDEX "BatchSortJob_userId_status_idx" ON "BatchSortJob"("userId", "status");

-- CreateIndex
CREATE INDEX "Email_mailboxId_idx" ON "Email"("mailboxId");

-- CreateIndex
CREATE UNIQUE INDEX "Email_mailboxId_messageId_key" ON "Email"("mailboxId", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailCategorizationResult_userId_key" ON "EmailCategorizationResult"("userId");

-- CreateIndex
CREATE INDEX "EmailCategorizationResult_userId_idx" ON "EmailCategorizationResult"("userId");

-- CreateIndex
CREATE INDEX "EmailCategorizationResult_userId_isActive_idx" ON "EmailCategorizationResult"("userId", "isActive");

-- CreateIndex
CREATE INDEX "EmailLearning_emailFrom_idx" ON "EmailLearning"("emailFrom");

-- CreateIndex
CREATE INDEX "EmailLearning_userId_idx" ON "EmailLearning"("userId");

-- CreateIndex
CREATE INDEX "EmailLearning_userId_isActive_idx" ON "EmailLearning"("userId", "isActive");

-- CreateIndex
CREATE INDEX "EmailMapping_userId_idx" ON "EmailMapping"("userId");

-- CreateIndex
CREATE INDEX "EmailMapping_mailboxId_idx" ON "EmailMapping"("mailboxId");

-- CreateIndex
CREATE INDEX "EmailMapping_userId_emailAddress_idx" ON "EmailMapping"("userId", "emailAddress");

-- CreateIndex
CREATE INDEX "EmailMapping_userId_domain_idx" ON "EmailMapping"("userId", "domain");

-- CreateIndex
CREATE INDEX "EmailMapping_userId_subjectPattern_idx" ON "EmailMapping"("userId", "subjectPattern");

-- CreateIndex
CREATE INDEX "EmailMapping_userId_isActive_idx" ON "EmailMapping"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMapping_mailboxId_emailAddress_key" ON "EmailMapping"("mailboxId", "emailAddress");

-- CreateIndex
CREATE INDEX "EmailAlert_userId_idx" ON "EmailAlert"("userId");

-- CreateIndex
CREATE INDEX "EmailAlert_userId_isActive_idx" ON "EmailAlert"("userId", "isActive");

-- CreateIndex
CREATE INDEX "Reminder_userId_idx" ON "Reminder"("userId");

-- CreateIndex
CREATE INDEX "Reminder_userId_status_idx" ON "Reminder"("userId", "status");

-- CreateIndex
CREATE INDEX "Reminder_scheduledAt_status_idx" ON "Reminder"("scheduledAt", "status");

-- CreateIndex
CREATE INDEX "EmailSort_userId_idx" ON "EmailSort"("userId");

-- CreateIndex
CREATE INDEX "EmailSort_mailboxId_idx" ON "EmailSort"("mailboxId");

-- CreateIndex
CREATE INDEX "EmailSort_batchSortJobId_idx" ON "EmailSort"("batchSortJobId");

-- CreateIndex
CREATE INDEX "EmailSort_labelId_idx" ON "EmailSort"("labelId");

-- CreateIndex
CREATE INDEX "EmailSort_gmailMessageId_idx" ON "EmailSort"("gmailMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSort_mailboxId_gmailMessageId_batchSortJobId_key" ON "EmailSort"("mailboxId", "gmailMessageId", "batchSortJobId");

-- CreateIndex
CREATE INDEX "Mailbox_userId_idx" ON "Mailbox"("userId");

-- CreateIndex
CREATE INDEX "Mailbox_status_idx" ON "Mailbox"("status");

-- CreateIndex
CREATE INDEX "Mailbox_emailAddress_idx" ON "Mailbox"("emailAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Mailbox_userId_provider_providerAccountId_key" ON "Mailbox"("userId", "provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Feedback_emailId_key" ON "Feedback"("emailId");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedDraft_emailId_key" ON "GeneratedDraft"("emailId");

-- CreateIndex
CREATE INDEX "Label_userId_idx" ON "Label"("userId");

-- CreateIndex
CREATE INDEX "Label_mailboxId_idx" ON "Label"("mailboxId");

-- CreateIndex
CREATE INDEX "Label_userId_isCustom_idx" ON "Label"("userId", "isCustom");

-- CreateIndex
CREATE INDEX "Label_userId_isSystemDefault_idx" ON "Label"("userId", "isSystemDefault");

-- CreateIndex
CREATE UNIQUE INDEX "Label_mailboxId_gmailLabelId_key" ON "Label"("mailboxId", "gmailLabelId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthAccount_mailboxId_key" ON "OAuthAccount"("mailboxId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthAccount_provider_providerAccountId_key" ON "OAuthAccount"("provider", "providerAccountId");

-- CreateIndex
CREATE INDEX "Thread_mailboxId_idx" ON "Thread"("mailboxId");

-- CreateIndex
CREATE UNIQUE INDEX "Thread_mailboxId_gmailThreadId_key" ON "Thread"("mailboxId", "gmailThreadId");

-- CreateIndex
CREATE INDEX "TokenAccessAudit_userId_createdAt_idx" ON "TokenAccessAudit"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TwilioConversation_userId_idx" ON "TwilioConversation"("userId");

-- CreateIndex
CREATE INDEX "TwilioConversation_userId_status_idx" ON "TwilioConversation"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TwilioConversation_userId_phoneNumber_key" ON "TwilioConversation"("userId", "phoneNumber");

-- CreateIndex
CREATE INDEX "TwilioMessage_conversationId_idx" ON "TwilioMessage"("conversationId");

-- CreateIndex
CREATE INDEX "TwilioMessage_conversationId_createdAt_idx" ON "TwilioMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- CreateIndex
CREATE INDEX "WhatsAppConversation_userId_idx" ON "WhatsAppConversation"("userId");

-- CreateIndex
CREATE INDEX "WhatsAppConversation_userId_status_idx" ON "WhatsAppConversation"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConversation_userId_waId_key" ON "WhatsAppConversation"("userId", "waId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_conversationId_idx" ON "WhatsAppMessage"("conversationId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_conversationId_createdAt_idx" ON "WhatsAppMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_waMessageId_idx" ON "WhatsAppMessage"("waMessageId");

-- CreateIndex
CREATE INDEX "TelegramConversation_userId_idx" ON "TelegramConversation"("userId");

-- CreateIndex
CREATE INDEX "TelegramConversation_userId_status_idx" ON "TelegramConversation"("userId", "status");

-- CreateIndex
CREATE INDEX "TelegramConversation_userId_updatedAt_idx" ON "TelegramConversation"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramConversation_userId_chatId_key" ON "TelegramConversation"("userId", "chatId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramMessage_telegramUpdateId_key" ON "TelegramMessage"("telegramUpdateId");

-- CreateIndex
CREATE INDEX "TelegramMessage_conversationId_idx" ON "TelegramMessage"("conversationId");

-- CreateIndex
CREATE INDEX "TelegramMessage_conversationId_createdAt_idx" ON "TelegramMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "TelegramMessage_telegramMessageId_idx" ON "TelegramMessage"("telegramMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramLink_userId_key" ON "TelegramLink"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramLink_telegramUserId_key" ON "TelegramLink"("telegramUserId");

-- CreateIndex
CREATE INDEX "TelegramLink_userId_idx" ON "TelegramLink"("userId");

-- CreateIndex
CREATE INDEX "TelegramLink_userId_isActive_idx" ON "TelegramLink"("userId", "isActive");

-- CreateIndex
CREATE INDEX "TelegramLink_userId_updatedAt_idx" ON "TelegramLink"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramPairingRequest_pairingCode_key" ON "TelegramPairingRequest"("pairingCode");

-- CreateIndex
CREATE INDEX "TelegramPairingRequest_telegramUserId_chatId_idx" ON "TelegramPairingRequest"("telegramUserId", "chatId");

-- CreateIndex
CREATE INDEX "TelegramPairingRequest_status_expiresAt_idx" ON "TelegramPairingRequest"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "TelegramPairingRequest_approvedByUserId_status_idx" ON "TelegramPairingRequest"("approvedByUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramPollerState_workerKey_key" ON "TelegramPollerState"("workerKey");

-- AddForeignKey
ALTER TABLE "ActionHistory" ADD CONSTRAINT "ActionHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingCalendarChange" ADD CONSTRAINT "PendingCalendarChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchSortJob" ADD CONSTRAINT "BatchSortJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Email" ADD CONSTRAINT "Email_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Email" ADD CONSTRAINT "Email_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailCategorizationResult" ADD CONSTRAINT "EmailCategorizationResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLearning" ADD CONSTRAINT "EmailLearning_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMapping" ADD CONSTRAINT "EmailMapping_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "Label"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMapping" ADD CONSTRAINT "EmailMapping_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMapping" ADD CONSTRAINT "EmailMapping_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAlert" ADD CONSTRAINT "EmailAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSort" ADD CONSTRAINT "EmailSort_batchSortJobId_fkey" FOREIGN KEY ("batchSortJobId") REFERENCES "BatchSortJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSort" ADD CONSTRAINT "EmailSort_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "Label"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSort" ADD CONSTRAINT "EmailSort_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSort" ADD CONSTRAINT "EmailSort_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mailbox" ADD CONSTRAINT "Mailbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "Email"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDraft" ADD CONSTRAINT "GeneratedDraft_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "Email"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Label" ADD CONSTRAINT "Label_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Label" ADD CONSTRAINT "Label_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MasterPrompt" ADD CONSTRAINT "MasterPrompt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthAccount" ADD CONSTRAINT "OAuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthAccount" ADD CONSTRAINT "OAuthAccount_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenAccessAudit" ADD CONSTRAINT "TokenAccessAudit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TwilioMessage" ADD CONSTRAINT "TwilioMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "TwilioConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsAppConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramMessage" ADD CONSTRAINT "TelegramMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "TelegramConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramLink" ADD CONSTRAINT "TelegramLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
