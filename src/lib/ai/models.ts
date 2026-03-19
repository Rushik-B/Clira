import type { LanguageModel } from 'ai';
import { google } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ProviderOptions as AISDKProviderOptions } from '@ai-sdk/provider-utils';
import { logger } from '@/lib/logger';

export type LanguageModelProviderId = 'google' | 'openrouter';

export type ModelKey =
  | 'flash'
  | 'pro'
  | 'flashLite'
  | 'folderGeneration'
  | 'execAgent'
  | 'calendarSearch'
  | 'emailRetrieval'
  | 'replyRouter';

type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

const MODEL_KEYS: ModelKey[] = [
  'flash',
  'pro',
  'flashLite',
  'folderGeneration',
  'execAgent',
  'calendarSearch',
  'emailRetrieval',
  'replyRouter',
];

const MODEL_ENV_KEYS: Record<
  ModelKey,
  {
    provider: string;
    model: string;
  }
> = {
  flash: {
    provider: 'FLASH_MODEL_PROVIDER',
    model: 'FLASH_MODEL',
  },
  pro: {
    provider: 'PRO_MODEL_PROVIDER',
    model: 'PRO_MODEL',
  },
  flashLite: {
    provider: 'FLASH_LITE_MODEL_PROVIDER',
    model: 'FLASH_LITE_MODEL',
  },
  folderGeneration: {
    provider: 'FOLDER_GENERATION_MODEL_PROVIDER',
    model: 'FOLDER_GENERATION_MODEL',
  },
  execAgent: {
    provider: 'EXEC_AGENT_MODEL_PROVIDER',
    model: 'EXEC_AGENT_MODEL',
  },
  calendarSearch: {
    provider: 'CALENDAR_SEARCH_MODEL_PROVIDER',
    model: 'CALENDAR_SEARCH_MODEL',
  },
  emailRetrieval: {
    provider: 'EMAIL_RETRIEVAL_MODEL_PROVIDER',
    model: 'EMAIL_RETRIEVAL_MODEL',
  },
  replyRouter: {
    provider: 'REPLY_ROUTER_MODEL_PROVIDER',
    model: 'REPLY_ROUTER_MODEL',
  },
};

const warnedKeys = new Set<string>();

function warnOnce(key: string, message: string, metadata?: Record<string, unknown>): void {
  if (warnedKeys.has(key)) {
    return;
  }
  warnedKeys.add(key);
  logger.warn(message, metadata ?? {});
}

function normalizeGoogleApiKeyEnv(): void {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && process.env.GOOGLE_API_KEY) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GOOGLE_API_KEY;
  }
}

function hasGoogleLanguageModelKey(): boolean {
  return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY);
}

function parseProviderId(
  raw: string | undefined,
  fallback: LanguageModelProviderId,
  context: string,
): LanguageModelProviderId {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (normalized === 'google' || normalized === 'openrouter') {
    return normalized;
  }

  warnOnce(
    `provider:${context}:${normalized}`,
    '[ai-models] Unsupported provider configured; falling back to default.',
    { context, configuredProvider: normalized, fallbackProvider: fallback },
  );
  return fallback;
}

function resolveDefaultGoogleModelName(key: ModelKey): string {
  const useLiteModel = process.env.USE_LITE_MODEL === 'true';

  switch (key) {
    case 'flash':
    case 'pro':
      if (useLiteModel) {
        return 'gemini-2.5-flash-lite';
      }
      return 'gemini-3-flash-preview';
    case 'flashLite':
      return 'gemini-3.1-flash-lite-preview';
    case 'folderGeneration':
      return process.env.GEMINI_FOLDER_GENERATION_MODEL ?? 'gemini-3-flash-preview';
    case 'execAgent':
      return process.env.EXEC_AGENT_MODEL ?? 'gemini-3-flash-preview';
    case 'calendarSearch':
      return process.env.CALENDAR_SEARCH_MODEL ?? 'gemini-3-flash-preview';
    case 'emailRetrieval':
      return process.env.EMAIL_RETRIEVAL_MODEL ?? 'gemini-3-flash-preview';
    case 'replyRouter':
      return process.env.REPLY_ROUTER_MODEL ?? 'gemini-3-flash-preview';
    default: {
      const _never: never = key;
      return _never;
    }
  }
}

function resolveGlobalProviderId(): LanguageModelProviderId {
  return parseProviderId(process.env.AI_PROVIDER, 'google', 'AI_PROVIDER');
}

function resolveProviderOverride(key: ModelKey): LanguageModelProviderId | null {
  const providerEnv = MODEL_ENV_KEYS[key].provider;
  if (!process.env[providerEnv]) {
    return null;
  }

  return parseProviderId(process.env[providerEnv], resolveGlobalProviderId(), providerEnv);
}

export function getModelProviderId(key: ModelKey): LanguageModelProviderId {
  return resolveProviderOverride(key) ?? resolveGlobalProviderId();
}

