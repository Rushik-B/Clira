export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function stripHtml(input: string): string {
  return normalizeWhitespace(input.replace(/<[^>]*>/g, ' '));
}

const HTML_BLOCK_TAG_REGEX =
  /<\/?(address|article|aside|blockquote|br|div|dl|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tr|ul)[^>]*>/gi;
const HTML_SCRIPT_STYLE_REGEX = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
const HTML_ANCHOR_TAG_REGEX =
  /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function normalizeWhitespacePreservingNewlines(input: string): string {
  return input
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function stripHtmlPreservingNewlines(input: string): string {
  const withLinksPreserved = input.replace(
    HTML_ANCHOR_TAG_REGEX,
    (_match, doubleQuotedHref, singleQuotedHref, bareHref, innerHtml) => {
      const href = (doubleQuotedHref || singleQuotedHref || bareHref || '').trim();
      const text = stripHtmlPreservingNewlines(innerHtml);
      if (!href) {
        return text;
      }
      if (!text) {
        return href;
      }
      return text.includes(href) ? text : `${text} ${href}`;
    },
  );

  return normalizeWhitespacePreservingNewlines(
    decodeHtmlEntities(
      withLinksPreserved
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(HTML_SCRIPT_STYLE_REGEX, ' ')
        .replace(HTML_BLOCK_TAG_REGEX, '\n')
        .replace(/<[^>]*>/g, ' '),
    ),
  );
}

export function extractUrlsFromText(input: string): string[] {
  const matches = input.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const match of matches) {
    const normalized = match.trim().replace(/[),.;:!?]+$/g, '');
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    urls.push(normalized);
  }

  return urls;
}

export function appendUniqueUrlsToBodyText(bodyText: string, urls: readonly string[]): string {
  const trimmedBody = bodyText.trim();
  const existingUrls = new Set(extractUrlsFromText(trimmedBody));
  const missingUrls = urls.filter((url) => url && !existingUrls.has(url));

  if (missingUrls.length === 0) {
    return trimmedBody;
  }

  const linksBlock = ['Links:', ...missingUrls].join('\n');
  return trimmedBody ? `${trimmedBody}\n\n${linksBlock}` : linksBlock;
}
