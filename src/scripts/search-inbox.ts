/**
 * CLI to run inbox search the same way the email retrieval subagent does.
 * Supports the same actions, modes, filters, and options so you can see
 * exactly what retrieval would return.
 *
 * Usage:
 *   node dist/scripts/search-inbox.js [query] [options]
 *   node dist/scripts/search-inbox.js --request path/to/request.json
 *
 * Examples:
 *   node dist/scripts/search-inbox.js scotiabank
 *   node dist/scripts/search-inbox.js scotiabank --sort oldest --limit 5
 *   node dist/scripts/search-inbox.js scotiabank --action count
 *   node dist/scripts/search-inbox.js scotiabank --action aggregate --group-by sender
 *   node dist/scripts/search-inbox.js scotiabank --sender "scotiabank.com" --relative-window last_90_days
 *   node dist/scripts/search-inbox.js --request ./my-request.json
 *
 * Options (override defaults or request file):
 *   --action find|summarize_range|count|aggregate   (default: find)
 *   --mode quick|deep                               (default: deep)
 *   --profile default|messaging                     (default: default)
 *   --sort relevance|newest|oldest                   (default: relevance)
 *   --limit N                                       (max candidates / count cap)
 *   --sender "email or domain"                       (filter by sender)
 *   --relative-window today|yesterday|last_7_days|last_30_days|last_90_days|all_time
 *   --group-by sender|day|thread|mailbox             (for aggregate)
 *   --mailbox "email"                               (scope to one mailbox)
 *   --request <path>                                (load full request from JSON)
 *
 * Request JSON shape (same as subagent tool args):
 *   { "action", "mode?", "queryText?", "filters?", "options?", "mailboxId?", "mailboxEmail?" }
 *   filters: { sender?, recipient?, relativeWindow?, startDate?, endDate?, subjectContains?, ... }
 *   options: { limit?, sortBy?, groupBy?, timezone?, ... }
 *
 * Requires DATABASE_URL (or DIRECT_URL). DB must be running (e.g. Docker).
 */
import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env') });
config({ path: resolve(__dirname, '../../.env.local') });

import { prisma } from '@/lib/prisma';
import { getMailboxesForUser } from '@/lib/services/mailbox';
import { searchInboxDocuments } from '@/lib/services/inbox-search';
import type {
  InboxSearchAction,
  InboxSearchFilters,
  InboxSearchGroupBy,
  InboxSearchOptions,
  InboxSearchQueryMode,
  InboxSearchRelativeWindow,
  InboxSearchRetrievalProfile,
  InboxSearchSortBy,
} from '@/lib/services/inbox-search/types';

// Same budgets as emailRetrievalSubagent
const RETRIEVAL_BUDGETS_BY_PROFILE: Record<
  InboxSearchRetrievalProfile,
  Record<InboxSearchQueryMode, { maxCandidates: number; snippetChars: number }>
> = {
  default: {
    quick: { maxCandidates: 24, snippetChars: 220 },
    deep: { maxCandidates: 60, snippetChars: 240 },
  },
  messaging: {
    quick: { maxCandidates: 18, snippetChars: 200 },
    deep: { maxCandidates: 40, snippetChars: 220 },
  },
};

type RequestFromFile = {
  action?: InboxSearchAction;
  mode?: InboxSearchQueryMode;
  profile?: InboxSearchRetrievalProfile;
  queryText?: string;
  filters?: InboxSearchFilters;
  options?: InboxSearchOptions;
  mailboxId?: string;
  mailboxEmail?: string;
};

