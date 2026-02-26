export { buildInboxChunks, DEFAULT_CHUNK_OVERLAP_TOKENS, DEFAULT_CHUNK_SIZE_TOKENS } from '@/lib/services/inbox-search/chunker';
export { computeInboxContentHash } from '@/lib/services/inbox-search/content-hash';
export { indexInboxSearchEmail } from '@/lib/services/inbox-search/indexer';
export { prepareInboxBodyText } from '@/lib/services/inbox-search/text-prep';
export type {
  InboxSearchChunkRecord,
  InboxSearchIndexInput,
  InboxSearchIndexResult,
} from '@/lib/services/inbox-search/types';
export type { InboxSearchIndexerOptions } from '@/lib/services/inbox-search/indexer';
