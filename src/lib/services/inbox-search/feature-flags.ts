export type InboxRetrievalFeatureFlags = {
  retrievalV2Enabled: boolean;
  vectorEnabled: boolean;
  llmRerankDeepOnly: boolean;
};

function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (typeof value !== 'string') {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }

  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  return defaultValue;
}

export function getInboxRetrievalFeatureFlags(): InboxRetrievalFeatureFlags {
  return {
    retrievalV2Enabled: parseBooleanEnv(process.env.INBOX_RETRIEVAL_V2_ENABLED, true),
    vectorEnabled: parseBooleanEnv(process.env.INBOX_VECTOR_ENABLED, true),
    llmRerankDeepOnly: parseBooleanEnv(process.env.INBOX_LLM_RERANK_DEEP_ONLY, true),
  };
}
