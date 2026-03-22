import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => ({
  warn: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: loggerMocks.warn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  getGoogleThinkingProviderOptions,
  getMissingLanguageModelConfig,
  getModelId,
  getModelProviderId,
} from '@/lib/ai/models';

const ENV_KEYS = [
  'AI_PROVIDER',
  'GOOGLE_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENROUTER_BASE_URL',
  'OPENROUTER_HTTP_REFERER',
  'OPENROUTER_X_TITLE',
  'OPENROUTER_SUPPORTS_STRUCTURED_OUTPUTS',
  'FLASH_MODEL',
  'FLASH_MODEL_PROVIDER',
  'PRO_MODEL',
  'PRO_MODEL_PROVIDER',
  'FLASH_LITE_MODEL',
  'FLASH_LITE_MODEL_PROVIDER',
  'FOLDER_GENERATION_MODEL',
  'FOLDER_GENERATION_MODEL_PROVIDER',
  'EXEC_AGENT_MODEL',
  'EXEC_AGENT_MODEL_PROVIDER',
  'EMAIL_RETRIEVAL_MODEL',
  'EMAIL_RETRIEVAL_MODEL_PROVIDER',
  'CALENDAR_SEARCH_MODEL',
  'CALENDAR_SEARCH_MODEL_PROVIDER',
  'REPLY_ROUTER_MODEL',
  'REPLY_ROUTER_MODEL_PROVIDER',
  'GEMINI_FOLDER_GENERATION_MODEL',
  'USE_LITE_MODEL',
] as const;

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

describe('model provider config', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  afterAll(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test('defaults to google with the current Gemini model ids', () => {
    expect(getModelProviderId('flash')).toBe('google');
    expect(getModelId('flash')).toBe('gemini-3-flash-preview');
    expect(getModelId('flashLite')).toBe('gemini-3.1-flash-lite-preview');
  });

  test('supports global and per-model provider overrides', () => {
    process.env.AI_PROVIDER = 'openrouter';
    process.env.EXEC_AGENT_MODEL_PROVIDER = 'google';
    process.env.EXEC_AGENT_MODEL = 'gemini-3-flash-preview';
    process.env.REPLY_ROUTER_MODEL = 'anthropic/claude-sonnet-4.5';

    expect(getModelProviderId('replyRouter')).toBe('openrouter');
    expect(getModelProviderId('execAgent')).toBe('google');
    expect(getModelId('replyRouter')).toBe('anthropic/claude-sonnet-4.5');
  });

  test('reports missing provider config for all configured providers', () => {
    process.env.AI_PROVIDER = 'openrouter';
    process.env.EXEC_AGENT_MODEL_PROVIDER = 'google';

    expect(getMissingLanguageModelConfig(['replyRouter', 'execAgent']).sort()).toEqual([
      'GOOGLE_GENERATIVE_AI_API_KEY or GOOGLE_API_KEY',
      'OPENROUTER_API_KEY',
    ]);
  });

  test('returns Google thinking options only for Google-backed models', () => {
    process.env.GOOGLE_API_KEY = 'test-google-key';

    expect(
      getGoogleThinkingProviderOptions('flash', {
        thinkingBudget: 0,
      }),
    ).toEqual({
      google: {
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    });

    process.env.AI_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
    process.env.FLASH_MODEL = 'openai/gpt-5-nano';

    expect(
      getGoogleThinkingProviderOptions('flash', {
        thinkingBudget: 0,
      }),
    ).toBeUndefined();
    expect(
      getGoogleThinkingProviderOptions('flash', {
        thinkingBudget: 0,
      }),
    ).toBeUndefined();
    expect(loggerMocks.warn).toHaveBeenCalledTimes(1);
  });
});
