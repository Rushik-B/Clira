/**
 * Email Content Pruner for Supermemory
 *
 * Prepares email content for summarization by:
 * - Stripping quoted replies and signatures
 * - Removing legal disclaimers
 * - Normalizing whitespace
 * - Applying character caps per message
 *
 * Per SUPERMEMORY.md Section 5, Step 4:
 * "per-message 'new content' prune" to avoid exponential duplication
 * from quoted content in email threads.
 */

import { DEFAULT_BOOTSTRAP_CONFIG } from './types';

/**
 * Prune a single email body for thread summarization
 * Keeps only the "new content" portion of the message
 *
 * @param body - Raw email body
 * @param maxChars - Maximum characters to keep (default: 2200 per plan)
 * @returns Pruned body content
 */
export function pruneEmailBodyForSummary(
  body: string,
  maxChars: number = DEFAULT_BOOTSTRAP_CONFIG.PER_MESSAGE_BODY_CAP,
): string {
  if (!body) return '';

  let text = body.trim();

  // 1. Strip quoted reply sections
  text = stripQuotedReplies(text);

  // 2. Strip signature blocks
  text = stripSignatures(text);

  // 3. Strip legal disclaimers
  text = stripLegalDisclaimers(text);

  // 4. Normalize whitespace
  text = normalizeWhitespace(text);

  // 5. Apply character cap
  if (text.length > maxChars) {
    text = text.slice(0, maxChars - 3) + '...';
  }

  return text;
}

/**
 * Strip quoted reply sections from email body
 * Common patterns: "On ... wrote:", "From: ... Sent: ..."
 */
function stripQuotedReplies(text: string): string {
  if (!text) return '';

  // Pattern 1: "On [date] [person] wrote:"
  const onWroteMatch = text.match(/\n\s*On\s+.{10,80}\s+wrote:\s*\n/i);
  if (onWroteMatch && onWroteMatch.index !== undefined) {
    text = text.slice(0, onWroteMatch.index);
  }

  // Pattern 2: "From: ... Sent: ..." (Outlook style)
  const fromSentMatch = text.match(/\n\s*From:\s*.+\n\s*Sent:\s*.+\n/i);
  if (fromSentMatch && fromSentMatch.index !== undefined) {
    text = text.slice(0, fromSentMatch.index);
  }

  // Pattern 3: Lines starting with ">" (quoted text)
  const lines = text.split('\n');
  const filteredLines: string[] = [];
  let hitQuotedBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    // If we hit multiple consecutive quoted lines, stop including content
    if (trimmed.startsWith('>')) {
      hitQuotedBlock = true;
      // Skip single quoted lines that might be inline quotes
      if (filteredLines.length > 0 && !filteredLines[filteredLines.length - 1]!.trim().startsWith('>')) {
        continue; // Skip this quoted line but keep going
      }
    } else if (hitQuotedBlock && trimmed.length === 0) {
      // Empty line after quoted block - might be end of quote
      continue;
    } else {
      hitQuotedBlock = false;
    }

    if (!hitQuotedBlock) {
      filteredLines.push(line);
    }
  }

  return filteredLines.join('\n').trim();
}

/**
 * Strip signature blocks from email body
 * Common patterns: "-- ", "Sent from my iPhone", etc.
 */
function stripSignatures(text: string): string {
  if (!text) return '';

  // Pattern 1: Standard signature separator "-- " (with trailing space) or "--"
  const sigSepMatch = text.match(/\n\s*--\s*\n/);
  if (sigSepMatch && sigSepMatch.index !== undefined) {
    text = text.slice(0, sigSepMatch.index);
  }

  // Pattern 2: "Sent from my [Device]"
  const sentFromMatch = text.match(/\n\s*Sent from my [\w\s]+\s*$/i);
  if (sentFromMatch && sentFromMatch.index !== undefined) {
    text = text.slice(0, sentFromMatch.index);
  }

  // Pattern 3: "Get Outlook for [Platform]"
  const outlookMatch = text.match(/\n\s*Get Outlook for [\w\s]+\s*$/i);
  if (outlookMatch && outlookMatch.index !== undefined) {
    text = text.slice(0, outlookMatch.index);
  }

  // Pattern 4: Common closing + signature block (simplified)
  // e.g., "Best regards,\n[Name]\n[Title]..."
  // Only strip if it's at the very end
  const closingPatterns = [
    /\n\s*(Best regards|Kind regards|Regards|Best|Thanks|Thank you|Cheers),?\s*\n.{0,300}$/i,
  ];

  for (const pattern of closingPatterns) {
    const match = text.match(pattern);
    if (match && match.index !== undefined && text.length - match.index < 400) {
      // Only strip if signature portion is reasonably short
      text = text.slice(0, match.index);
    }
  }

  return text.trim();
}

/**
 * Strip legal disclaimers and confidentiality notices
 */
function stripLegalDisclaimers(text: string): string {
  if (!text) return '';

  // Common legal disclaimer patterns
  const disclaimerPatterns = [
    /\n\s*This\s+email\s+and\s+any\s+attachments[\s\S]*$/i,
    /\n\s*CONFIDENTIALITY\s+NOTICE[\s\S]*$/i,
    /\n\s*This\s+message\s+is\s+intended\s+only[\s\S]*$/i,
    /\n\s*DISCLAIMER[\s\S]*$/i,
    /\n\s*This\s+communication\s+is\s+confidential[\s\S]*$/i,
    /\n\s*The\s+information\s+contained\s+in\s+this\s+email[\s\S]*$/i,
  ];

  for (const pattern of disclaimerPatterns) {
    text = text.replace(pattern, '');
  }

  return text.trim();
}

/**
 * Normalize whitespace in email body
 */
function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n') // Windows line endings
    .replace(/\r/g, '\n') // Old Mac line endings
    .replace(/\t/g, ' ') // Tabs to spaces
    .replace(/\u00A0/g, ' ') // Non-breaking spaces
    .replace(/[ ]{2,}/g, ' ') // Multiple spaces
    .replace(/\n{3,}/g, '\n\n') // Multiple newlines
    .trim();
}

/**
 * Extract the "direction" marker for a message in thread context
 * Used in the summarizer prompt
 */
export function getMessageDirectionMarker(isSent: boolean, userEmail?: string): string {
  return isSent ? '[YOU]' : '[THEY]';
}

/**
 * Format a message for the thread summarizer prompt
 */
export function formatMessageForSummarizer(params: {
  from: string;
  to: string[];
  cc: string[];
  body: string;
  date: Date;
  isSent: boolean;
  userEmail?: string;
}): string {
  const direction = getMessageDirectionMarker(params.isSent, params.userEmail);
  const dateStr = params.date.toISOString();
  const prunedBody = pruneEmailBodyForSummary(params.body);

  const recipients = params.to.join(', ');
  const ccList = params.cc.length > 0 ? `\nCc: ${params.cc.join(', ')}` : '';

  return `${direction} (${dateStr})
From: ${params.from}
To: ${recipients}${ccList}

${prunedBody}`;
}

/**
 * Estimate token count from character count
 * Per SUPERMEMORY.md: tokens ≈ chars / 4
 */
export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 4);
}

