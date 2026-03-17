import { prisma } from '../prisma';
import { DEFAULT_CALENDAR_TIMEZONE } from '@/constants/time';

export interface EmailMessage {
  messageId: string;
  labelIds?: string[];
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  headers?: { name: string; value: string }[];
}

export interface FilterResult {
  shouldReply: boolean;
  reason: string;
  category: 'allowed' | 'blocked' | 'filtered';
}

const HARD_SKIP_FILTER_EXACT_REASONS = new Set([
  'Own message/draft - skip',
  'Invalid or empty sender',
  'Empty subject line',
]);

const HARD_SKIP_FILTER_REASON_PREFIXES = [
  'Blocked by Gmail category:',
  'Blocked sender pattern:',
  'Blocked subject pattern:',
] as const;

export function isHardSkipFilterResult(filterResult: Pick<FilterResult, 'shouldReply' | 'reason'>): boolean {
  if (filterResult.shouldReply) return false;

  return (
    HARD_SKIP_FILTER_EXACT_REASONS.has(filterResult.reason) ||
    HARD_SKIP_FILTER_REASON_PREFIXES.some((prefix) => filterResult.reason.startsWith(prefix))
  );
}

export interface FilterContext {
  /**
   * The mailbox ID this email belongs to (for multi-inbox support).
   * Used for proper communication history checks scoped to this mailbox.
   */
  mailboxId?: string;
  /**
   * The email address of the mailbox receiving the email.
   * Used to detect self-sent emails. For multi-inbox, this should be the
   * specific mailbox's email address, not the user's primary email.
   */
  mailboxEmail: string;
}

export class EmailFilterService {
  private static ALWAYS_BLOCKED_LABELS = [

    'SPAM',                  // Spam emails
    // Prevent feedback loops and self-processing of system artifacts
    'DRAFT',                 // User-created or system-created drafts
    'SENT',                  // Outgoing messages
    'TRASH'                  // Deleted mail
  ];

  private static BLOCKED_SENDER_PATTERNS: RegExp[] = [];

  private static BLOCKED_SUBJECT_PATTERNS = [
    
    /unsubscribe/i,

  ];

