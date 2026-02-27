export { buildInboxChunks, DEFAULT_CHUNK_OVERLAP_TOKENS, DEFAULT_CHUNK_SIZE_TOKENS } from '@/lib/services/inbox-search/chunker';
export {
  getOrCreateInboxSearchCheckpoint,
  markInboxBackfillComplete,
  markInboxBackfillPausedAuthRevoked,
  parseInboxBackfillCursor,
  resolveInboxBackfillResume,
  saveInboxBackfillProgress,
  serializeInboxBackfillCursor,
  touchInboxSearchRealtimeCheckpoint,
} from '@/lib/services/inbox-search/checkpoint';
export { computeInboxContentHash } from '@/lib/services/inbox-search/content-hash';
export {
  INBOX_SEARCH_BACKFILL_PAGE_DELAY_MS,
  INBOX_SEARCH_BACKFILL_PAGE_SIZE,
  INBOX_SEARCH_BACKFILL_QUERY,
  INBOX_SEARCH_SEED_QUERY,
  isGmailAuthRevokedError,
  runInboxMailboxBackfill,
} from '@/lib/services/inbox-search/backfill';
export { retryInboxDocumentEmbeddings } from '@/lib/services/inbox-search/embed-retry';
export {
  buildInboxSearchInputFromParsedEmail,
  indexStoredInboxEmail,
} from '@/lib/services/inbox-search/ingestion';
export { indexInboxSearchEmail } from '@/lib/services/inbox-search/indexer';
export {
  enqueueInboxBackfillForConnectedMailboxes,
  enqueueInboxBackfillForMailboxIfReady,
  enqueueInboxBackfillJob,
  enqueueInboxEmbedRetryJob,
  enqueueInboxIndexJob,
} from '@/lib/services/inbox-search/queue';
export { prepareInboxBodyText } from '@/lib/services/inbox-search/text-prep';
export { runInboxSearchTransaction } from '@/lib/services/inbox-search/tx';
export type {
  InboxSearchChunkRecord,
  InboxSearchIndexInput,
  InboxSearchIndexResult,
} from '@/lib/services/inbox-search/types';
export type {
  InboxBackfillPhase,
  InboxSearchCheckpointRecord,
} from '@/lib/services/inbox-search/checkpoint';
export type { InboxSearchIndexerOptions } from '@/lib/services/inbox-search/indexer';
export type { InboxMailboxBackfillResult } from '@/lib/services/inbox-search/backfill';
export type { InboxSearchStoredEmailIndexResult } from '@/lib/services/inbox-search/ingestion';
