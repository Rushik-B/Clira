import crypto from 'node:crypto';
import path from 'node:path';
import { fromBuffer } from 'file-type';
import { logger } from '@/lib/logger';

const FILENAME_MIME_HINTS: Record<string, string> = {
  '.7z': 'application/x-7z-compressed',
  '.csv': 'text/csv',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.gif': 'image/gif',
  '.htm': 'text/html',
  '.html': 'text/html',
  '.ics': 'text/calendar',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.m4a': 'audio/mp4',
  '.md': 'text/markdown',
  '.mp3': 'audio/mpeg',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.rar': 'application/vnd.rar',
  '.tar': 'application/x-tar',
  '.txt': 'text/plain',
  '.wav': 'audio/wav',
  '.webp': 'image/webp',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
};

function normalizeWhitespace(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeMimeType(value?: string | null): string | null {
  if (!value) return null;

  const trimmed = normalizeWhitespace(value);
  if (!trimmed) return null;

  const [type] = trimmed.split(';', 1);
  return type?.trim() || null;
}

export function guessMimeTypeFromFilename(filename?: string | null): string | null {
  if (!filename) return null;
  const extension = path.extname(filename).toLowerCase();
  return FILENAME_MIME_HINTS[extension] ?? null;
}

export async function sniffMimeFromBytes(buffer: Buffer): Promise<string | null> {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return null;
  }

  try {
    const result = await fromBuffer(buffer);
    return normalizeMimeType(result?.mime) ?? null;
  } catch {
    return null;
  }
}

export async function resolveContentMimeType(params: {
  buffer: Buffer;
  declaredMimeType?: string | null;
  filename?: string | null;
  loggerContext?: Record<string, unknown>;
}): Promise<{
  mimeType: string;
  declaredMimeType: string | null;
  sniffedMimeType: string | null;
  filenameHintMimeType: string | null;
}> {
  const declaredMimeType = normalizeMimeType(params.declaredMimeType);
  const sniffedMimeType = await sniffMimeFromBytes(params.buffer);
  const filenameHintMimeType = guessMimeTypeFromFilename(params.filename);

  if (declaredMimeType && sniffedMimeType && declaredMimeType !== sniffedMimeType) {
    logger.warn('[contentIngestion] mime mismatch; using sniffed mime type', {
      ...params.loggerContext,
      declaredMimeType,
      sniffedMimeType,
      filename: params.filename ?? null,
    });
  }

  return {
    mimeType: sniffedMimeType ?? declaredMimeType ?? filenameHintMimeType ?? 'application/octet-stream',
    declaredMimeType,
    sniffedMimeType,
    filenameHintMimeType,
  };
}

export function computeBufferSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
