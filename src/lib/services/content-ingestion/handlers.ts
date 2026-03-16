import { TextDecoder } from 'node:util';
import { callTextWithMessages } from '@/lib/ai/callLlm';
import { models } from '@/lib/ai/models';
import type { AiTraceContext, AiTraceUsage } from '@/lib/ai/tracing';
import { stripHtmlPreservingNewlines } from '@/lib/email/text';
import { resolveContentMediaFamily } from './limits';
import { guessMimeTypeFromFilename } from './mime';
import { extractOfficeDocumentText, extractSpreadsheetText } from './structuredFormats';
import type {
  AcquiredContent,
  ContentExtractionNote,
  ContentExtractionResult,
  ContentMediaFamily,
  ContentTokenCost,
} from './types';
import { readZipEntries } from './zip';

const MAX_ARCHIVE_CHILDREN = 8;
const MAX_CONTAINER_DEPTH = 2;

type ExtractHandlerParams = {
  acquiredContent: AcquiredContent;
  abortSignal?: AbortSignal;
  traceContext?: AiTraceContext;
  channelLabel?: string;
  userCaption?: string | null;
  containerDepth: number;
  extractNestedContent: (params: {
    buffer: Buffer;
    mimeType?: string | null;
    filename?: string | null;
    originUri?: string | null;
  }) => Promise<ContentExtractionResult>;
};

