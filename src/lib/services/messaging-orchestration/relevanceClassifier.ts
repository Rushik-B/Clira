import { z } from 'zod';
import { callObject } from '@/lib/ai/callLlm';
import { models } from '@/lib/ai/models';
import type { RelevanceClassification } from './types';

const classifierSchema = z.object({
  decision: z.enum(['supersede', 'followup', 'ambiguous']),
  confidence: z.number().min(0).max(1),
  explanation: z.string().min(1).max(300),
  latestIntentText: z.string().min(1).max(600),
});

function lexicalOverride(
  activeIntentText: string,
  incomingText: string,
): RelevanceClassification | null {
  const next = incomingText.trim();
  const normalized = next.toLowerCase();
  const prev = activeIntentText.trim().toLowerCase();

  if (!normalized) {
    return {
      decision: 'ambiguous',
      confidence: 0.5,
      explanation: 'Incoming message is empty.',
      latestIntentText: next || activeIntentText || 'No intent',
    };
  }

  const correctionPrefixes = [
    'actually',
    'wait',
    'hold on',
    'no,',
    'no ',
    'nvm',
    'nevermind',
    'never mind',
    'instead',
    'correction',
    'change that',
  ];

  if (correctionPrefixes.some((prefix) => normalized.startsWith(prefix))) {
    return {
      decision: 'supersede',
      confidence: 0.95,
      explanation: 'Detected direct correction phrasing.',
      latestIntentText: next,
    };
  }

  if (prev && normalized === prev) {
    return {
      decision: 'followup',
      confidence: 0.8,
      explanation: 'Duplicate message likely follow-up noise.',
      latestIntentText: activeIntentText,
    };
  }

  return null;
}

export async function classifyMessageRelevance({
  activeIntentText,
  incomingText,
}: {
  activeIntentText: string;
  incomingText: string;
}): Promise<RelevanceClassification> {
  const lexicalDecision = lexicalOverride(activeIntentText, incomingText);
  if (lexicalDecision) return lexicalDecision;

  const safeActiveIntent = activeIntentText.trim() || 'No active intent';
  const safeIncoming = incomingText.trim();

  const prompt = [
    'Classify how a new user message relates to the active in-flight intent.',
    'Return strict JSON only using the provided schema.',
    'Decision rules:',
    '- supersede: new message corrects/replaces the active task; latest message should win.',
    '- followup: new message is a separate request and should run after current one.',
    '- ambiguous: uncertain; do not force a cancel.',
    '',
    `Active intent:\n${safeActiveIntent}`,
    '',
    `Incoming message:\n${safeIncoming}`,
  ].join('\n');

  try {
    const { object } = await callObject<RelevanceClassification>({
      model: models.flashLite(),
      schema: classifierSchema,
      prompt,
      temperature: 0,
      providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
      op: 'messaging-orchestration.relevance',
      concurrency: {
        key: 'messaging-orchestration.relevance',
        maxConcurrency: 8,
      },
      retry: {
        maxAttempts: 2,
        baseDelayMs: 150,
      },
    });

    return object;
  } catch {
    return {
      decision: 'ambiguous',
      confidence: 0.5,
      explanation: 'Classifier fallback after model error.',
      latestIntentText: safeIncoming,
    };
  }
}
