export type InboxIndexService = {
  indexEmail: typeof import('@/lib/services/inbox-search/indexer').indexInboxSearchEmail;
  indexMailboxBackfill: typeof import('@/lib/services/inbox-search/backfill').runInboxMailboxBackfill;
  updateCheckpoint: typeof import('@/lib/services/inbox-search/checkpoint').saveInboxBackfillProgress;
  retryFailedEmbeddings: typeof import('@/lib/services/inbox-search/embed-retry').retryInboxDocumentEmbeddings;
};

export type InboxSearchService = {
  search: typeof import('@/lib/services/inbox-search/search').searchInboxDocuments;
};
