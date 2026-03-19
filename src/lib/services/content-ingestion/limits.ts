import type { ContentMediaFamily } from './types';

export type ContentExtractionLimit = {
  maxBytes: number | null;
  maxPages?: number | null;
  maxDurationSeconds?: number | null;
  consumesBudget: boolean;
};

const MB = 1024 * 1024;

export const CONTENT_EXTRACTION_LIMITS: Record<ContentMediaFamily, ContentExtractionLimit> = {
  pdf: {
    maxBytes: 10 * MB,
    maxPages: 50,
    consumesBudget: true,
  },
  image: {
    maxBytes: 5 * MB,
    consumesBudget: true,
  },
  audio: {
    maxBytes: 25 * MB,
    maxDurationSeconds: 10 * 60,
    consumesBudget: true,
  },
  text: {
    maxBytes: 2 * MB,
    consumesBudget: false,
  },
  html: {
    maxBytes: 2 * MB,
    consumesBudget: false,
  },
  office_doc: {
    maxBytes: 10 * MB,
    consumesBudget: false,
  },
  spreadsheet: {
    maxBytes: 10 * MB,
    consumesBudget: false,
  },
  archive: {
    maxBytes: 10 * MB,
    consumesBudget: false,
  },
  unknown_binary: {
    maxBytes: 10 * MB,
    consumesBudget: false,
  },
};

const OFFICE_DOC_MIME_TYPES = new Set([
  'application/msword',
  'application/vnd.ms-powerpoint',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const SPREADSHEET_MIME_TYPES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
]);

const ARCHIVE_MIME_TYPES = new Set([
  'application/gzip',
  'application/rar',
  'application/vnd.rar',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
  'application/x-tar',
  'application/zip',
]);

export function resolveContentMediaFamily(params: {
  mimeType: string;
  filename?: string | null;
}): ContentMediaFamily {
  const mimeType = params.mimeType.toLowerCase();
  const filename = params.filename?.toLowerCase() ?? null;

  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'text/html' || mimeType === 'application/xhtml+xml') return 'html';
  if (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'text/xml'
  ) {
    if (mimeType === 'text/csv') return 'spreadsheet';
    return 'text';
  }
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (OFFICE_DOC_MIME_TYPES.has(mimeType)) return 'office_doc';
  if (SPREADSHEET_MIME_TYPES.has(mimeType)) return 'spreadsheet';
  if (ARCHIVE_MIME_TYPES.has(mimeType)) return 'archive';

  if (filename?.endsWith('.pdf')) return 'pdf';
  if (filename && /\.(txt|md|json|xml|ics)$/i.test(filename)) return 'text';
  if (filename && /\.(html|htm)$/i.test(filename)) return 'html';
  if (filename && /\.(png|jpe?g|gif|webp)$/i.test(filename)) return 'image';
  if (filename && /\.(ogg|oga|opus|mp3|wav|m4a)$/i.test(filename)) return 'audio';
  if (filename && /\.(docx|odt|pptx|odp)$/i.test(filename)) return 'office_doc';
  if (filename && /\.(xlsx|ods|csv)$/i.test(filename)) return 'spreadsheet';
  if (filename && /\.(zip|tar|rar|7z)$/i.test(filename)) return 'archive';

  return 'unknown_binary';
}

export function estimatePdfPageCount(buffer: Buffer): number | null {
  if (buffer.length === 0) return null;

  const content = buffer.toString('latin1');
  const matches = content.match(/\/Type\s*\/Page\b/g);
  return matches ? matches.length : null;
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