  /**
   * Main filtering method - determines if we should reply to an email
   *
   * Multi-inbox behavior:
   * - Uses mailboxEmail to detect self-sent emails for this specific mailbox
   * - Scopes communication history check to the mailbox when mailboxId is provided
   * - Falls back to user-level history check when mailboxId is not provided (legacy)
   */
  async shouldReplyToEmail(
    message: EmailMessage,
    userId: string,
    userEmail: string,
    context?: FilterContext
  ): Promise<FilterResult> {
    // Use mailbox-specific email if provided, otherwise fall back to userEmail (legacy)
    const effectiveEmail = context?.mailboxEmail ?? userEmail;

    const lines: string[] = [];
    const tag = '[reply-filter]';
    const add = (line: string) => lines.push(`${tag} ${line}`);
    const flush = () => {
      // Print as a single log block so related lines stay grouped in the console.
      console.log(lines.join('\n'));
    };

    const toList = Array.isArray(message.to) ? message.to.filter(Boolean) : [];
    const labelList = Array.isArray(message.labelIds) ? message.labelIds.filter(Boolean) : [];
    const from = (message.from || '').trim();
    const subject = (message.subject || '').trim();

    add(`📨 Email: from=${from || '(missing)'} subject="${subject || '(missing)'}"`);
    add(
      `🧾 Meta: to=[${toList.join(', ')}] labels=[${labelList.join(', ') || '(none)'}] messageId=${message.messageId || '(none)'} mailboxId=${context?.mailboxId || '(none)'}`,
    );

    // Short-circuit: never reply to our own messages/drafts
    // Handles formats like "Name <user@example.com>" and bare addresses.
    const fromLower = (message.from || '').toLowerCase();
    const effectiveLower = (effectiveEmail || '').toLowerCase();
    if (effectiveLower && (fromLower === effectiveLower || fromLower.endsWith(`<${effectiveLower}>`) || fromLower.includes(effectiveLower))) {
      add(`⛔ Result: FILTERED (own message/draft)`);
      flush();
      return { shouldReply: false, reason: 'Own message/draft - skip', category: 'filtered' };
    }

    // Fetch user settings; create defaults if missing.
    let userSettings = await prisma.userSettings.findUnique({ where: { userId } });
    if (!userSettings) {
      add(`⚙️ Settings: none found → creating defaults`);
      userSettings = await prisma.userSettings.create({
        data: {
          userId,
          replyScope: 'ALL_SENDERS',
          blockedSenders: [],
          allowedSenders: [],
          enablePushNotifications: true,
          preferencesSaved: true,
          // Default calendar preferences: PST timezone and no explicit calendar selection yet
          calendarTimezone: DEFAULT_CALENDAR_TIMEZONE,
          calendarContextCalendarIds: [],
        },
      });
    }

    const blockedCount = Array.isArray((userSettings as any).blockedSenders) ? (userSettings as any).blockedSenders.length : 0;
    const allowedCount = Array.isArray((userSettings as any).allowedSenders) ? (userSettings as any).allowedSenders.length : 0;
    add(
      `⚙️ Settings: scope=${(userSettings as any).replyScope} blocked=${blockedCount} allowed=${allowedCount} saved=${(userSettings as any).preferencesSaved}`,
    );

    add('🔎 Checks:');

    // 1. Hard-coded filters (always applied)
    add('🧱 Hard-coded rules:');
    const hardCodedFilter = this.applyHardCodedFilters(message, { add });
    if (!hardCodedFilter.shouldReply) {
      add(`  ⛔ BLOCK (${hardCodedFilter.reason})`);
      add(`⛔ Result: ${hardCodedFilter.category.toUpperCase()} (${hardCodedFilter.reason})`);
      flush();
      return hardCodedFilter;
    }
    add('  ✅ PASS');

    // 2. RECIPIENT FILTER DISABLED - User requested to remove CC filter
    // console.log(`🔍 FILTER STEP 2: Checking recipient filter...`);
    // const recipientCheck = this.checkRecipientFilter(message, userEmail);
    // if (!recipientCheck.shouldReply) {
    //   console.log(`🚫 FILTER RESULT: BLOCKED by recipient filter - ${recipientCheck.reason}`);
    //   return recipientCheck;
    // }
    add('👤 Recipient rule: DISABLED');


    // 3. Apply user's blocklist FIRST (security - blocked senders cannot be overridden)
    const blocklistCheck = this.checkBlocklist(message.from, userSettings.blockedSenders);
    if (!blocklistCheck.shouldReply) {
      add(`⛔ Blocklist: BLOCK (${blocklistCheck.reason})`);
      add(`⛔ Result: ${blocklistCheck.category.toUpperCase()} (${blocklistCheck.reason})`);
      flush();
      return blocklistCheck;
    }
    add('✅ Blocklist: PASS');

    // 4. Apply user's allowlist (if sender is in allowlist, always reply)
    const allowlistCheck = this.checkAllowlist(message.from, userSettings.allowedSenders);
    if (allowlistCheck.shouldReply) {
      add(`✅ Allowlist: ALLOW (${allowlistCheck.reason})`);
      add(`✅ Result: ALLOWED (${allowlistCheck.reason})`);
      flush();
      return allowlistCheck;
    }
    add('ℹ️ Allowlist: no match');

    // 5. Apply reply scope settings
    const scopeCheck = await this.checkReplyScope(message, userId, userSettings, context?.mailboxId);
    if (!scopeCheck.shouldReply) {
      add(`⛔ Scope: BLOCK (${scopeCheck.reason})`);
      add(`⛔ Result: ${scopeCheck.category.toUpperCase()} (${scopeCheck.reason})`);
      flush();
      return scopeCheck;
    }
    add(`✅ Scope: PASS (${(userSettings as any).replyScope})`);

    // If we get here, email passes all filters
    add('✅ Result: ALLOWED (passed all checks)');
    flush();
    return {
      shouldReply: true,
      reason: 'Email passed all filters',
      category: 'allowed'
    };
  }

