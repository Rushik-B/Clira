/**
 * Email content formatting utilities used across the queue experience.
 * The formatter aims to deliver consistent rendering for plain text,
 * markdown, and HTML emails while keeping the output sanitized.
 */

const HTML_DETECTION_PATTERN = /<(?:(?:!DOCTYPE|html|body|head)\b|\/?(?:table|tr|td|th|tbody|thead|tfoot|div|span|p|br|img|a|ul|ol|li|blockquote|pre|code|strong|em|style|script|h[1-6]|section|article)\b)/i;
const COMMENT_PATTERN = /<!--[\s\S]*?-->/g;

const BLOCKED_TAGS = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'style',
  'link',
  'meta',
  'head',
  'base',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'frame',
  'frameset'
]);

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'address', 'article', 'aside', 'audio', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'caption', 'cite',
  'code', 'col', 'colgroup', 'data', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure',
  'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'main', 'mark',
  'nav', 'ol', 'p', 'picture', 'pre', 'q', 's', 'samp', 'section', 'small', 'source', 'span', 'strong', 'sub',
  'sup', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'track', 'u', 'ul', 'var',
  'video'
]);

const GLOBAL_ATTRIBUTES = new Set(['class', 'id', 'title', 'dir', 'lang', 'role']);

const TAG_ATTRIBUTE_MAP: Record<string, Set<string>> = {
  a: new Set(['href', 'target', 'rel', 'name']),
  img: new Set(['src', 'alt', 'title', 'width', 'height']),
  blockquote: new Set(['cite']),
  table: new Set(['align', 'border', 'cellpadding', 'cellspacing', 'width']),
  td: new Set(['align', 'valign', 'colspan', 'rowspan', 'width', 'height']),
  th: new Set(['align', 'valign', 'colspan', 'rowspan', 'width', 'height']),
  tr: new Set(['align', 'valign']),
  col: new Set(['span', 'width']),
  ol: new Set(['start', 'type']),
  li: new Set(['value']),
  video: new Set(['controls', 'autoplay', 'loop', 'muted', 'poster', 'preload', 'playsinline']),
  source: new Set(['src', 'type']),
  track: new Set(['src', 'kind', 'srclang', 'label', 'default']),
  audio: new Set(['controls', 'autoplay', 'loop', 'muted', 'preload']),
  details: new Set(['open']),
  data: new Set(['value'])
};

