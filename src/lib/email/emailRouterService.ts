import { prisma } from '../prisma';
import { readPromptFile } from '../prompts';
import { LLMService } from '../ml/llm';
import { pruneEmailContentForRouting } from '../services/onboarding-services/utils/emailPruner';
import {
  getAllMailboxFolders,
  getMailboxReviewFolder
} from '../services/onboarding-services/utils/folderLabelUtils';
import { EmailMappingService } from '../services/onboarding-services/emailMappingService';
import { EmailLearningService } from '../services/onboarding-services/emailLearningService';
import { EmailMappingSearchResult } from '../services/onboarding-services/types';
import { FeatureFlags } from '../services/utils/featureFlags';


export interface EmailToRoute {
  gmailMessageId: string;
  gmailThreadId?: string;
  from: string;
  subject: string;
  snippet: string;
  body?: string;
  to?: string[];
  cc?: string[];
  labels?: string[];
  gmailCategories?: ('PROMOTIONS'|'SOCIAL'|'UPDATES'|'FORUMS'|'PERSONAL')[];
  /** Mailbox ID for multi-inbox routing (optional for backward compat) */
  mailboxId?: string;
}

export interface RouterDecision {
  labelId: string;
  labelName: string;
  confidence: number;
  reasoning: string;
  routingMethod: 'hard_mapping' | 'llm' | 'fallback';
  mappingMatch?: 'exact' | 'domain' | 'none';
}

export interface EmailRouterResult {
  emailId: string;
  decision: RouterDecision;
  processingTime: number;
  tokensUsed: number;
}

export interface BatchRouterRequest {
  userId: string;
  /**
   * Mailbox ID for multi-inbox routing.
   * Required for new multi-inbox code paths; falls back to user's primary mailbox
   * when not provided (legacy backward compatibility).
   */
  mailboxId?: string;
  emails: EmailToRoute[];
  batchJobId?: string;
}

export interface BatchRouterResult {
  results: EmailRouterResult[];
  totalProcessed: number;
  totalTokensUsed: number;
  processingTimeMs: number;
  errors: string[];
  stats: {
    hardMappingRouted: number;
    llmRouted: number;
    fallbackRouted: number;
    averageConfidence: number;
    exactMatches: number;
    domainMatches: number;
  };
}

export interface LLMBatchRequest {
  emails: EmailToRoute[];
  userLabels: Array<{name: string, metaPrompt: string}>;
}

export interface LLMBatchResponse {
  decisions: Array<{
    gmailMessageId: string;
    labelName: string;
    confidence: number;
    reasoning: string;
  }>;
  tokensUsed: number;
}

/**
 * Email Router Service - New LLM-based email classification with hard mapping
 * 
 * Routing Logic:
 * 1. Hard Mapping Check (instant routing for known senders)
 * 2. LLM Classification (for unmapped emails)
 * 3. Review folder fallback (for uncertain classifications)
 */
export class EmailRouterService {
  private llmService: LLMService;
  private emailMappingService: EmailMappingService;
  private emailLearningService: EmailLearningService;
  
  // Confidence thresholds
  private readonly LLM_CONFIDENCE_THRESHOLD = 0.6;

  constructor() {
    this.llmService = new LLMService();
    this.emailMappingService = new EmailMappingService();
    this.emailLearningService = new EmailLearningService();
  }