type ExtractHandlerOutput = {
  extractedText: string;
  images: string[];
  structuredData: Record<string, unknown> | null;
  tokenCost: ContentTokenCost;
  degradationNotes?: ContentExtractionNote[];
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

function buildDeterministicOutput(params: {
  extractedText: string;
  structuredData?: Record<string, unknown> | null;
  degradationNotes?: ContentExtractionNote[];
}): ExtractHandlerOutput {
  return {
    extractedText: params.extractedText.trim(),
    images: [],
    structuredData: params.structuredData ?? null,
    tokenCost: normalizeUsage(null),
    degradationNotes: params.degradationNotes ?? [],
  };
}

function renderNestedExtraction(result: ContentExtractionResult): string {
  if (result.status === 'ok') {
    return result.extractedText;
  }

  const degradation = result.degradationNotes
    .map((note) => `[Content extraction degraded] ${note.message}`)
    .join('\n');

  return [degradation, result.extractedText || null].filter(Boolean).join('\n\n');
}

function isZipContainer(params: ExtractHandlerParams): boolean {
  const mimeType = params.acquiredContent.mimeType.toLowerCase();
  const filename = params.acquiredContent.filename?.toLowerCase() ?? '';
  return mimeType === 'application/zip' || filename.endsWith('.zip');
}

async function extractOfficeDocument(params: ExtractHandlerParams): Promise<ExtractHandlerOutput> {
  const filename = params.acquiredContent.filename?.toLowerCase() ?? '';
  const bytes = params.acquiredContent.bytes ?? Buffer.alloc(0);

  if (!/\.(docx|pptx|odt|odp)$/i.test(filename)) {
    return buildDeterministicOutput({
      extractedText: '',
      degradationNotes: [
        {
          code: 'unsupported_media_family',
          message: 'Content ingestion can only deterministically read DOCX, PPTX, ODT, and ODP office files right now.',
        },
      ],
    });
  }

  const entries = readZipEntries(bytes);
  const extractedText = extractOfficeDocumentText(entries, filename);
  if (!extractedText) {
    return buildDeterministicOutput({
      extractedText: '',
      degradationNotes: [
        {
          code: 'unsupported_media_family',
          message: 'The office document did not contain any deterministically readable text.',
        },
      ],
      structuredData: {
        entryCount: entries.length,
      },
    });
  }

  return buildDeterministicOutput({
    extractedText,
    structuredData: {
      entryCount: entries.length,
    },
  });
}

async function extractSpreadsheet(params: ExtractHandlerParams): Promise<ExtractHandlerOutput> {
  const filename = params.acquiredContent.filename?.toLowerCase() ?? '';
  const mimeType = params.acquiredContent.mimeType.toLowerCase();

  if (mimeType === 'text/csv' || filename.endsWith('.csv')) {
    return decodePlainText(params);
  }

  if (!/\.(xlsx|ods)$/i.test(filename)) {
    return buildDeterministicOutput({
      extractedText: '',
      degradationNotes: [
        {
          code: 'unsupported_media_family',
          message: 'Content ingestion can only deterministically read CSV, XLSX, and ODS spreadsheets right now.',
        },
      ],
    });
  }

  const entries = readZipEntries(params.acquiredContent.bytes ?? Buffer.alloc(0));
  const extractedText = extractSpreadsheetText(entries, filename);
  if (!extractedText) {
    return buildDeterministicOutput({
      extractedText: '',
      degradationNotes: [
        {
          code: 'unsupported_media_family',
          message: 'The spreadsheet did not contain any deterministically readable cells.',
        },
      ],
      structuredData: {
        entryCount: entries.length,
      },
    });
  }

  return buildDeterministicOutput({
    extractedText,
    structuredData: {
      entryCount: entries.length,
    },
  });
}

async function extractArchive(params: ExtractHandlerParams): Promise<ExtractHandlerOutput> {
  if (!isZipContainer(params)) {
    return buildDeterministicOutput({
      extractedText: '',
      degradationNotes: [
        {
          code: 'archive_format_unsupported',
          message: 'Content ingestion can only recursively inspect ZIP archives right now.',
        },
      ],
    });
  }

  if (params.containerDepth >= MAX_CONTAINER_DEPTH) {
    return buildDeterministicOutput({
      extractedText: '',
      degradationNotes: [
        {
          code: 'container_recursion_limit_exceeded',
          message: `Archive extraction stopped because nested container depth exceeded the limit of ${MAX_CONTAINER_DEPTH}.`,
        },
      ],
    });
  }

  const entries = readZipEntries(params.acquiredContent.bytes ?? Buffer.alloc(0))
    .filter((entry) => !entry.name.startsWith('__MACOSX/') && !entry.name.endsWith('.DS_Store'));

  if (entries.length === 0) {
    return buildDeterministicOutput({
      extractedText: '',
      degradationNotes: [
        {
          code: 'archive_format_unsupported',
          message: 'The ZIP archive did not contain any readable file entries.',
        },
      ],
    });
  }

  const degradationNotes: ContentExtractionNote[] = [];
  if (entries.length > MAX_ARCHIVE_CHILDREN) {
    degradationNotes.push({
      code: 'container_entry_limit_exceeded',
      message: `Archive extraction processed only the first ${MAX_ARCHIVE_CHILDREN} files in this archive.`,
    });
  }

  const childSummaries: string[] = [];
  const childStructured = [];

  for (const entry of entries.slice(0, MAX_ARCHIVE_CHILDREN)) {
    const mimeType = guessMimeTypeFromFilename(entry.name);
    const mediaFamily = resolveContentMediaFamily({
      mimeType: mimeType ?? 'application/octet-stream',
      filename: entry.name,
    });
    const childResult = await params.extractNestedContent({
      buffer: entry.data,
      mimeType,
      filename: entry.name,
      originUri: `zip://${entry.name}`,
    });

    childSummaries.push(
      [`Archive entry: ${entry.name} [${mediaFamily}]`, renderNestedExtraction(childResult)].join(
        '\n\n',
      ),
    );
    childStructured.push({
      name: entry.name,
      mediaFamily,
      status: childResult.status,
    });
  }

  return buildDeterministicOutput({
    extractedText: childSummaries.join('\n\n'),
    degradationNotes,
    structuredData: {
      entryCount: entries.length,
      processedEntryCount: Math.min(entries.length, MAX_ARCHIVE_CHILDREN),
      entries: childStructured,
    },
  });
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
    version: 'office-doc-v2',
    consumesBudget: false,
    supportsExtraction: true,
    extract: extractOfficeDocument,
  },
  spreadsheet: {
    mediaFamily: 'spreadsheet',
    version: 'spreadsheet-v2',
    consumesBudget: false,
    supportsExtraction: true,
    extract: extractSpreadsheet,
  },
  archive: {
    mediaFamily: 'archive',
    version: 'archive-v2',
    consumesBudget: false,
    supportsExtraction: true,
    extract: extractArchive,
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