function parseArgv(): {
  query: string;
  action: InboxSearchAction;
  mode: InboxSearchQueryMode;
  profile: InboxSearchRetrievalProfile;
  filters: InboxSearchFilters;
  options: InboxSearchOptions;
  mailboxEmail?: string;
  requestPath?: string;
} {
  const args = process.argv.slice(2);
  let query = 'scotiabank';
  let action: InboxSearchAction = 'find';
  let mode: InboxSearchQueryMode = 'deep';
  let profile: InboxSearchRetrievalProfile = 'default';
  const filters: InboxSearchFilters = {};
  const options: InboxSearchOptions = {};
  let mailboxEmail: string | undefined;
  let requestPath: string | undefined;

  let i = 0;
  if (args[0] && !args[0].startsWith('--')) {
    query = args[0];
    i = 1;
  }

  while (i < args.length) {
    const arg = args[i];
    if (arg === '--request' && args[i + 1]) {
      requestPath = args[i + 1];
      i += 2;
      continue;
    }
    if (arg === '--action' && args[i + 1]) {
      action = args[i + 1] as InboxSearchAction;
      i += 2;
      continue;
    }
    if (arg === '--mode' && args[i + 1]) {
      mode = args[i + 1] as InboxSearchQueryMode;
      i += 2;
      continue;
    }
    if (arg === '--profile' && args[i + 1]) {
      profile = args[i + 1] as InboxSearchRetrievalProfile;
      i += 2;
      continue;
    }
    if (arg === '--sort' && args[i + 1]) {
      options.sortBy = args[i + 1] as InboxSearchSortBy;
      i += 2;
      continue;
    }
    if (arg === '--limit' && args[i + 1]) {
      options.limit = parseInt(args[i + 1], 10);
      i += 2;
      continue;
    }
    if (arg === '--sender' && args[i + 1]) {
      filters.sender = args[i + 1];
      i += 2;
      continue;
    }
    if (arg === '--relative-window' && args[i + 1]) {
      filters.relativeWindow = args[i + 1] as InboxSearchRelativeWindow;
      i += 2;
      continue;
    }
    if (arg === '--group-by' && args[i + 1]) {
      options.groupBy = args[i + 1] as InboxSearchGroupBy;
      i += 2;
      continue;
    }
    if (arg === '--mailbox' && args[i + 1]) {
      mailboxEmail = args[i + 1];
      i += 2;
      continue;
    }
    i += 1;
  }

  let fromFile: RequestFromFile = {};
  if (requestPath) {
    const raw = readFileSync(resolve(process.cwd(), requestPath), 'utf-8');
    fromFile = JSON.parse(raw) as RequestFromFile;
    if (fromFile.queryText != null) query = fromFile.queryText;
    if (fromFile.action != null) action = fromFile.action;
    if (fromFile.mode != null) mode = fromFile.mode;
    if (fromFile.profile != null) profile = fromFile.profile as InboxSearchRetrievalProfile;
    if (fromFile.filters) Object.assign(filters, fromFile.filters);
    if (fromFile.options) Object.assign(options, fromFile.options);
    if (fromFile.mailboxEmail != null) mailboxEmail = fromFile.mailboxEmail;
  }

  return { query, action, mode, profile, filters, options, mailboxEmail, requestPath };
}

async function main() {
  const { query, action, mode, profile, filters, options, mailboxEmail } = parseArgv();

  const userWithMailbox = await prisma.user.findFirst({
    where: { mailboxes: { some: {} } },
    select: { id: true, email: true },
  });

  if (!userWithMailbox) {
    console.error('No user with mailboxes found. Connect at least one mailbox first.');
    process.exit(1);
  }

  let mailboxes = await getMailboxesForUser({ userId: userWithMailbox.id });
  if (mailboxEmail) {
    const normalized = mailboxEmail.toLowerCase();
    mailboxes = mailboxes.filter((m) => m.emailAddress.toLowerCase() === normalized);
  }
  const scopedMailboxes = mailboxes.map((m) => ({
    id: m.id,
    emailAddress: m.emailAddress,
    status: m.status,
    isPrimary: m.isPrimary,
  }));

  if (scopedMailboxes.length === 0) {
    console.error(
      mailboxEmail
        ? `No mailbox matching "${mailboxEmail}" for this user.`
        : 'User has no mailboxes available for search.',
    );
    process.exit(1);
  }

  const budgets = RETRIEVAL_BUDGETS_BY_PROFILE[profile][mode];

  const request = {
    userId: userWithMailbox.id,
    action,
    mode,
    profile,
    queryText: query || undefined,
    filters: Object.keys(filters).length ? filters : undefined,
    options: { ...options, limit: options.limit ?? budgets.maxCandidates },
    mailboxes: scopedMailboxes,
    maxCandidates: budgets.maxCandidates,
    snippetChars: budgets.snippetChars,
  };

  console.log('Request (same shape as email retrieval subagent):');
  console.log(
    JSON.stringify(
      {
        action: request.action,
        mode: request.mode,
        profile: request.profile,
        queryText: request.queryText,
        filters: request.filters,
        options: request.options,
        mailboxCount: request.mailboxes.length,
        mailboxes: request.mailboxes.map((m) => m.emailAddress),
      },
      null,
      2,
    ),
  );
  console.log('\n---\n');

  const result = await searchInboxDocuments(request);

  console.log('Coverage:', JSON.stringify(result.coverage, null, 2));

  if (action === 'count') {
    console.log('\nCount:', result.count ?? 0);
  } else if (action === 'aggregate' && result.aggregates) {
    console.log('\nAggregates', result.groupBy ? `(by ${result.groupBy}):` : ':');
    result.aggregates.forEach((a, i) => console.log(`  ${i + 1}. ${a.key}: ${a.count}`));
  } else {
    console.log('\nCandidates:', result.candidates.length);
    result.candidates.forEach((c, i) => {
      console.log(`  ${i + 1}. ${c.subject} | from: ${c.from} | date: ${c.date}`);
      console.log(`     snippet: ${c.snippet.slice(0, 140)}${c.snippet.length > 140 ? '...' : ''}`);
    });
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