  /**
   * Route a batch of emails to appropriate labels/folders using new 2-phase approach
   *
   * Multi-inbox behavior:
   * - When mailboxId provided: routes using labels scoped to that mailbox
   * - When mailboxId not provided: falls back to user's primary mailbox (legacy)
   */
  async routeEmails(request: BatchRouterRequest): Promise<BatchRouterResult> {
    console.log(`[EMAIL ROUTER] Starting batch routing for user ${request.userId} (mailbox: ${request.mailboxId || 'primary'}): ${request.emails.length} emails`);
    const startTime = Date.now();

    const result: BatchRouterResult = {
      results: [],
      totalProcessed: 0,
      totalTokensUsed: 0,
      processingTimeMs: 0,
      errors: [],
      stats: {
        hardMappingRouted: 0,
        llmRouted: 0,
        fallbackRouted: 0,
        averageConfidence: 0,
        exactMatches: 0,
        domainMatches: 0
      }
    };

    try {
      // Resolve mailboxId if not provided (legacy fallback to primary mailbox)
      let resolvedMailboxId = request.mailboxId;
      if (!resolvedMailboxId) {
        const primaryMailbox = await prisma.mailbox.findFirst({
          where: { userId: request.userId, provider: 'google', status: 'CONNECTED' },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          select: { id: true },
        });
        resolvedMailboxId = primaryMailbox?.id;
      }

      // Cancel routing if no mailbox found
      if (!resolvedMailboxId) {
        const reason = 'No connected mailbox found for user; cancelling routing run';
        console.warn(`[EMAIL ROUTER] ${reason}`);
        result.errors.push(reason);
        result.processingTimeMs = Date.now() - startTime;
        return result;
      }

      // Cancel routing entirely if the user has no non-system folders for this mailbox
      const existingLabels = await getAllMailboxFolders(request.userId, resolvedMailboxId);
      if (!existingLabels || existingLabels.length === 0) {
        const reason = `No folders found for mailbox ${resolvedMailboxId}; cancelling routing run`;
        console.warn(`[EMAIL ROUTER] ${reason}`);
        result.errors.push(reason);
        result.processingTimeMs = Date.now() - startTime;
        return result;
      }

      // Step 1: Try hard mapping for all emails (Phase 1)
      const { hardMappingRouted, needsLLM } = await this.performHardMappingRouting(
        request.userId,
        request.emails,
        resolvedMailboxId
      );

      result.results.push(...hardMappingRouted);
      result.stats.hardMappingRouted = hardMappingRouted.length;
      result.stats.exactMatches = hardMappingRouted.filter(r => r.decision.mappingMatch === 'exact').length;
      result.stats.domainMatches = hardMappingRouted.filter(r => r.decision.mappingMatch === 'domain').length;

      console.log(`[EMAIL ROUTER] Hard mapping routed ${hardMappingRouted.length}/${request.emails.length} emails (${result.stats.exactMatches} exact, ${result.stats.domainMatches} domain)`);

      // Step 2: Process unmapped emails with LLM (Phase 2)
      if (needsLLM.length > 0) {
        console.log(`[EMAIL ROUTER] Processing ${needsLLM.length} emails with LLM`);

        // Get user's labels for LLM routing (scoped to mailbox)
        const userLabels = await this.getUserLabelsForRouting(request.userId, resolvedMailboxId);
        if (!userLabels || userLabels.length === 0) {
          console.warn('[EMAIL ROUTER] No folders available for LLM routing; skipping LLM phase');
        } else {
          const llmResults = await this.performLLMBatchRouting(
            needsLLM,
            userLabels,
            request.userId,
            resolvedMailboxId
          );

          result.results.push(...llmResults.results);
          result.totalTokensUsed += llmResults.tokensUsed;
          result.stats.llmRouted = llmResults.results.filter(r => r.decision.routingMethod === 'llm').length;
          result.stats.fallbackRouted = llmResults.results.filter(r => r.decision.routingMethod === 'fallback').length;
        }
      }

      // Calculate final statistics
      result.totalProcessed = result.results.length;
      result.processingTimeMs = Date.now() - startTime;

      if (result.results.length > 0) {
        result.stats.averageConfidence = result.results.reduce((sum, r) => sum + r.decision.confidence, 0) / result.results.length;
      }

      console.log(`[EMAIL ROUTER] Batch routing completed: ${result.totalProcessed} processed, ${result.stats.hardMappingRouted} hard mapped, ${result.stats.llmRouted} LLM, ${result.stats.fallbackRouted} fallback, ${result.totalTokensUsed} tokens, ${result.processingTimeMs}ms`);

      return result;

    } catch (error) {
      console.error(`[EMAIL ROUTER] Batch routing failed for user ${request.userId}:`, error);
      result.errors.push(`Batch routing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      result.processingTimeMs = Date.now() - startTime;
      return result;
    }
  }

  /**
   * Perform hard mapping routing for all emails (Phase 1)
   *
   * NOTE: Gmail category short-circuiting is disabled. Categories are passed to the LLM
   * as context and the LLM is the decider unless a user hard rule exists.
   *
   * @param userId - User ID
   * @param emails - Emails to route
   * @param mailboxId - Mailbox ID for scoping (required for multi-inbox)
   */
  private async performHardMappingRouting(
    userId: string,
    emails: EmailToRoute[],
    mailboxId: string
  ): Promise<{
    hardMappingRouted: EmailRouterResult[];
    needsLLM: EmailToRoute[];
  }> {
    const hardMappingRouted: EmailRouterResult[] = [];
    const needsLLM: EmailToRoute[] = [];

    console.log(`[EMAIL ROUTER] Checking hard mappings for ${emails.length} emails in mailbox ${mailboxId}`);

    // Process each email through hard mapping
    for (const email of emails) {
      try {
        const startTime = Date.now();

        // PHASE 1B: Traditional Hard Mapping
        // Normalize sender for mapping lookup
        const normalizedFrom = (email.from || '').trim().toLowerCase();
        const mappingResult: EmailMappingSearchResult = await this.emailMappingService.findMappingForEmail(
          userId,
          normalizedFrom,
          mailboxId
        );

        if (mappingResult.mapping && mappingResult.matchType !== 'none') {
          // Found a hard mapping - route directly
          const decision: RouterDecision = {
            labelId: mappingResult.mapping.labelId,
            labelName: mappingResult.mapping.labelName,
            confidence: 1.0, // Hard mappings have 100% confidence
            reasoning: `Hard mapping: ${email.from} → ${mappingResult.mapping.labelName} (${mappingResult.matchType} match)`,
            routingMethod: 'hard_mapping',
            mappingMatch: mappingResult.matchType
          };

          hardMappingRouted.push({
            emailId: email.gmailMessageId,
            decision,
            processingTime: Date.now() - startTime,
            tokensUsed: 0 // Hard mapping doesn't use tokens
          });

          console.log(`[EMAIL ROUTER] Hard mapped ${email.gmailMessageId}: ${email.from} → ${mappingResult.mapping.labelName} (${mappingResult.matchType})`);
        } else {
          // No mapping found, needs LLM processing
          needsLLM.push(email);
        }

      } catch (error) {
        console.error(`[EMAIL ROUTER] Hard mapping error for email ${email.gmailMessageId}:`, error);
        needsLLM.push(email);
      }
    }

    console.log(`[EMAIL ROUTER] Hard mapping results: ${hardMappingRouted.length} routed by user rules, ${needsLLM.length} need LLM`);
    return { hardMappingRouted, needsLLM };
  }

  /**
   * Process uncertain emails with LLM in batch for efficiency
   *
   * @param emails - Emails needing LLM classification
   * @param userLabels - Available labels for routing
   * @param userId - User ID
   * @param mailboxId - Mailbox ID for scoping (required for multi-inbox)
   */
  private async performLLMBatchRouting(
    emails: EmailToRoute[],
    userLabels: Array<{name: string, metaPrompt: string}>,
    userId: string,
    mailboxId: string
  ): Promise<{
    results: EmailRouterResult[];
    tokensUsed: number;
  }> {
    const results: EmailRouterResult[] = [];
    let totalTokensUsed = 0;
    const { tokenBudgetPerRun, confidenceThreshold } = FeatureFlags.getAlwaysOnSortingConfig();
    const minConfidence = Math.max(0, Math.min(1, confidenceThreshold / 100));

    try {
      // Batch process with LLM (limit batch size for cost control)
      const batchSize = 20;

      for (let i = 0; i < emails.length; i += batchSize) {
        // Enforce token budget: if we already exceeded the budget, short-circuit remaining emails to Review
        if (totalTokensUsed >= tokenBudgetPerRun) {
          const remaining = emails.slice(i);
          const reviewLabel = await getMailboxReviewFolder(userId, mailboxId);
          for (const email of remaining) {
            results.push({
              emailId: email.gmailMessageId,
              decision: {
                labelId: reviewLabel?.id || '',
                labelName: 'Review',
                confidence: 0.1,
                reasoning: 'Token budget exceeded; routed to Review',
                routingMethod: 'fallback'
              },
              processingTime: 0,
              tokensUsed: 0
            });
          }
          break;
        }
        const batch = emails.slice(i, i + batchSize);

        console.log(`[EMAIL ROUTER] Processing LLM batch ${Math.floor(i/batchSize) + 1}: ${batch.length} emails`);

        const batchResult = await this.processLLMBatch(batch, userLabels, userId, mailboxId);
        // Apply confidence threshold gating
        for (const r of batchResult.results) {
          const decision = r.decision;
          if (decision.routingMethod === 'llm' && decision.confidence < minConfidence) {
            const fallback = await this.createFallbackResult({
              gmailMessageId: r.emailId,
              from: '', subject: '', snippet: ''
            } as any, userId, mailboxId, `Below threshold (${decision.confidence.toFixed(2)} < ${minConfidence.toFixed(2)})`);
            results.push({ ...fallback, processingTime: r.processingTime, tokensUsed: r.tokensUsed });
          } else {
            results.push(r);
          }
        }
        totalTokensUsed += batchResult.tokensUsed;

        // Rate limiting between batches
        if (i + batchSize < emails.length) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
        }
      }

    } catch (error) {
      console.error(`[EMAIL ROUTER] LLM batch processing failed:`, error);

      // Fallback: route all emails to Review folder (scoped to mailbox)
      const reviewLabelId = await this.getLabelIdByName(userId, mailboxId, 'Review');
      if (reviewLabelId) {
        for (const email of emails) {
          results.push({
            emailId: email.gmailMessageId,
            decision: {
              labelId: reviewLabelId,
              labelName: 'Review',
              confidence: 0.1,
              reasoning: 'LLM processing failed, routing to Review',
              routingMethod: 'fallback'
            },
            processingTime: 0,
            tokensUsed: 0
          });
        }
      }
    }

    return { results, tokensUsed: totalTokensUsed };
  }

  /**
   * Process LLM batch with user learnings
   *
   * @param emails - Emails to classify
   * @param userLabels - Available labels for routing
   * @param userId - User ID
   * @param mailboxId - Mailbox ID for scoping (required for multi-inbox)
   */
  private async processLLMBatch(
    emails: EmailToRoute[],
    userLabels: Array<{name: string, metaPrompt: string}>,
    userId: string,
    mailboxId: string
  ): Promise<{
    results: EmailRouterResult[];
    tokensUsed: number;
  }> {
    console.log(`[EMAIL ROUTER] Processing ${emails.length} emails with LLM for user ${userId} (mailbox: ${mailboxId})`);
    const config = FeatureFlags.getAlwaysOnSortingConfig();
    const thresholdNormalized = Math.min(Math.max((config.confidenceThreshold || 0) / 100, 0), 1);

    try {
      // Build persistent XML prompt that includes metaPrompts for all folders (scoped to mailbox)
      const prompt = await this.buildPersistentMappingPrompt(emails, userId, mailboxId);

      // Call LLM for batch classification (flash model)
      const response = await this.llmService.generateText(prompt);

      // Parse JSON assignments/unassigned from model response
      const parsed = this.parsePersistentMappingJson(response);

      // Map folderId to name (scoped to mailbox)
      const labels = await getAllMailboxFolders(userId, mailboxId);
      const idToName = new Map(labels.map(l => [l.id, l.name]));
      const emailById = new Map(emails.map(e => [e.gmailMessageId, e]));

      const results: EmailRouterResult[] = [];
      let totalTokensUsed = 0;
      const estimatedTokens = Math.ceil(response.length / 4);

      // Assign routed emails
      for (const a of parsed.assignments || []) {
        const email = emailById.get(a.id);
        if (!email) continue;
        const labelName = idToName.get(a.folderId);
        if (!labelName) {
          const fb = await this.createFallbackResult(email, userId, mailboxId, `Unknown folderId ${a.folderId}`);
          results.push(fb);
          continue;
        }
        const conf01 = typeof a.confidence === 'number' && a.confidence > 1 ? a.confidence / 100 : (a.confidence ?? 0.5);
        if (conf01 < thresholdNormalized) {
          const fb = await this.createFallbackResult(email, userId, mailboxId, `Below threshold (${conf01.toFixed(2)} < ${thresholdNormalized.toFixed(2)})`);
          results.push(fb);
          totalTokensUsed += estimatedTokens;
          continue;
        }
        results.push({
          emailId: email.gmailMessageId,
          decision: {
            labelId: a.folderId,
            labelName,
            confidence: Math.min(Math.max(conf01, 0), 1),
            reasoning: a.reason || 'LLM classification',
            routingMethod: 'llm',
            mappingMatch: 'none'
          },
          processingTime: 0,
          tokensUsed: estimatedTokens
        });
        totalTokensUsed += estimatedTokens;
      }

      // Unassigned → Review
      for (const id of parsed.unassigned || []) {
        const email = emailById.get(id);
        if (!email) continue;
        const fb = await this.createFallbackResult(email, userId, mailboxId, 'LLM left unassigned');
        results.push(fb);
      }

      console.log(`[EMAIL ROUTER] LLM processed ${results.length} emails, ${totalTokensUsed} estimated tokens`);
      return { results, tokensUsed: totalTokensUsed };

    } catch (error) {
      console.error(`[EMAIL ROUTER] Error in LLM batch processing:`, error);
      const fallbackResults: EmailRouterResult[] = [];
      for (const email of emails) {
        const fallbackResult = await this.createFallbackResult(email, userId, mailboxId, 'LLM processing failed');
        fallbackResults.push(fallbackResult);
      }
      return { results: fallbackResults, tokensUsed: 0 };
    }
  }

  /**
   * Try to resolve a label ID using flexible name matching and common aliases
   *
   * @param userId - User ID
   * @param mailboxId - Mailbox ID for scoping (required for multi-inbox)
   * @param userLabelNames - Available label names
   * @param desiredName - Desired label name to match
   */
  private async resolveLabelIdFlexible(
    userId: string,
    mailboxId: string,
    userLabelNames: string[],
    desiredName: string
  ): Promise<string | null> {
    const normalize = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');

    // 1) Exact case-insensitive
    const exact = userLabelNames.find(n => normalize(n) === normalize(desiredName));
    if (exact) return this.getLabelIdByName(userId, mailboxId, exact);

    // 2) Fuzzy match: pick closest user label by similarity, above threshold
    const desired = normalize(desiredName).replace(/[^a-z0-9\s]/g, '');
    const candidates = userLabelNames.map(n => ({ name: n, norm: normalize(n).replace(/[^a-z0-9\s]/g, '') }));

    let best: { name: string; score: number } | null = null;
    for (const c of candidates) {
      const score = this.computeNameSimilarity(desired, c.norm);
      if (!best || score > best.score) best = { name: c.name, score };
    }

    const THRESHOLD = 0.78; // conservative, avoids overfitting to unrelated names
    if (best && best.score >= THRESHOLD) {
      return this.getLabelIdByName(userId, mailboxId, best.name);
    }

    return null;
  }

  /**
   * Generic name similarity combining token Jaccard and normalized Levenshtein ratio.
   */
  private computeNameSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    // Token Jaccard
    const at = new Set(a.split(' ').filter(Boolean));
    const bt = new Set(b.split(' ').filter(Boolean));
    const inter = new Set([...at].filter(x => bt.has(x))).size;
    const uni = new Set([...at, ...bt]).size || 1;
    const jaccard = inter / uni;

    // Levenshtein ratio
    const levDist = this.levenshteinDistance(a, b);
    const levRatio = 1 - levDist / Math.max(a.length || 1, b.length || 1);

    // Blend (weight a bit more on token overlap)
    return 0.6 * jaccard + 0.4 * levRatio;
  }

  private levenshteinDistance(a: string, b: string): number {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      const ca = a.charCodeAt(i - 1);
      for (let j = 1; j <= n; j++) {
        const cb = b.charCodeAt(j - 1);
        const cost = ca === cb ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,        // deletion
          dp[i][j - 1] + 1,        // insertion
          dp[i - 1][j - 1] + cost  // substitution
        );
      }
    }
    return dp[m][n];
  }

  /**
   * Build LLM prompt for batch classification with user learnings
   *
   * @param emails - Emails to classify
   * @param userId - User ID
   * @param mailboxId - Mailbox ID for scoping (required for multi-inbox)
   */
  private async buildPersistentMappingPrompt(
    emails: EmailToRoute[],
    userId: string,
    mailboxId: string
  ): Promise<string> {
    const labels = await getAllMailboxFolders(userId, mailboxId);
    const availableFolders = labels.map(l => ({ id: l.id, name: l.name, metaPrompt: l.metaPrompt || `Emails related to ${l.name}` }));
    const prunedEmails = emails.map(e => ({
      id: e.gmailMessageId,
      from: e.from,
      subject: e.subject,
      body: pruneEmailContentForRouting({ subject: e.subject, body: e.body || e.snippet }).prunedBody,
      gmailCategories: e.gmailCategories || [],
      systemLabels: e.labels || []
    }));
    const template = readPromptFile('organization-routing/persistent-mapping.xml');
    return template
      .replace('{availableFolders}', JSON.stringify(availableFolders))
      .replace('{emails}', JSON.stringify(prunedEmails));
  }

  private parsePersistentMappingJson(raw: string): { assignments: Array<{ id: string; folderId: string; confidence?: number; reason?: string }>; unassigned: string[] } {
    try {
      const cleaned = raw.trim().replace(/^```json\n?|\n?```$/g, '');
      const obj = JSON.parse(cleaned);
      const assignments = Array.isArray(obj.assignments) ? obj.assignments : [];
      const unassigned = Array.isArray(obj.unassigned) ? obj.unassigned : [];
      return { assignments, unassigned };
    } catch {
      return { assignments: [], unassigned: [] };
    }
  }

  /**
   * Parse LLM response for batch classification
   */
  private parseLLMBatchResponse(
    response: string,
    emails: EmailToRoute[]
  ): Array<{
    labelName: string;
    confidence: number;
    reasoning: string;
  } | null> {
    const decisions: Array<{labelName: string; confidence: number; reasoning: string} | null> = [];
    
    try {
      const lines = response.split('\n').filter(line => line.trim().includes('Email'));
      
      for (let i = 0; i < emails.length; i++) {
        if (i < lines.length) {
          const line = lines[i];
          
          // Parse format: "Email X: FOLDER_NAME (confidence: 0.XX) - reason"
          const match = line.match(/Email\s+\d+:\s*([^(]+)\s*\(confidence:\s*([\d.]+)\)\s*-?\s*(.*)/i);
          
          if (match) {
            const labelName = match[1].trim();
            const confidence = parseFloat(match[2]);
            const reasoning = match[3].trim() || 'LLM classification';
            
            decisions.push({
              labelName,
              confidence: Math.min(Math.max(confidence, 0), 1), // Clamp 0-1
              reasoning
            });
          } else {
            decisions.push(null);
          }
        } else {
          decisions.push(null);
        }
      }
    } catch (error) {
      console.error(`[EMAIL ROUTER] Error parsing LLM response:`, error);
      // Return null for all emails
      return new Array(emails.length).fill(null);
    }
    
    return decisions;
  }

  /**
   * Create fallback result for Review folder
   *
   * @param email - Email to route to fallback
   * @param userId - User ID
   * @param mailboxId - Mailbox ID for scoping (required for multi-inbox)
   * @param reason - Reason for fallback routing
   */
  private async createFallbackResult(
    email: EmailToRoute,
    userId: string,
    mailboxId: string,
    reason: string
  ): Promise<EmailRouterResult> {
    const reviewLabel = await getMailboxReviewFolder(userId, mailboxId);

    return {
      emailId: email.gmailMessageId,
      decision: {
        labelId: reviewLabel?.id || '',
        labelName: 'Review',
        confidence: 0.1,
        reasoning: reason,
        routingMethod: 'fallback'
      },
      processingTime: 0,
      tokensUsed: 0
    };
  }

  /**
   * Get user's labels formatted for LLM routing (scoped to mailbox)
   *
   * @param userId - User ID
   * @param mailboxId - Mailbox ID for scoping (required for multi-inbox)
   */
  private async getUserLabelsForRouting(userId: string, mailboxId: string): Promise<Array<{name: string, metaPrompt: string}>> {
    try {
      const labels = await getAllMailboxFolders(userId, mailboxId);

      return labels.map(label => ({
        name: label.name,
        metaPrompt: label.metaPrompt || `Emails related to ${label.name.toLowerCase()}`
      }));
    } catch (error) {
      console.error(`[EMAIL ROUTER] Error getting user labels for mailbox ${mailboxId}:`, error);
      // No fallback: if labels cannot be loaded, return empty set so caller can cancel/skip
      return [];
    }
  }

  /**
   * Route a single email (for testing or manual routing)
   *
   * @param userId - User ID
   * @param email - Email to route
   * @param mailboxId - Optional mailbox ID (falls back to primary if not provided)
   */
  async routeSingleEmail(userId: string, email: EmailToRoute, mailboxId?: string): Promise<RouterDecision> {
    console.log(`[EMAIL ROUTER] Routing single email for user ${userId} (mailbox: ${mailboxId || 'primary'}): ${email.gmailMessageId}`);

    try {
      // Resolve mailboxId if not provided
      let resolvedMailboxId = mailboxId;
      if (!resolvedMailboxId) {
        const primaryMailbox = await prisma.mailbox.findFirst({
          where: { userId, provider: 'google', status: 'CONNECTED' },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          select: { id: true },
        });
        resolvedMailboxId = primaryMailbox?.id;
      }

      if (!resolvedMailboxId) {
        return {
          labelId: '',
          labelName: 'Unsorted',
          confidence: 0,
          reasoning: 'No connected mailbox found for user; routing cancelled',
          routingMethod: 'fallback'
        };
      }

      // Cancel if user has no folders configured for this mailbox
      const existingLabels = await getAllMailboxFolders(userId, resolvedMailboxId);
      if (!existingLabels || existingLabels.length === 0) {
        return {
          labelId: '',
          labelName: 'Unsorted',
          confidence: 0,
          reasoning: `No folders found for mailbox ${resolvedMailboxId}; routing cancelled`,
          routingMethod: 'fallback'
        };
      }

      const batchResult = await this.routeEmails({
        userId,
        mailboxId: resolvedMailboxId,
        emails: [email]
      });

      if (batchResult.results.length > 0) {
        return batchResult.results[0].decision;
      }

      // Fallback
      const reviewLabel = await getMailboxReviewFolder(userId, resolvedMailboxId);
      return {
        labelId: reviewLabel?.id || '',
        labelName: 'Review',
        confidence: 0.1,
        reasoning: 'Single email routing failed',
        routingMethod: 'fallback'
      };

    } catch (error) {
      console.error(`[EMAIL ROUTER] Single email routing failed:`, error);
      // If labels cannot be loaded or an error occurred, do not route
      return {
        labelId: '',
        labelName: 'Unsorted',
        confidence: 0,
        reasoning: `Single email routing error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        routingMethod: 'fallback'
      };
    }
  }

