const TELEGRAM_CODE_BLOCK_TOKEN_PATTERN = /@@TELEGRAM_CODE_BLOCK_(\d+)@@/;
const TELEGRAM_LINK_TOKEN_PATTERN = /@@TELEGRAM_LINK_(\d+)@@/g;

function escapeHtml(input: string): string {
  return input.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeHtmlAttribute(input: string): string {
  return escapeHtml(input).replaceAll('"', '&quot;');
}

function formatInlineMarkdownForTelegramHtml(text: string): string {
  const linkTokens: string[] = [];
  const withLinkTokens = text.replace(/\[([^\]\n]+?)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => {
    const token = `@@TELEGRAM_LINK_${linkTokens.length}@@`;
    linkTokens.push(`<a href="${escapeHtmlAttribute(url)}">${escapeHtml(label)}</a>`);
    return token;
  });

  let escaped = escapeHtml(withLinkTokens);
  escaped = escaped
    .replace(/\*\*\*([^\n*][\s\S]*?)\*\*\*/g, '<b>$1</b>')
    .replace(/\*\*([^\n*][\s\S]*?)\*\*/g, '<b>$1</b>')
    .replace(/__([^_\n][\s\S]*?)__/g, '<b>$1</b>')
    .replace(/`([^`\n]+?)`/g, '<code>$1</code>')
    .replace(/\*(?!\s)([^*\n]+?)\*/g, '<b>$1</b>');

  return escaped.replace(TELEGRAM_LINK_TOKEN_PATTERN, (_, indexRaw) => {
    const index = Number(indexRaw);
    return linkTokens[index] ?? '';
  });
}

export function normalizeMarkdownForTelegram(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return '';

  const codeBlockTokens: string[] = [];
  const withCodeTokens = normalized.replace(
    /```([a-zA-Z0-9_-]+)?\n?([\s\S]*?)```/g,
    (_, languageRaw, codeRaw) => {
      const token = `@@TELEGRAM_CODE_BLOCK_${codeBlockTokens.length}@@`;
      const language =
        typeof languageRaw === 'string' && /^[a-zA-Z0-9_-]+$/.test(languageRaw) ? languageRaw : '';
      const code = typeof codeRaw === 'string' ? codeRaw.replace(/^\n/, '').replace(/\n$/, '') : '';
      const languageAttribute = language ? ` class="language-${language}"` : '';
      codeBlockTokens.push(`<pre><code${languageAttribute}>${escapeHtml(code)}</code></pre>`);
      return token;
    },
  );

  const html = withCodeTokens
    .split('\n')
    .map((line) => {
      if (!line.trim()) return '';

      const codeTokenMatch = TELEGRAM_CODE_BLOCK_TOKEN_PATTERN.exec(line.trim());
      if (codeTokenMatch && codeTokenMatch[0] === line.trim()) {
        const index = Number(codeTokenMatch[1] ?? -1);
        return codeBlockTokens[index] ?? '';
      }

      const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
      const lineWithoutHeading = headingMatch
        ? `**${(headingMatch[2] ?? '').trim()}**`
        : line;

      const bulletMatch = /^(\s*)[*-]\s+/.exec(lineWithoutHeading);
      const withTelegramBullets = bulletMatch
        ? `${bulletMatch[1] ?? ''}• ${lineWithoutHeading.slice(bulletMatch[0].length)}`
        : lineWithoutHeading;

      return formatInlineMarkdownForTelegramHtml(withTelegramBullets);
    })
    .join('\n');

  return html.replace(/@@TELEGRAM_CODE_BLOCK_(\d+)@@/g, (_, indexRaw) => {
    const index = Number(indexRaw);
    return codeBlockTokens[index] ?? '';
  });
}
