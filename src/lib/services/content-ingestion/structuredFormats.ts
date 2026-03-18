import type { ZipEntry } from './zip';

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function normalizeExtractedText(value: string): string {
  return decodeXmlEntities(value)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function extractXmlText(xml: string): string {
  return normalizeExtractedText(
    xml
      .replace(/<\?xml[\s\S]*?\?>/g, '')
      .replace(/<(?:w:tab|tab)[^>]*\/>/g, '\t')
      .replace(/<(?:w:br|text:line-break|a:br)[^>]*\/>/g, '\n')
      .replace(/<\/(?:w:p|a:p|text:p|text:h|row|table:table-row)>/g, '\n')
      .replace(/<\/(?:w:tr|w:tbl|table:table|sheetData)>/g, '\n')
      .replace(/<\/(?:w:tc|c|table:table-cell)>/g, '\t')
      .replace(/<[^>]+>/g, '')
      .replace(/\t{2,}/g, '\t'),
  );
}

function naturalSort(values: string[]): string[] {
  return [...values].sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }),
  );
}

function getEntryText(entries: Map<string, ZipEntry>, name: string): string | null {
  const entry = entries.get(name);
  if (!entry) {
    return null;
  }

  return entry.data.toString('utf8');
}

function collectEntryTexts(entries: Map<string, ZipEntry>, prefix: string, suffix: RegExp): string[] {
  return naturalSort(
    [...entries.keys()].filter((name) => name.startsWith(prefix) && suffix.test(name)),
  )
    .map((name) => extractXmlText(entries.get(name)!.data.toString('utf8')))
    .filter(Boolean);
}

function parseSharedStrings(xml: string | null): string[] {
  if (!xml) {
    return [];
  }

  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    extractXmlText(match[1] ?? ''),
  );
}

function extractWorksheetRows(xml: string, sharedStrings: string[]): string {
  const rows = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
    const rowXml = rowMatch[1] ?? '';
    const cells = [...rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)].map((cellMatch) => {
      const attributes = cellMatch[1] ?? '';
      const cellXml = cellMatch[2] ?? '';
      const typeMatch = /t="([^"]+)"/.exec(attributes);
      const cellType = typeMatch?.[1] ?? null;

      if (cellType === 'inlineStr') {
        const inlineMatch = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(cellXml);
        return extractXmlText(inlineMatch?.[1] ?? '');
      }

      const valueMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cellXml);
      const rawValue = valueMatch ? extractXmlText(valueMatch[1] ?? '') : '';
      if (cellType === 's') {
        const sharedStringIndex = Number.parseInt(rawValue, 10);
        return Number.isFinite(sharedStringIndex)
          ? (sharedStrings[sharedStringIndex] ?? '')
          : '';
      }

      return rawValue;
    });

    return cells.filter(Boolean).join('\t').trim();
  });

  return normalizeExtractedText(rows.filter(Boolean).join('\n'));
}

export function extractOfficeDocumentText(entries: ZipEntry[], filename?: string | null): string {
  const entryMap = new Map(entries.map((entry) => [entry.name, entry]));
  const normalizedFilename = filename?.toLowerCase() ?? '';

  if (normalizedFilename.endsWith('.docx')) {
    return normalizeExtractedText(
      [
        extractXmlText(getEntryText(entryMap, 'word/document.xml') ?? ''),
        ...collectEntryTexts(entryMap, 'word/header', /\.xml$/),
        ...collectEntryTexts(entryMap, 'word/footer', /\.xml$/),
        extractXmlText(getEntryText(entryMap, 'word/footnotes.xml') ?? ''),
        extractXmlText(getEntryText(entryMap, 'word/endnotes.xml') ?? ''),
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
  }

  if (normalizedFilename.endsWith('.pptx')) {
    return normalizeExtractedText(
      [
        ...collectEntryTexts(entryMap, 'ppt/slides/', /slide\d+\.xml$/),
        ...collectEntryTexts(entryMap, 'ppt/notesSlides/', /notesSlide\d+\.xml$/),
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
  }

  return extractXmlText(getEntryText(entryMap, 'content.xml') ?? '');
}

export function extractSpreadsheetText(entries: ZipEntry[], filename?: string | null): string {
  const entryMap = new Map(entries.map((entry) => [entry.name, entry]));
  const normalizedFilename = filename?.toLowerCase() ?? '';

  if (normalizedFilename.endsWith('.xlsx')) {
    const sharedStrings = parseSharedStrings(getEntryText(entryMap, 'xl/sharedStrings.xml'));
    const sheetNames = naturalSort(
      [...entryMap.keys()].filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)),
    );

    return normalizeExtractedText(
      sheetNames
        .map((sheetName, index) => {
          const sheetText = extractWorksheetRows(
            entryMap.get(sheetName)?.data.toString('utf8') ?? '',
            sharedStrings,
          );
          if (!sheetText) {
            return null;
          }

          return [`Sheet ${index + 1}:`, sheetText].join('\n');
        })
        .filter(Boolean)
        .join('\n\n'),
    );
  }

  return extractXmlText(getEntryText(entryMap, 'content.xml') ?? '');
}