  /**
   * Save routing results to database for analytics and retraining
   */
  async saveRoutingResults(batchJobId: string, results: EmailRouterResult[]): Promise<void> {
    console.log(`[EMAIL ROUTER] Saving ${results.length} routing results to database`);
    
    try {
      const emailSorts = results.map(result => ({
        userId: '', // Will be set by caller
        batchSortJobId: batchJobId,
        labelId: result.decision.labelId,
        gmailMessageId: result.emailId,
        confidence: result.decision.confidence,
        reasoning: result.decision.reasoning
      }));

      // Batch insert email sorts
      await prisma.emailSort.createMany({
        data: emailSorts,
        skipDuplicates: true
      });

      console.log(`[EMAIL ROUTER] Saved ${emailSorts.length} email sort records`);

    } catch (error) {
      console.error(`[EMAIL ROUTER] Error saving routing results:`, error);
      throw error;
    }
  }

  /**
   * Validate a routing decision
   */
  validateDecision(decision: RouterDecision): { isValid: boolean; issues: string[] } {
    const issues: string[] = [];

    if (!decision.labelId) {
      issues.push('Missing label ID');
    }

    if (!decision.labelName || decision.labelName.trim().length === 0) {
      issues.push('Missing or empty label name');
    }

    if (decision.confidence < 0 || decision.confidence > 1) {
      issues.push('Confidence must be between 0 and 1');
    }

    if (!decision.reasoning || decision.reasoning.trim().length === 0) {
      issues.push('Missing reasoning');
    }

    if (!['hard_mapping', 'llm', 'fallback'].includes(decision.routingMethod)) {
      issues.push('Invalid routing method');
    }

    return {
      isValid: issues.length === 0,
      issues
    };
  }