  /**
   * Apply hard-coded filters that are always ON
   */
  private applyHardCodedFilters(
    message: EmailMessage,
    trace?: {
      add: (line: string) => void;
    },
  ): FilterResult {
    const addDetail = (line: string) => trace?.add(`  - ${line}`);

    // Check Gmail categories/labels
    const labelIds = Array.isArray(message.labelIds) ? message.labelIds : [];
    for (const blockedLabel of EmailFilterService.ALWAYS_BLOCKED_LABELS) {
      if (labelIds.includes(blockedLabel)) {
        addDetail(`Gmail category/label blocked: ${blockedLabel}`);
        return {
          shouldReply: false,
          reason: `Blocked by Gmail category: ${blockedLabel}`,
          category: 'filtered',
        };
      }
    }
    if (labelIds.length > 0) addDetail('Gmail labels: ok (no blocked categories)');
    else addDetail('Gmail labels: none');

    // Check sender patterns
    for (const pattern of EmailFilterService.BLOCKED_SENDER_PATTERNS) {
      if (pattern.test(message.from)) {
        addDetail(`Sender blocked by pattern ${String(pattern)} (matched "${message.from}")`);
        return {
          shouldReply: false,
          reason: `Blocked sender pattern: ${message.from}`,
          category: 'filtered'
        };
      }
    }
    addDetail('Sender patterns: ok');

    // Check subject patterns
    for (const pattern of EmailFilterService.BLOCKED_SUBJECT_PATTERNS) {
      if (pattern.test(message.subject)) {
        addDetail(`Subject blocked by pattern ${String(pattern)} (matched "${message.subject}")`);
        return {
          shouldReply: false,
          reason: `Blocked subject pattern: ${message.subject}`,
          category: 'filtered'
        };
      }
    }
    addDetail('Subject patterns: ok');

    // Check for empty/invalid senders
    if (!message.from || message.from.trim() === '' || !message.from.includes('@')) {
      addDetail(`Invalid sender: "${message.from}"`);
      return {
        shouldReply: false,
        reason: 'Invalid or empty sender',
        category: 'filtered'
      };
    }
    addDetail('Sender: present + valid');

    // Check for empty subjects (likely spam)
    if (!message.subject || message.subject.trim() === '') {
      addDetail('Empty subject');
      return {
        shouldReply: false,
        reason: 'Empty subject line',
        category: 'filtered'
      };
    }
    addDetail('Subject: present');
    return { shouldReply: true, reason: 'Passed hard-coded filters', category: 'allowed' };
  }

  /**
   * Check if user is in the To field (not just CC/BCC)
   */
  private checkRecipientFilter(message: EmailMessage, userEmail: string): FilterResult {
    const toAddresses = message.to.map(addr => addr.toLowerCase());
    const userEmailLower = userEmail.toLowerCase();

    if (!toAddresses.includes(userEmailLower)) {
      return {
        shouldReply: false,
        reason: 'User not directly addressed (CC/BCC only)',
        category: 'filtered'
      };
    }

    return { shouldReply: true, reason: 'User directly addressed', category: 'allowed' };
  }

  /**
   * Check if sender is in user's blocklist
   */
  private checkBlocklist(sender: string, blockedSenders: string[]): FilterResult {
    const senderLower = sender.toLowerCase();

    for (const blocked of blockedSenders) {
      const blockedLower = blocked.toLowerCase();

      // Check exact match or domain match
      if (senderLower === blockedLower ||
          senderLower.includes(blockedLower) ||
          (blockedLower.startsWith('@') && senderLower.endsWith(blockedLower))) {
        return {
          shouldReply: false,
          reason: `Sender in user blocklist: ${blocked}`,
          category: 'blocked'
        };
      }
    }

    return { shouldReply: true, reason: 'Sender not in blocklist', category: 'allowed' };
  }

