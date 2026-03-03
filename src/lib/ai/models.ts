import { google } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

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

const DEFAULT_CEREBRAS_SELECTOR_MODEL = 'llama3.1-8b';

let cerebrasProvider:
  | ReturnType<typeof createOpenAICompatible>
  | null = null;

/**
 * Lazily initializes a shared Cerebras provider for the selector route.
 *
 * Required env when enabled:
 * - EA_SELECTOR_CEREBRAS_ENABLED=true
 * - CEREBRAS_API_KEY=<key>
 * Optional:
 * - EA_SELECTOR_CEREBRAS_MODEL (defaults to llama3.1-8b)
 */
function getCerebrasProvider() {
  if (cerebrasProvider) return cerebrasProvider;

  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) {
    throw new Error('CEREBRAS_API_KEY is required when EA_SELECTOR_CEREBRAS_ENABLED=true');
  }

  cerebrasProvider = createOpenAICompatible({
    name: 'cerebras',
    apiKey,
    baseURL: 'https://api.cerebras.ai/v1',
    // Required for AI SDK generateObject() to use JSON-schema response_format.
    // Without this, object generation downgrades and frequently fails with
    // AI_NoObjectGeneratedError on selector classification calls.
    supportsStructuredOutputs: true,
  });
  return cerebrasProvider;
}

/**
 * Returns the configured chat model used for LLM-based executive pack routing.
 */
function getCerebrasSelectorModel() {
  const modelName = process.env.EA_SELECTOR_CEREBRAS_MODEL?.trim() || DEFAULT_CEREBRAS_SELECTOR_MODEL;
  return getCerebrasProvider().chatModel(modelName);
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
  /**
   * Selector model can be switched independently from the main executive model.
   * This allows low-cost/high-throughput routing experiments behind a flag
   * without changing agent reasoning models.
   */
  execSelector: () =>
    process.env.EA_SELECTOR_CEREBRAS_ENABLED === 'true'
      ? getCerebrasSelectorModel()
      : getGeminiModelByName(process.env.EXEC_SELECTOR_MODEL ?? DEFAULT_MODEL),
  calendarSearch: () => getGeminiModelByName(process.env.CALENDAR_SEARCH_MODEL ?? DEFAULT_MODEL),
  emailRetrieval: () => getGeminiModelByName(process.env.EMAIL_RETRIEVAL_MODEL ?? DEFAULT_MODEL),
  replyRouter: () => getGeminiModelByName(process.env.REPLY_ROUTER_MODEL ?? DEFAULT_MODEL),
};
