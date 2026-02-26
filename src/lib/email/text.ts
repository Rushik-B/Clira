export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function stripHtml(input: string): string {
  return normalizeWhitespace(input.replace(/<[^>]*>/g, ' '));
}

const HTML_BLOCK_TAG_REGEX =
  /<\/?(address|article|aside|blockquote|br|div|dl|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tr|ul)[^>]*>/gi;

export function stripHtmlPreservingNewlines(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(HTML_BLOCK_TAG_REGEX, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}