const SAFE_HREF_PROTOCOL_PATTERN = /^(https?:|mailto:|tel:|cid:|#|data:image\/(?:[a-z0-9.+-]+);base64,)/i;
const SAFE_SRC_PROTOCOL_PATTERN = /^(https?:|cid:|data:image\/(?:[a-z0-9.+-]+);base64,)/i;

const BLOCKED_CONTENT_PATTERN = new RegExp(`<(${Array.from(BLOCKED_TAGS).join('|')})(?:[^>]*)>[\s\S]*?<\\/\\1>`, 'gi');
const BLOCKED_SELF_CLOSING_PATTERN = new RegExp(`<(${Array.from(BLOCKED_TAGS).join('|')})(?:[^>]*)\\/>`, 'gi');
const OPEN_TAG_PATTERN = /<([a-zA-Z0-9:-]+)([^<>]*?)(\/)?>/g;
const CLOSE_TAG_PATTERN = /<\/([a-zA-Z0-9:-]+)[^>]*>/g;

interface EmailFormatterOptions {
  wrapParagraphs?: boolean;
  allowInlineStyles?: boolean;
  convertLinks?: boolean;
}

const DEFAULT_FORMATTER_OPTIONS: Required<EmailFormatterOptions> = {
  wrapParagraphs: false,
  allowInlineStyles: true,
  convertLinks: true
};

interface ContentSegment {
  type: 'text' | 'code';
  content: string;
}

class EmailContentFormatter {
  private readonly content: string;
  private readonly options: Required<EmailFormatterOptions>;

  constructor(content: string, options?: EmailFormatterOptions) {
    this.content = content ?? '';
    this.options = { ...DEFAULT_FORMATTER_OPTIONS, ...options };
  }

  format(): string {
    const normalized = this.normalizeWhitespace(this.content);
    if (!normalized) {
      return '';
    }

    if (HTML_DETECTION_PATTERN.test(normalized)) {
      return this.sanitizeHtml(normalized);
    }

    const segments = this.extractSegments(normalized);
    const formatted = segments
      .map((segment) =>
        segment.type === 'code' ? this.renderCodeBlock(segment.content) : this.renderTextSegment(segment.content)
      )
      .join('');

    return this.sanitizeHtml(formatted);
  }

  private normalizeWhitespace(value: string): string {
    return value.replace(/\r\n?/g, '\n').trim();
  }

  private extractSegments(input: string): ContentSegment[] {
    const segments: ContentSegment[] = [];
    const codeRegex = /```([\s\S]*?)```/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = codeRegex.exec(input)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: 'text', content: input.slice(lastIndex, match.index) });
      }
      segments.push({ type: 'code', content: match[1] });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < input.length) {
      segments.push({ type: 'text', content: input.slice(lastIndex) });
    }

    return segments;
  }

  private renderTextSegment(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) {
      return '';
    }

    if (!this.options.wrapParagraphs) {
      return this.renderInlineBlock(trimmed);
    }

    return trimmed
      .split(/\n{2,}/)
      .map((paragraph) => this.renderParagraph(paragraph))
      .join('');
  }

  private renderParagraph(paragraph: string): string {
    if (!paragraph.trim()) {
      return '';
    }

    const escaped = escapeHtml(paragraph.trim());
    const formatted = this.applyInlineFormatting(escaped);
    const linked = this.options.convertLinks ? this.autoLink(formatted) : formatted;
    const spaced = preserveMultipleSpaces(linked);
    const withBreaks = spaced.replace(/\n/g, '<br />');
    return `<p>${withBreaks}</p>`;
  }

  private renderInlineBlock(value: string): string {
    const escaped = escapeHtml(value);
    const formatted = this.applyInlineFormatting(escaped);
    const linked = this.options.convertLinks ? this.autoLink(formatted) : formatted;
    const spaced = preserveMultipleSpaces(linked);
    return spaced.replace(/\n/g, '<br />');
  }

  private renderCodeBlock(content: string): string {
    const escaped = escapeHtml(content.trim());
    return `<pre><code>${escaped}</code></pre>`;
  }

  private applyInlineFormatting(input: string): string {
    let output = input;
    output = output.replace(/(^|\n)&gt;\s?(.*?)(?=\n|$)/g, (_, prefix: string, quoted: string) => {
      const value = quoted.trim();
      if (!value) {
        return prefix;
      }
      return `${prefix}<blockquote>${value}</blockquote>`;
    });
    output = output.replace(/`([^`]+)`/g, '<code>$1</code>');
    output = output.replace(/(\*\*|__)(.+?)\1/g, '<strong>$2</strong>');
    output = output.replace(/(\*|_)(?!\s)([^*_]+?)\1/g, '<em>$2</em>');
    output = output.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    return output;
  }

  private autoLink(input: string): string {
    let output = input;
    output = output.replace(/(^|[\s>])(https?:\/\/[\w\-._~:/?#\[\]@!$&'()*+,;=%]+)/gi, (_, prefix: string, url: string) => {
      const href = sanitizeUrl(url, true) ?? '#';
      return `${prefix}<a href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
    });
    output = output.replace(/(^|[\s>])((?:www\.)[\w\-._~:/?#\[\]@!$&'()*+,;=%]+)/gi, (_, prefix: string, url: string) => {
      const href = `https://${url}`;
      return `${prefix}<a href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
    });
    output = output.replace(/(^|[\s>])([\w.+-]+@[\w.-]+\.[a-z]{2,})/gi, (match: string, prefix: string, email: string) => {
      const href = `mailto:${email}`;
      return `${prefix}<a href="${href}">${escapeHtml(email)}</a>`;
    });
    return output;
  }

  private sanitizeHtml(html: string): string {
    let sanitized = html;
    sanitized = sanitized.replace(COMMENT_PATTERN, '');
    sanitized = sanitized.replace(BLOCKED_CONTENT_PATTERN, '');
    sanitized = sanitized.replace(BLOCKED_SELF_CLOSING_PATTERN, '');

    sanitized = sanitized.replace(OPEN_TAG_PATTERN, (match, tagName: string, rawAttrs: string, selfClosing?: string) => {
      const lowerTag = tagName.toLowerCase();
      if (BLOCKED_TAGS.has(lowerTag)) {
        return '';
      }
      if (!ALLOWED_TAGS.has(lowerTag)) {
        return '';
      }

      const attrs = this.sanitizeAttributes(lowerTag, rawAttrs ?? '');
      if (VOID_TAGS.has(lowerTag) || selfClosing === '/') {
        return `<${lowerTag}${attrs ? ` ${attrs}` : ''} />`;
      }
      return `<${lowerTag}${attrs ? ` ${attrs}` : ''}>`;
    });

    sanitized = sanitized.replace(CLOSE_TAG_PATTERN, (match, tagName: string) => {
      const lowerTag = tagName.toLowerCase();
      if (BLOCKED_TAGS.has(lowerTag) || !ALLOWED_TAGS.has(lowerTag) || VOID_TAGS.has(lowerTag)) {
        return '';
      }
      return `</${lowerTag}>`;
    });

    return sanitized;
  }

  private sanitizeAttributes(tagName: string, rawAttrs: string): string {
    if (!rawAttrs?.trim()) {
      return '';
    }

    const allowedAttributes = TAG_ATTRIBUTE_MAP[tagName] ?? new Set<string>();
    const sanitized: string[] = [];
    const attrRegex = /([a-zA-Z0-9:-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let match: RegExpExecArray | null;

    while ((match = attrRegex.exec(rawAttrs)) !== null) {
      const attrName = match[1].toLowerCase();
      const rawValue = match[3] ?? match[4] ?? match[5] ?? '';

      if (!this.isAttributeAllowed(attrName, allowedAttributes)) {
        continue;
      }

      if (attrName.startsWith('data-') || attrName.startsWith('aria-')) {
        sanitized.push(`${attrName}="${escapeAttribute(rawValue)}"`);
        continue;
      }

      if (attrName === 'style') {
        if (!this.options.allowInlineStyles) {
          continue;
        }
        const style = sanitizeStyle(rawValue);
        if (style) {
          sanitized.push(`style="${escapeAttribute(style)}"`);
        }
        continue;
      }

      if (attrName === 'href') {
        const href = sanitizeUrl(rawValue, false);
        if (href) {
          sanitized.push(`href="${escapeAttribute(href)}"`);
        }
        continue;
      }

      if (attrName === 'src') {
        const src = sanitizeUrl(rawValue, true);
        if (src) {
          sanitized.push(`src="${escapeAttribute(src)}"`);
        }
        continue;
      }

      if (attrName === 'target') {
        const target = rawValue.trim();
        if (['_self', '_blank', '_parent', '_top'].includes(target)) {
          sanitized.push(`target="${target}"`);
          if (target === '_blank') {
            sanitized.push('rel="noopener noreferrer"');
          }
        }
        continue;
      }

      sanitized.push(`${attrName}="${escapeAttribute(rawValue)}"`);
    }

    return dedupeAttributes(sanitized).join(' ');
  }

  private isAttributeAllowed(attrName: string, tagSpecific: Set<string>): boolean {
    if (attrName.startsWith('on')) {
      return false;
    }

    if (GLOBAL_ATTRIBUTES.has(attrName)) {
      return true;
    }

    if (attrName.startsWith('aria-') || attrName.startsWith('data-')) {
      return true;
    }

    if (attrName === 'style') {
      return true;
    }

    return tagSpecific.has(attrName);
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function preserveMultipleSpaces(value: string): string {
  return value.replace(/ {2,}/g, (match) => `${'&nbsp;'.repeat(match.length - 1)} `);
}

function sanitizeUrl(value: string, isSrc: boolean): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('#')) {
    return trimmed;
  }

  if (!isSrc && SAFE_HREF_PROTOCOL_PATTERN.test(trimmed)) {
    return trimmed;
  }

  if (isSrc && SAFE_SRC_PROTOCOL_PATTERN.test(trimmed)) {
    return trimmed;
  }

  if (!trimmed.includes(':') && trimmed.startsWith('www.')) {
    return `https://${trimmed}`;
  }

  return null;
}

function sanitizeStyle(value: string): string {
  const withoutComments = value.replace(/\/\*[\s\S]*?\*\//g, '');
  const declarations = withoutComments
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((declaration) => {
      const [property, ...rest] = declaration.split(':');
      if (!property || rest.length === 0) {
        return '';
      }
      const propName = property.trim().toLowerCase();
      const propValue = rest.join(':').trim();
      if (!propValue) {
        return '';
      }
      if (/expression\s*\(/i.test(propValue)) {
        return '';
      }
      if (/url\(\s*javascript:/i.test(propValue)) {
        return '';
      }
      if (/url\(\s*data:/i.test(propValue) && !/url\(\s*data:image\//i.test(propValue)) {
        return '';
      }
      return `${propName}: ${propValue}`;
    })
    .filter(Boolean);

  return declarations.join('; ');
}

function dedupeAttributes(entries: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of entries) {
    const key = entry.split('=')[0];
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(entry);
  }
  return result;
}

/**
 * Format short email snippets (used for previews).
 */
export function formatEmailContent(content: string): string {
  return new EmailContentFormatter(content, {
    wrapParagraphs: false,
    allowInlineStyles: false,
    convertLinks: true
  }).format();
}

/**
 * Format long-form email bodies with robust sanitisation.
 */
export function formatEmailContentEnhanced(content: string): string {
  return new EmailContentFormatter(content, {
    wrapParagraphs: false,
    allowInlineStyles: true,
    convertLinks: true
  }).format();
}

/**
 * Format incoming emails for viewer/editor surfaces to ensure consistency.
 */
export function formatIncomingEmailContent(content: string): string {
  return new EmailContentFormatter(content, {
    wrapParagraphs: false,
    allowInlineStyles: true,
    convertLinks: true
  }).format();
}

/**
 * Calculate content height for responsive sizing.
 */
export function calculateContentHeight(content: string, minHeight: number = 8, maxHeight: number = 20): number {
  if (!content) return minHeight;

  const lineCount = content.split('\n').length;
  const calculatedHeight = lineCount * 1.5;

  return Math.min(Math.max(calculatedHeight, minHeight), maxHeight);
}

/**
 * Truncate email content for previews.
 */
export function truncateContent(content: string, maxLength: number = 500): string {
  if (!content || content.length <= maxLength) return content;

  return `${content.substring(0, maxLength)}...`;
}