  /**
   * Check if sender is in user's allowlist
   */
  private checkAllowlist(sender: string, allowedSenders: string[]): FilterResult {
    const senderLower = sender.toLowerCase();

    for (const allowed of allowedSenders) {
      const allowedLower = allowed.toLowerCase();

      // Check exact match or domain match
      if (senderLower === allowedLower ||
          senderLower.includes(allowedLower) ||
          (allowedLower.startsWith('@') && senderLower.endsWith(allowedLower))) {
        return {
          shouldReply: true,
          reason: `Sender in user allowlist: ${allowed}`,
          category: 'allowed'
        };
      }
    }

    return { shouldReply: false, reason: 'Sender not in allowlist', category: 'filtered' };
  }

  /**
   * Check reply scope (contacts only vs all senders)
   *
   * Multi-inbox behavior:
   * - When mailboxId is provided: checks communication history scoped to that mailbox
   * - When mailboxId is not provided: falls back to user-level check (legacy)
   */
  private async checkReplyScope(
    message: EmailMessage,
    userId: string,
    userSettings: any,
    mailboxId?: string
  ): Promise<FilterResult> {

    if (userSettings.replyScope === 'ALL_SENDERS') {
      return { shouldReply: true, reason: 'Reply scope allows all senders', category: 'allowed' };
    }

    if (userSettings.replyScope === 'CONTACTS_ONLY') {
      // Check if sender has been communicated with before
      const hasHistory = await this.checkCommunicationHistory(message.from, userId, mailboxId);

      if (hasHistory) {
        return { shouldReply: true, reason: 'Sender is a known contact', category: 'allowed' };
      } else {
        // Unknown sender - since Clira doesn't auto-reply, all emails go to queue for approval
        return { shouldReply: false, reason: 'Unknown sender, requires user approval', category: 'filtered' };
      }
    }

    return { shouldReply: false, reason: 'Unknown reply scope', category: 'filtered' };
  }

  /**
   * Check if we have communication history with this sender
   *
   * Multi-inbox behavior:
   * - When mailboxId is provided: only checks history within that mailbox
   * - When mailboxId is not provided: checks all user emails (legacy behavior)
   */
  private async checkCommunicationHistory(
    sender: string,
    userId: string,
    mailboxId?: string
  ): Promise<boolean> {
    const whereClause = mailboxId
      ? {
          // Multi-inbox: scope to specific mailbox
          mailboxId,
          OR: [
            { from: { contains: sender } },
            { to: { has: sender } }
          ]
        }
      : {
          // Legacy: check all user emails
          thread: { userId },
          OR: [
            { from: { contains: sender } },
            { to: { has: sender } }
          ]
        };

    const emailCount = await prisma.email.count({
      where: whereClause
    });

    return emailCount > 0;
  }

  /**
   * Update user's filter settings
   */
  async updateFilterSettings(userId: string, settings: Partial<{
    replyScope: 'ALL_SENDERS' | 'CONTACTS_ONLY';
    blockedSenders: string[];
    allowedSenders: string[];
    enablePushNotifications: boolean;
    preferencesSaved: boolean;
  }>): Promise<any> {

    console.log(`[reply-filter] Updating filter settings for user ${userId}:`, settings);

    return await prisma.userSettings.upsert({
      where: { userId },
      update: settings,
      create: {
        userId,
        ...settings
      }
    });
  }

  /**
   * Get user's current filter settings
   */
  async getFilterSettings(userId: string): Promise<any> {
    return await prisma.userSettings.findUnique({
      where: { userId }
    });
  }
}
