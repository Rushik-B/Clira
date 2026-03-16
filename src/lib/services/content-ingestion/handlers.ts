import { TextDecoder } from 'node:util';
import { callTextWithMessages } from '@/lib/ai/callLlm';
import { models } from '@/lib/ai/models';
import type { AiTraceContext, AiTraceUsage } from '@/lib/ai/tracing';
import { stripHtmlPreservingNewlines } from '@/lib/email/text';
import type { AcquiredContent, ContentMediaFamily, ContentTokenCost } from './types';

type ExtractHandlerParams = {
  acquiredContent: AcquiredContent;
  abortSignal?: AbortSignal;
  traceContext?: AiTraceContext;
  channelLabel?: string;
  userCaption?: string | null;
};

type ExtractHandlerOutput = {
  extractedText: string;
  images: string[];
  structuredData: Record<string, unknown> | null;
  tokenCost: ContentTokenCost;
};

export type ContentHandler = {
  mediaFamily: ContentMediaFamily;
  version: string;
  consumesBudget: boolean;
  supportsExtraction: boolean;
  extract?: (params: ExtractHandlerParams) => Promise<ExtractHandlerOutput>;
};

const utf8Decoder = new TextDecoder('utf-8', { fatal: false });

function normalizeUsage(usage: AiTraceUsage | null | undefined): ContentTokenCost {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
  };
}

function buildPdfExtractionPrompt(options?: {
  channelLabel?: string;
  filename?: string | null;
  userCaption?: string | null;
}): string {
  const channelLabel = options?.channelLabel?.trim() || 'a messaging chat';
  const filename = options?.filename?.trim();

  return [
    `The user sent a PDF in ${channelLabel}.`,
    filename ? `Filename: ${filename}` : null,
    'Transcribe the PDF into faithful plain text for downstream processing.',
    '',
    'Requirements:',
    '1) Preserve the original wording and document order as closely as possible.',
    '2) Include all readable text from the PDF, including headings, paragraphs, labels, tables, line items, totals, footers, and repeated boilerplate when present.',
    '3) Use plain text only. You may use line breaks, indentation, and simple bullet markers only when needed to mirror the document structure.',
    '4) Do not summarize, interpret, rewrite, or omit details just because they seem unimportant.',
    '5) Do not add sections such as summary, key details, extracted text, uncertainties, or commentary.',
    '6) If any portion is unreadable or uncertain, insert a short inline marker such as [unreadable] or [unclear] at that spot and continue.',
    '',
    'Return only the transcription.',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildImageDescriptionPrompt(options?: {
  channelLabel?: string;
  userCaption?: string | null;
}): string {
  const channelLabel = options?.channelLabel?.trim() || 'a messaging chat';
  const caption = options?.userCaption?.trim();

  return [
    `The user sent an image in ${channelLabel}.`,
    caption
      ? [
          'The user also included this caption with the image.',
          'Treat the caption as part of the user request and use it to disambiguate the image, but do not invent unsupported facts.',
          '',
          `Caption: ${caption}`,
        ].join('\n')
      : null,
    'Provide a thorough, reliable description for an executive assistant workflow.',
    '',
    'Requirements:',
    '1) Describe all visible details that could matter for productivity tasks (documents, whiteboards, screens, receipts, handwritten notes, schedules, charts, business cards, product labels, signs, etc).',
    '2) Transcribe any legible text exactly when possible.',
    '3) If text is partially legible, include best-effort reconstruction and clearly mark uncertain fragments.',
    '4) Capture structure (sections, headings, bullet points, totals, dates, names, contact details).',
    '5) Mention relevant visual context (who/what/where, objects, actions, layout) without over-guessing.',
    '6) If image quality limits certainty, explicitly note uncertainty.',
    '7) Output plain text only.',
    '',
    'Format your output as:',
    '- SUMMARY: <2-4 concise sentences>',
    '- DETAILED OBSERVATIONS:',
    '  - ...',
    '- EXTRACTED TEXT:',
    '  - ... (or "None clearly legible")',
    '- UNCERTAINTIES:',
    '  - ... (or "None")',
  ]
    .filter(Boolean)
    .join('\n');
}

async function extractPdf(params: ExtractHandlerParams): Promise<ExtractHandlerOutput> {
  const { text, usage } = await callTextWithMessages({
    model: models.flash(),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text' as const,
            text: buildPdfExtractionPrompt({
              channelLabel: params.channelLabel,
              filename: params.acquiredContent.filename ?? null,
              userCaption: params.userCaption,
            }),
          },
          {
            type: 'file' as const,
            data: params.acquiredContent.bytes ?? Buffer.alloc(0),
            mediaType: params.acquiredContent.mimeType,
          },
        ],
      },
    ],
    abortSignal: params.abortSignal,
    traceContext: params.traceContext,
    op: 'document.extract-pdf',
    concurrency: { key: 'document.extract-pdf', maxConcurrency: 2 },
    retry: { maxAttempts: 2, baseDelayMs: 400 },
  });

  return {
    extractedText: text?.trim() ?? '',
    images: [],
    structuredData: null,
    tokenCost: normalizeUsage(usage),
  };
}

