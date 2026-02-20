'use client';

import { marked } from 'marked';
import { memo, useMemo } from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

/**
 * Parse markdown into blocks for memoization.
 * Each block is memoized separately so only the currently streaming block re-renders.
 */
function parseMarkdownIntoBlocks(markdown: string): string[] {
  const tokens = marked.lexer(markdown);
  return tokens.map((token) => token.raw);
}

/**
 * Custom components for ReactMarkdown to style markdown elements.
 * Optimized for dark theme chat UI.
 */
const markdownComponents: Components = {
  // Headings
  h1: ({ children }) => (
    <h1 className="text-xl font-bold text-slate-100 mt-4 mb-2 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-lg font-semibold text-slate-100 mt-3 mb-2 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-base font-semibold text-slate-200 mt-3 mb-1.5 first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-sm font-semibold text-slate-200 mt-2 mb-1 first:mt-0">{children}</h4>
  ),

  // Paragraphs
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,

  // Lists
  ul: ({ children }) => <ul className="list-disc list-outside ml-4 mb-2 space-y-1">{children}</ul>,
  ol: ({ children }) => (
    <ol className="list-decimal list-outside ml-4 mb-2 space-y-1">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,

  // Links
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2 transition-colors"
    >
      {children}
    </a>
  ),

  // Emphasis
  strong: ({ children }) => <strong className="font-semibold text-slate-100">{children}</strong>,
  em: ({ children }) => <em className="italic text-slate-200">{children}</em>,

  // Strikethrough (GFM)
  del: ({ children }) => <del className="line-through text-slate-400">{children}</del>,

  // Inline code
  code: ({ children, className }) => {
    // Check if this is a code block (has language class) or inline code
    const isCodeBlock = className?.includes('language-');
    if (isCodeBlock) {
      // Let the pre component handle code blocks
      return <code className={className}>{children}</code>;
    }
    // Inline code
    return (
      <code className="px-1.5 py-0.5 bg-slate-800 text-emerald-300 rounded text-[0.9em] font-mono">
        {children}
      </code>
    );
  },

  // Code blocks
  pre: ({ children }) => (
    <pre className="bg-slate-800/80 border border-slate-700/50 rounded-lg p-3 my-2 overflow-x-auto text-sm font-mono text-slate-200">
      {children}
    </pre>
  ),

  // Blockquotes
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-emerald-500/50 pl-3 my-2 text-slate-300 italic">
      {children}
    </blockquote>
  ),

  // Horizontal rule
  hr: () => <hr className="border-slate-700 my-4" />,

  // Tables (GFM)
  table: ({ children }) => (
    <div className="overflow-x-auto my-2">
      <table className="min-w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-slate-800/50">{children}</thead>,
  tbody: ({ children }) => <tbody className="divide-y divide-slate-700/50">{children}</tbody>,
  tr: ({ children }) => <tr className="border-b border-slate-700/50">{children}</tr>,
  th: ({ children }) => (
    <th className="px-3 py-2 text-left font-semibold text-slate-200 border-b border-slate-600">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="px-3 py-2 text-slate-300">{children}</td>,

  // Task lists (GFM)
  input: ({ checked, disabled, ...props }) => (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      className="mr-2 rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500/20"
      {...props}
    />
  ),
};

/**
 * Memoized single markdown block.
 * Only re-renders when content changes.
 */
const MemoizedMarkdownBlock = memo(
  ({ content }: { content: string }) => {
    return (
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    );
  },
  (prevProps, nextProps) => prevProps.content === nextProps.content,
);

MemoizedMarkdownBlock.displayName = 'MemoizedMarkdownBlock';

/**
 * MemoizedMarkdown component for efficient streaming markdown rendering.
 *
 * Parses markdown into blocks and memoizes each block separately.
 * During streaming, only the last block (being written) re-renders.
 *
 * @param content - The markdown content to render
 * @param id - Unique identifier for stable keys
 * @param className - Optional additional classes
 */
export const MemoizedMarkdown = memo(
  ({ content, id, className }: { content: string; id: string; className?: string }) => {
    const blocks = useMemo(() => parseMarkdownIntoBlocks(content), [content]);

    return (
      <div className={cn('markdown-content', className)}>
        {blocks.map((block, index) => (
          <MemoizedMarkdownBlock content={block} key={`${id}-block_${index}`} />
        ))}
      </div>
    );
  },
);

MemoizedMarkdown.displayName = 'MemoizedMarkdown';

/**
 * Simple non-memoized markdown renderer for static content.
 * Use MemoizedMarkdown for streaming content.
 */
export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={cn('markdown-content', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
