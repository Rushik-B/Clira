import { callObject } from '../callLlm';
import { models } from '../models';
import { EmailMappingResultSchema, PerEmailMappingResultSchema } from '../schemas/schemas';
import type { z } from 'zod';
import { getEmailMappingPrompt } from '../../prompts';

export async function generateEmailMappings({
  availableFolders,
  emailAddresses,
  emailPatternContext,
  abortSignal,
}: {
  availableFolders: any[];
  emailAddresses: any[];
  emailPatternContext: any;
  abortSignal?: AbortSignal;
}) {
  let prompt = getEmailMappingPrompt();
  prompt = prompt.replace(/\{availableFolders\}/g, JSON.stringify(availableFolders, null, 2));
  prompt = prompt.replace(/\{emailAddresses\}/g, JSON.stringify(emailAddresses, null, 2));
  prompt = prompt.replace(/\{emailPatternContext\}/g, JSON.stringify(emailPatternContext, null, 2));

  const system = 'You are an intelligent email assistant.';

  const { object } = await callObject<z.infer<typeof EmailMappingResultSchema>>({
    model: models.flash(),
    system,
    prompt,
    schema: EmailMappingResultSchema,
    temperature: 0.2,
    op: 'mapping.generate-batch',
    concurrency: { key: 'mapping', maxConcurrency: 2 },
    retry: { maxAttempts: 4 },
    abortSignal,
  });

  return object;
}

export async function suggestEmailMappings({
  emailAddresses,
  availableFolders,
  emailPatternContext,
  abortSignal,
}: {
  emailAddresses: string[];
  availableFolders: Array<{ id: string; name: string; metaPrompt: string; color: string }>;
  emailPatternContext?: string;
  abortSignal?: AbortSignal;
}) {
  const foldersText = availableFolders
    .map((f) => `ID: ${f.id}, Name: ${f.name}, Description: ${f.metaPrompt}`)
    .join('\n');

  const tmpl = getEmailMappingPrompt();
  const prompt = tmpl
    .replace('{availableFolders}', foldersText)
    .replace('{emailAddresses}', emailAddresses.join('\n'))
    .replace('{emailPatternContext}', emailPatternContext || 'No additional context provided');

  const system = 'You are an intelligent email mapping system that suggests optimal folder assignments for email addresses.';

  const { object } = await callObject<z.infer<typeof EmailMappingResultSchema>>({
    model: models.flash(),
    system,
    prompt,
    schema: EmailMappingResultSchema,
    temperature: 0.2,
    op: 'mapping.suggest',
    concurrency: { key: 'mapping', maxConcurrency: 3 },
    retry: { maxAttempts: 4 },
    abortSignal,
  });

  return object;
}

/**
 * Generate per-email mappings for improved accuracy
 * Takes individual emails and assigns them to specific folders
 */
export async function generatePerEmailMappings({
  availableFolders,
  emails,
  abortSignal,
}: {
  availableFolders: Array<{ id: string; name: string; description?: string; metaPrompt?: string; color?: string }>;
  emails: Array<{
    id: string;
    from: string;
    subject: string;
    snippet: string;
    bodyTrimmed: string;
    date: Date;
    gmailCategories: string[];
    existingLabel?: string;
  }>;
  abortSignal?: AbortSignal;
}) {
  let prompt = getEmailMappingPrompt();
  prompt = prompt.replace(/\{availableFolders\}/g, JSON.stringify(availableFolders, null, 2));
  prompt = prompt.replace(/\{emails\}/g, JSON.stringify(emails, null, 2));

  const system = 'You are a precise email categorization system that assigns individual emails to folders.';

  const { object } = await callObject<z.infer<typeof PerEmailMappingResultSchema>>({
    model: models.flash(),
    system,
    prompt,
    schema: PerEmailMappingResultSchema,
    temperature: 0.1,
    op: 'mapping.generate-per-email',
    concurrency: { key: 'per-email-mapping', maxConcurrency: 3 },
    retry: { maxAttempts: 3 },
    abortSignal,
  });

  return object;
}


