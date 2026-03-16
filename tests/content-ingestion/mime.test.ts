import { describe, expect, test } from 'vitest';
import {
  guessMimeTypeFromFilename,
  sniffMimeFromBytes,
} from '@/lib/services/content-ingestion';

function createZipLocalFileEntry(filename: string, content = ''): Buffer {
  const filenameBuffer = Buffer.from(filename, 'utf8');
  const contentBuffer = Buffer.from(content, 'utf8');
  const header = Buffer.alloc(30);

  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(contentBuffer.length, 18);
  header.writeUInt32LE(contentBuffer.length, 22);
  header.writeUInt16LE(filenameBuffer.length, 26);
  header.writeUInt16LE(0, 28);

  return Buffer.concat([header, filenameBuffer, contentBuffer]);
}

describe('content-ingestion mime sniffing', () => {
  test('detects common binary formats from bytes', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
    const pngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2NkYGD4DwABBAEAQa4K/QAAAABJRU5ErkJggg==',
      'base64',
    );
    const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08]);
    const oggBuffer = Buffer.concat([
      Buffer.from('OggS', 'ascii'),
      Buffer.alloc(24),
      Buffer.from([0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73, 0x00]),
    ]);
    const mp3Buffer = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x21]);
    const docxBuffer = createZipLocalFileEntry('word/document.xml', '<w:document />');

    await expect(sniffMimeFromBytes(pdfBuffer)).resolves.toBe('application/pdf');
    await expect(sniffMimeFromBytes(pngBuffer)).resolves.toBe('image/png');
    await expect(sniffMimeFromBytes(jpegBuffer)).resolves.toBe('image/jpeg');
    await expect(sniffMimeFromBytes(oggBuffer)).resolves.toBe('audio/ogg');
    await expect(sniffMimeFromBytes(mp3Buffer)).resolves.toBe('audio/mpeg');
    await expect(sniffMimeFromBytes(docxBuffer)).resolves.toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  test('returns null for empty or unknown buffers', async () => {
    await expect(sniffMimeFromBytes(Buffer.alloc(0))).resolves.toBeNull();
    await expect(sniffMimeFromBytes(Buffer.from('plain text only'))).resolves.toBeNull();
  });

  test('falls back to filename hints when bytes are inconclusive', () => {
    expect(guessMimeTypeFromFilename('report.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(guessMimeTypeFromFilename('notes.txt')).toBe('text/plain');
    expect(guessMimeTypeFromFilename('unknown.bin')).toBeNull();
  });
});