async function describeImage(params: ExtractHandlerParams): Promise<ExtractHandlerOutput> {
  const { text, usage } = await callTextWithMessages({
    model: models.flash(),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text' as const,
            text: buildImageDescriptionPrompt({
              channelLabel: params.channelLabel,
              userCaption: params.userCaption,
            }),
          },
          {
            type: 'file' as const,
            data: params.acquiredContent.bytes ?? Buffer.alloc(0),
            mediaType: params.acquiredContent.mimeType,
          },
        ],
      },
    ],
    abortSignal: params.abortSignal,
    traceContext: params.traceContext,
    op: 'messaging.describe-image',
    concurrency: { key: 'messaging.describe-image', maxConcurrency: 2 },
    retry: { maxAttempts: 2, baseDelayMs: 400 },
  });

  return {
    extractedText: text?.trim() ?? '',
    images: [],
    structuredData: null,
    tokenCost: normalizeUsage(usage),
  };
}

async function transcribeAudio(params: ExtractHandlerParams): Promise<ExtractHandlerOutput> {
  const { text, usage } = await callTextWithMessages({
    model: models.flash(),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text' as const,
            text:
              'The user sent this voice memo. Transcribe exactly what they said. Reply with only the transcription, no preamble or labels.',
          },
          {
            type: 'file' as const,
            data: params.acquiredContent.bytes ?? Buffer.alloc(0),
            mediaType: params.acquiredContent.mimeType,
          },
        ],
      },
    ],
    abortSignal: params.abortSignal,
    traceContext: params.traceContext,
    op: 'messaging.transcribe-voice',
    concurrency: { key: 'messaging.transcribe-voice', maxConcurrency: 2 },
    retry: { maxAttempts: 2, baseDelayMs: 400 },
  });

  return {
    extractedText: text?.trim() ?? '',
    images: [],
    structuredData: null,
    tokenCost: normalizeUsage(usage),
  };
}

async function decodePlainText(params: ExtractHandlerParams): Promise<ExtractHandlerOutput> {
  const text = utf8Decoder.decode(params.acquiredContent.bytes ?? Buffer.alloc(0)).trim();
  return {
    extractedText: text,
    images: [],
    structuredData: null,
    tokenCost: normalizeUsage(null),
  };
}

async function extractHtmlText(params: ExtractHandlerParams): Promise<ExtractHandlerOutput> {
  const html = utf8Decoder.decode(params.acquiredContent.bytes ?? Buffer.alloc(0));
  const text = stripHtmlPreservingNewlines(html)
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    extractedText: text,
    images: [],
    structuredData: null,
    tokenCost: normalizeUsage(null),
  };
}

const HANDLERS: Record<ContentMediaFamily, ContentHandler> = {
  pdf: {
    mediaFamily: 'pdf',
    version: 'pdf-v1',
    consumesBudget: true,
    supportsExtraction: true,
    extract: extractPdf,
  },
  text: {
    mediaFamily: 'text',
    version: 'text-v1',
    consumesBudget: false,
    supportsExtraction: true,
    extract: decodePlainText,
  },
  html: {
    mediaFamily: 'html',
    version: 'html-v1',
    consumesBudget: false,
    supportsExtraction: true,
    extract: extractHtmlText,
  },
  image: {
    mediaFamily: 'image',
    version: 'image-v1',
    consumesBudget: true,
    supportsExtraction: true,
    extract: describeImage,
  },
  audio: {
    mediaFamily: 'audio',
    version: 'audio-v1',
    consumesBudget: true,
    supportsExtraction: true,
    extract: transcribeAudio,
  },
  office_doc: {
    mediaFamily: 'office_doc',
    version: 'office-doc-v1',
    consumesBudget: false,
    supportsExtraction: false,
  },
  spreadsheet: {
    mediaFamily: 'spreadsheet',
    version: 'spreadsheet-v1',
    consumesBudget: false,
    supportsExtraction: false,
  },
  archive: {
    mediaFamily: 'archive',
    version: 'archive-v1',
    consumesBudget: false,
    supportsExtraction: false,
  },
  unknown_binary: {
    mediaFamily: 'unknown_binary',
    version: 'unknown-binary-v1',
    consumesBudget: false,
    supportsExtraction: false,
  },
};

export function getContentHandler(mediaFamily: ContentMediaFamily): ContentHandler {
  return HANDLERS[mediaFamily];
}
