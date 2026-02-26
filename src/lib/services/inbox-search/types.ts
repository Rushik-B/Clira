export type InboxSearchIndexInput = {
  userId: string;
  mailboxId: string;
  threadId: string;
  messageId: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  snippet?: string | null;
  body: string;
  sentAt: Date;
  hasAttachment: boolean;
};

export type InboxSearchChunkRecord = {
  chunkIndex: number;
  chunkText: string;
  tokenCount: number;
};

export type InboxSearchIndexResult =
  | {
      status: 'indexed';
      documentId: string;
      chunkCount: number;
      contentHash: string;
    }
  | {
      status: 'skipped_unchanged' | 'skipped_filtered';
      documentId: string | null;
      chunkCount: 0;
      contentHash: string;
    };
