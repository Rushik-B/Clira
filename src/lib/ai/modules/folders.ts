import { callObject } from '../callLlm';
import { models } from '../models';
import { FolderGenerationResultSchema } from '../schemas/schemas';
import type { z } from 'zod';
import { readPromptFile } from '../../prompts';

export type RecentEmail = {
  from: string;
  to: string[];
  subject: string;
  body: string;
  date: Date;
};

// Onboarding folder generation (uses MD prompt)
export async function generateFoldersFromEmails({
  recentEmails,
  senderAnalysis,
  existingLabels = [],
  abortSignal,
}: {
  recentEmails: RecentEmail[];
  senderAnalysis: Record<string, { count: number; domains: string[]; keywords: string[] }>;
  existingLabels?: Array<{ name: string; source: 'database' | 'gmail' | 'both' }>;
  abortSignal?: AbortSignal;
}) {
  const tmpl = readPromptFile('organization-routing/folderGenerationPrompt.xml');

  const emailsText = recentEmails
    .slice(0, 50)
    .map((email, index) => `\nEmail ${index + 1}:\nFrom: ${email.from}\nTo: ${email.to.join(', ')}\nSubject: ${email.subject}\nDate: ${email.date.toLocaleDateString()}\nBody: ${email.body.substring(0, 300)}${email.body.length > 300 ? '...' : ''}\n---`)
    .join('\n');

  const senderAnalysisText = Object.entries(senderAnalysis)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 20)
    .map(([sender, data]) => `${sender}: ${data.count} emails, domains: ${data.domains.join(', ')}, keywords: ${data.keywords.join(', ')}`)
    .join('\n');

  // Format existing labels for prompt
  const existingLabelsText = existingLabels.length > 0
    ? existingLabels.map(label => `"${label.name}" (${label.source})`).join(', ')
    : 'None';

  const prompt = tmpl
    .replace('{recentEmails}', emailsText)
    .replace('{senderAnalysis}', senderAnalysisText)
    .replace('{existingLabels}', existingLabelsText);

  const system = 'You are an intelligent email assistant that creates personalized folder structures based on actual email patterns.';

  const { object } = await callObject<z.infer<typeof FolderGenerationResultSchema>>({
    model: models.folderGeneration(),
    system,
    prompt,
    schema: FolderGenerationResultSchema,
    temperature: 0.5,
    op: 'folders.generate',
    concurrency: { key: 'folders', maxConcurrency: 3 },
    retry: { maxAttempts: 3 },
    abortSignal,
    providerOptions: {
      google: {
        thinkingConfig: {
          thinkingBudget: 1024,
        },
      },
    },
  });

  return object;
}
