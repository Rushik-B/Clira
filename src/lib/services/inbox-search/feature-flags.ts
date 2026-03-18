import { parseBooleanEnv } from '@/lib/utils/params';

export type InboxRetrievalFeatureFlags = {
  retrievalV2Enabled: boolean;
  vectorEnabled: boolean;
  llmRerankDeepOnly: boolean;
};

export function getInboxRetrievalFeatureFlags(): InboxRetrievalFeatureFlags {
  return {
    retrievalV2Enabled: parseBooleanEnv(process.env.INBOX_RETRIEVAL_V2_ENABLED, true),
    vectorEnabled: parseBooleanEnv(process.env.INBOX_VECTOR_ENABLED, true),
    llmRerankDeepOnly: parseBooleanEnv(process.env.INBOX_LLM_RERANK_DEEP_ONLY, true),
  };
}