function resolveExplicitModelId(key: ModelKey): string | undefined {
  const envKey = MODEL_ENV_KEYS[key].model;
  return process.env[envKey] ?? undefined;
}

export function getModelId(key: ModelKey): string {
  const explicitModelId = resolveExplicitModelId(key);
  const modelId = explicitModelId ?? resolveDefaultGoogleModelName(key);
  const providerId = getModelProviderId(key);

  if (providerId === 'openrouter' && !explicitModelId) {
    warnOnce(
      `model-mismatch:${key}:${modelId}`,
      '[ai-models] OpenRouter is selected but this model key is still using the built-in Gemini default. Configure an explicit model id for predictable routing.',
      {
        modelKey: key,
        providerId,
        modelId,
        envVar: MODEL_ENV_KEYS[key].model,
      },
    );
  }

  return modelId;
}

function createGoogleLanguageModel(modelId: string): LanguageModel {
  normalizeGoogleApiKeyEnv();
  return google(modelId);
}

function createOpenRouterLanguageModel(modelId: string): LanguageModel {
  const headers: Record<string, string> = {};

  if (process.env.OPENROUTER_HTTP_REFERER) {
    headers['HTTP-Referer'] = process.env.OPENROUTER_HTTP_REFERER;
  }
  if (process.env.OPENROUTER_X_TITLE) {
    headers['X-Title'] = process.env.OPENROUTER_X_TITLE;
  }

  const provider = createOpenAICompatible({
    name: 'openrouter',
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    includeUsage: true,
    supportsStructuredOutputs:
      process.env.OPENROUTER_SUPPORTS_STRUCTURED_OUTPUTS === 'true' ? true : undefined,
  });

  return provider.chatModel(modelId);
}

export function getModel(key: ModelKey): LanguageModel {
  const providerId = getModelProviderId(key);
  const modelId = getModelId(key);

  switch (providerId) {
    case 'google':
      return createGoogleLanguageModel(modelId);
    case 'openrouter':
      return createOpenRouterLanguageModel(modelId);
    default: {
      const _never: never = providerId;
      return _never;
    }
  }
}

export function getConfiguredLanguageModelProviders(
  keys: ModelKey[] = MODEL_KEYS,
): LanguageModelProviderId[] {
  return [...new Set(keys.map((key) => getModelProviderId(key)))];
}

export function getMissingLanguageModelConfig(keys: ModelKey[] = MODEL_KEYS): string[] {
  const missing = new Set<string>();

  for (const providerId of getConfiguredLanguageModelProviders(keys)) {
    switch (providerId) {
      case 'google':
        if (!hasGoogleLanguageModelKey()) {
          missing.add('GOOGLE_GENERATIVE_AI_API_KEY or GOOGLE_API_KEY');
        }
        break;
      case 'openrouter':
        if (!process.env.OPENROUTER_API_KEY) {
          missing.add('OPENROUTER_API_KEY');
        }
        break;
      default: {
        const _never: never = providerId;
        return _never;
      }
    }
  }

  return [...missing];
}

export function assertLanguageModelConfig(keys: ModelKey[] = MODEL_KEYS): void {
  const missing = getMissingLanguageModelConfig(keys);
  if (missing.length === 0) {
    return;
  }

  throw new Error(`Missing language model configuration: ${missing.join(', ')}`);
}

export function getGoogleThinkingProviderOptions(
  key: ModelKey,
  config: {
    thinkingBudget?: number;
    thinkingLevel?: ThinkingLevel;
  },
): AISDKProviderOptions | undefined {
  const providerId = getModelProviderId(key);
  if (providerId !== 'google') {
    warnOnce(
      `provider-capability:${providerId}:google-thinking:${key}`,
      '[ai-models] Requested Google thinkingConfig for a non-Google provider; continuing without provider-specific options.',
      { modelKey: key, providerId },
    );
    return undefined;
  }

  const thinkingConfig: {
    thinkingBudget?: number;
    thinkingLevel?: ThinkingLevel;
  } = {};

  if (typeof config.thinkingBudget === 'number') {
    thinkingConfig.thinkingBudget = config.thinkingBudget;
  }
  if (config.thinkingLevel) {
    thinkingConfig.thinkingLevel = config.thinkingLevel;
  }

  if (Object.keys(thinkingConfig).length === 0) {
    return undefined;
  }

  return {
    google: {
      thinkingConfig,
    },
  };
}

export const models = {
  flash: () => getModel('flash'),
  pro: () => getModel('pro'),
  flashLite: () => getModel('flashLite'),
  folderGeneration: () => getModel('folderGeneration'),
  execAgent: () => getModel('execAgent'),
  calendarSearch: () => getModel('calendarSearch'),
  emailRetrieval: () => getModel('emailRetrieval'),
  replyRouter: () => getModel('replyRouter'),
};
