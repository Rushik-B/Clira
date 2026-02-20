import { google } from '@ai-sdk/google';

/**
 * Centralized Google (Gemini) model factory for the AI SDK.
 * - Reads API key from either GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY
 * - Provides simple accessors for commonly used tiers
 */

export type GeminiTier = 'flash' | 'pro';

function resolveGeminiModelName(tier: GeminiTier): string {
  const useLiteModel = process.env.USE_LITE_MODEL === 'true';
  if (useLiteModel) {
    // Keep a consistent lite model across tiers for testing
    return 'gemini-2.5-flash-lite';
  }
  // Gemini 3 Flash: use gemini-3-flash-preview (ID must include -preview)
  return 'gemini-3-flash-preview';
}

function getGeminiModelByName(modelName: string) {
  // Normalize env var for the provider if project uses GOOGLE_API_KEY
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && process.env.GOOGLE_API_KEY) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GOOGLE_API_KEY;
  }
  return google(modelName);
}

export function getGeminiModel(tier: GeminiTier = 'flash') {
  const modelName = resolveGeminiModelName(tier);
  return getGeminiModelByName(modelName);
}

const folderGenerationModelName =
  process.env.GEMINI_FOLDER_GENERATION_MODEL ?? 'gemini-3-flash-preview';

const DEFAULT_MODEL = 'gemini-3-flash-preview';

export const models = {
  flash: () => getGeminiModel('flash'),
  pro: () => getGeminiModel('pro'),
  flashLite: () => getGeminiModelByName('gemini-2.5-flash-lite'),
  folderGeneration: () => getGeminiModelByName(folderGenerationModelName),
  execAgent: () => getGeminiModelByName(process.env.EXEC_AGENT_MODEL ?? DEFAULT_MODEL),
  calendarSearch: () => getGeminiModelByName(process.env.CALENDAR_SEARCH_MODEL ?? DEFAULT_MODEL),
  emailRetrieval: () => getGeminiModelByName(process.env.EMAIL_RETRIEVAL_MODEL ?? DEFAULT_MODEL),
  replyRouter: () => getGeminiModelByName(process.env.REPLY_ROUTER_MODEL ?? DEFAULT_MODEL),
};
