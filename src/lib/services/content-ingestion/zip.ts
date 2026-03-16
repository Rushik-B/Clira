import { inflateRawSync } from 'node:zlib';

export type ZipEntry = {
  name: string;
  data: Buffer;
  compressedSize: number;
  uncompressedSize: number;
};

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

function isDirectoryEntry(name: string): boolean {
  return name.endsWith('/');
}

function decodeZipEntryName(buffer: Buffer): string {
  return buffer.toString('utf8').replace(/\\/g, '/');
}

function inflateEntryData(params: {
  compressionMethod: number;
  compressedData: Buffer;
}): Buffer | null {
  if (params.compressionMethod === 0) {
    return params.compressedData;
  }

  if (params.compressionMethod === 8) {
    return inflateRawSync(params.compressedData);
  }

  return null;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minimumOffset = Math.max(0, buffer.length - 0xffff - 22);

  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset;
    }
  }

  return -1;
}

function readEntriesFromCentralDirectory(buffer: Buffer): ZipEntry[] | null {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) {
    return null;
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const directoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries: ZipEntry[] = [];
  let offset = directoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset + 46 > buffer.length ||
      buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE
    ) {
      return null;
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraFieldLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;

    if (nameEnd > buffer.length) {
      return null;
    }

    const name = decodeZipEntryName(buffer.subarray(nameStart, nameEnd));
    offset = nameEnd + extraFieldLength + commentLength;

    if (isDirectoryEntry(name)) {
      continue;
    }

    if (
      localHeaderOffset + 30 > buffer.length ||
      buffer.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_HEADER_SIGNATURE
    ) {
      return null;
    }

    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;

    if (dataEnd > buffer.length) {
      return null;
    }

    const inflated = inflateEntryData({
      compressionMethod,
      compressedData: buffer.subarray(dataStart, dataEnd),
    });
    if (!inflated) {
      continue;
    }

    entries.push({
      name,
      data: inflated,
      compressedSize,
      uncompressedSize,
    });
  }

  return entries;
}

function readEntriesFromLocalHeaders(buffer: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;

  while (offset + 30 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== LOCAL_FILE_HEADER_SIGNATURE) {
      break;
    }

    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraFieldLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    const dataStart = nameEnd + extraFieldLength;
    const dataEnd = dataStart + compressedSize;

    if (dataEnd > buffer.length) {
      break;
    }

    const name = decodeZipEntryName(buffer.subarray(nameStart, nameEnd));
    offset = dataEnd;

    if (isDirectoryEntry(name)) {
      continue;
    }

    const inflated = inflateEntryData({
      compressionMethod,
      compressedData: buffer.subarray(dataStart, dataEnd),
    });
    if (!inflated) {
      continue;
    }

    entries.push({
      name,
      data: inflated,
      compressedSize,
      uncompressedSize,
    });
  }

  return entries;
}

export function readZipEntries(buffer: Buffer): ZipEntry[] {
  return readEntriesFromCentralDirectory(buffer) ?? readEntriesFromLocalHeaders(buffer);
}