  /**
   * Get routing statistics for analytics
   */
  async getRoutingStats(userId: string, days: number = 30) {
    console.log(`[EMAIL ROUTER] Getting routing stats for user ${userId} (${days} days)`);
    
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const stats = await prisma.emailSort.aggregate({
        where: {
          userId: userId,
          sortedAt: {
            gte: cutoffDate
          }
        },
        _count: {
          id: true
        },
        _avg: {
          confidence: true
        }
      });

      // Get label distribution
      const labelDistribution = await prisma.emailSort.groupBy({
        by: ['labelId'],
        where: {
          userId: userId,
          sortedAt: {
            gte: cutoffDate
          }
        },
        _count: {
          id: true
        },
        orderBy: {
          _count: {
            id: 'desc'
          }
        }
      });

      // Get labels info
      const labels = await prisma.label.findMany({
        where: {
          userId: userId
        },
        select: {
          id: true,
          name: true
        }
      });

      const labelMap = new Map(labels.map(l => [l.id, l.name]));

      const mostUsedLabels = labelDistribution.map(item => ({
        labelName: labelMap.get(item.labelId) || 'Unknown',
        count: item._count.id
      }));

      return {
        totalEmailsRouted: stats._count.id || 0,
        averageConfidence: Math.round((stats._avg.confidence || 0) * 100) / 100,
        mostUsedLabels,
        errors: []
      };

    } catch (error) {
      console.error(`[EMAIL ROUTER] Error getting routing stats:`, error);
      return {
        totalEmailsRouted: 0,
        averageConfidence: 0,
        mostUsedLabels: [],
        errors: [`Failed to get routing statistics: ${error instanceof Error ? error.message : 'Unknown error'}`]
      };
    }
  }

  /**
   * Get label ID by name for a user (scoped to mailbox)
   *
   * @param userId - User ID
   * @param mailboxId - Mailbox ID for scoping (required for multi-inbox)
   * @param labelName - Label name to look up
   */
  private async getLabelIdByName(userId: string, mailboxId: string, labelName: string): Promise<string | null> {
    try {
      // Try case-insensitive match first (scoped to mailbox)
      const labelInsensitive = await prisma.label.findFirst({
        where: {
          userId,
          mailboxId,
          name: {
            equals: labelName,
            mode: 'insensitive'
          }
        },
        select: { id: true }
      });

      if (labelInsensitive?.id) return labelInsensitive.id;

      // Fallback to exact (in case DB collation doesn't support insensitive mode)
      const labelExact = await prisma.label.findFirst({
        where: { userId, mailboxId, name: labelName },
        select: { id: true }
      });

      return labelExact?.id || null;
    } catch (error) {
      console.error(`[EMAIL ROUTER] Error getting label ID for "${labelName}" in mailbox ${mailboxId}:`, error);
      return null;
    }
  }
}