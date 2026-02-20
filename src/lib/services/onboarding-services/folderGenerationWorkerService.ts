import { randomUUID } from 'crypto';
import { prisma } from '../../prisma';
import { LLMService } from '../../ml/llm';
import { QualityTrackerService } from '../utils/qualityTracker';
import { GmailService } from '../../email/gmail';
import { EmailLearningService } from './emailLearningService';
import { generatePerEmailMappings } from '../../ai/modules/mapping';
import { pruneEmailContentForRouting } from './utils/emailPruner';
import { GmailLabelClassifier } from '../utils/gmailLabelClassifier';
import { getAllUserFolders } from './utils/folderLabelUtils';
import { createFallbackFolderSuggestions, FallbackEmailSample } from './utils/folderFallbacks';
import { createGmailServiceForUser } from '@/lib/security/getUserGmailCredentials';
import {
  GeneratedFolders,
  GeneratedMappings,
  GeneratedLearnings,
  EmailCategorizationResult,
  ExtractedEmailAddress,
  FastOnboardingProposal,
  ExistingLabelSummary
} from './types';


/**
 * Folder Generation Worker Service - Handles all folder-related background processing
 * 
 * Following the masterPromptGenerator.ts pattern for:
 * - Heavy LLM processing in workers
 * - Quality tracking and fallbacks
 * - Robust error handling and retries
 * - Database persistence with versioning
 */
type MainColorName = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray';

export class FolderGenerationWorkerService {
  private llmService: LLMService;
  private qualityTracker: QualityTrackerService;
  private emailLearningService: EmailLearningService;
  // Main color palette (keep in sync with prompt + schemas)
  // Use Gmail-supported palette entries so color normalization keeps selections intact
  private readonly MAIN_COLORS: Record<MainColorName, string> = {
    red: '#CC3A21',
    orange: '#FFAD46',
    yellow: '#FAD165',
    green: '#16A765',
    blue: '#3C78D8',
    purple: '#8E63CE',
    gray: '#999999',
  };

  constructor() {
    this.llmService = new LLMService();
    this.qualityTracker = new QualityTrackerService();
    this.emailLearningService = new EmailLearningService();
  }

  /**
   * Utility function for delays between LLM calls (following masterPromptGenerator pattern)
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Normalize a folder name to a canonical key used for joining
   * - lowercase, trim, collapse internal whitespace
   */
  private normalizeFolderKey(name: string | null | undefined): string {
    return (name || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Generate a fast onboarding proposal suitable for the two-step flow.
   * Fetches a lightweight batch of emails, respects existing labels, and
   * returns sanitized suggestions ready for client rendering.
   */
  async generateFastOnboardingProposal(
    userId: string,
    options?: { maxEmails?: number; daysBack?: number }
  ): Promise<FastOnboardingProposal> {
    const maxEmails = Math.max(50, Math.min(options?.maxEmails ?? 400, 600));

    let gmailService: GmailService | null = null;
    let existingLabels: ExistingLabelSummary | null = null;

    try {
      const gmailResult = await createGmailServiceForUser({
        userId,
        purpose: 'fast-onboarding:generate',
        requester: 'FolderGenerationWorkerService.generateFastOnboardingProposal',
      });

      gmailService = gmailResult?.gmail ?? null;
    } catch (error) {
      console.warn(`[FAST ONBOARDING] Gmail credential lookup failed for user ${userId}:`, error);
    }

    if (gmailService) {
      existingLabels = await this.fetchExistingUserLabels(userId, gmailService);
    } else {
      const databaseLabels = await getAllUserFolders(userId);
      existingLabels = {
        databaseLabels: databaseLabels.map(label => ({
          name: label.name,
          metaPrompt: label.metaPrompt || undefined,
        })),
        gmailLabels: [],
        combinedLabels: databaseLabels.map(label => ({
          name: label.name,
          source: 'database' as const,
        })),
        totalCount: databaseLabels.length,
      };
    }

    let filteringStats = {
      totalFetched: 0,
      skippedForCustomLabels: 0,
      processable: 0,
    };

    let folderEmails: Array<{
      from: string;
      subject: string;
      snippet: string;
      body: string;
      date: Date;
      gmailCategories: ('PROMOTIONS'|'SOCIAL'|'UPDATES'|'FORUMS'|'PERSONAL')[];
      messageId: string;
      labelIds: string[];
      existingLabel?: string;
    }> = [];

    if (gmailService) {
      const emailFetch = await this.fetchReceivedEmails(
        gmailService,
        options?.daysBack,
        maxEmails
      );
      folderEmails = emailFetch.processableEmails;
      filteringStats = {
        totalFetched: emailFetch.filteringStats.totalFetched,
        skippedForCustomLabels: emailFetch.filteringStats.skippedForCustomLabels,
        processable: emailFetch.filteringStats.processable,
      };
    }

    let folderResult = folderEmails.length
      ? await this.generateFoldersFromEmails(userId, folderEmails)
      : this.createIntelligentFolderFallback(folderEmails);

    const fallbackUsed = folderEmails.length === 0 || folderResult.suggestedFolders.length === 0;

    if (folderResult.suggestedFolders.length === 0) {
      folderResult = this.createIntelligentFolderFallback(folderEmails);
    }

    const limitedFolders = folderResult.suggestedFolders.slice(0, 8);

    const suggestions = limitedFolders.map((folder) => ({
      ...folder,
      id: randomUUID(),
    }));

    return {
      suggestions,
      existingLabels: existingLabels!,
      filteringStats,
      totalAnalyzed: folderEmails.length,
      fallbackUsed,
    };
  }

  /**
   * Prepare per-email mapping assignments for the fast onboarding acceptance job.
   */
  async generateFastMappingAssignments(
    userId: string,
    gmailService: GmailService,
    folders: Array<{ id: string; name: string; description?: string; metaPrompt?: string; color?: string }>,
    options?: { maxEmails?: number; daysBack?: number }
  ) {
    const maxEmails = Math.max(20, Math.min(options?.maxEmails ?? 120, 400));
    const emailFetch = await this.fetchReceivedEmails(
      gmailService,
      options?.daysBack,
      maxEmails
    );

    const mappingEmails = emailFetch.processableEmails.slice(0, maxEmails);

    if (mappingEmails.length === 0) {
      return {
        mappingResult: {
          mappingSuggestions: [],
          bulkMappingOpportunities: [],
          unmappedEmails: [],
          overallStats: {
            totalEmailsAnalyzed: 0,
            highConfidenceMappings: 0,
            mediumConfidenceMappings: 0,
            lowConfidenceMappings: 0,
            unmappedCount: 0,
          },
        } as GeneratedMappings,
        mappingEmails,
        filteringStats: emailFetch.filteringStats,
      };
    }

    const mappingResult = await this.generatePerEmailMappingsNew(
      userId,
      folders,
      mappingEmails
    );

    return {
      mappingResult,
      mappingEmails,
      filteringStats: emailFetch.filteringStats,
    };
  }

  /**
   * Generate folders from user's emails using LLM (main worker method)
   */
  async generateFoldersFromEmails(
    userId: string,
    receivedEmails: Array<{
      from: string;
      subject: string;
      snippet: string;
      body: string;
      date: Date;
      gmailCategories: ('PROMOTIONS'|'SOCIAL'|'UPDATES'|'FORUMS'|'PERSONAL')[];
    }>
  ): Promise<GeneratedFolders> {
    try {
      console.log(`[FOLDER GENERATION] Starting folder generation for user: ${userId} with ${receivedEmails.length} emails`);

      if (receivedEmails.length === 0) {
        throw new Error('No received emails found for folder generation');
      }

      // Get OAuth credentials for Gmail API access
      const gmailResult = await createGmailServiceForUser({
        userId,
        purpose: 'folder-generation:existing-labels',
        requester: 'FolderGenerationWorkerService.generateFoldersFromEmails',
      });

      if (!gmailResult) {
        console.warn(`[FOLDER GENERATION] No Gmail credentials found for user ${userId}, continuing without existing Gmail labels`);
      }

      // Fetch existing user labels to avoid duplicates
      let existingLabels: { 
        combinedLabels: Array<{ name: string; source: 'database' | 'gmail' | 'both' }>; 
        totalCount: number; 
      } = { combinedLabels: [], totalCount: 0 };
      if (gmailResult) {
        const gmailService = gmailResult.gmail;
        existingLabels = await this.fetchExistingUserLabels(userId, gmailService);
      }

      // Check if user is already at the 9 folder limit
      if (existingLabels.totalCount >= 9) {
        console.log(`[FOLDER GENERATION] User already has ${existingLabels.totalCount} labels (max 9), returning empty suggestion`);
        return {
          suggestedFolders: [],
          overallAnalysis: {
            totalEmailsAnalyzed: receivedEmails.length,
            primaryEmailTypes: [],
            recommendedApproach: `User already has ${existingLabels.totalCount} labels (maximum reached)`
          },
          reasoning: `No new folders suggested - user already has ${existingLabels.totalCount} labels, which meets the maximum of 9 total folders.`
        };
      }

      // Extract addresses from emails (built-in logic similar to emailCategorizationService)
      const extractedAddresses = await this.extractAddressesFromEmails(receivedEmails, 1);
      console.log(`[FOLDER GENERATION] Extracted ${extractedAddresses.length} unique senders`);

      // Prepare email data for LLM analysis
      const recentEmails = receivedEmails
        .slice(0, 500) // 500 email Limit to manage token usage
        .map(email => ({
          from: email.from,
          to: [email.from], // Placeholder
          subject: email.subject,
          body: email.body,
          date: email.date
        }));

      // Create sender analysis for LLM
      const senderAnalysis: Record<string, { count: number; domains: string[]; keywords: string[] }> = {};
      
      for (const addr of extractedAddresses) {
        const domain = addr.domain.replace('@', '');
        const keywords = [
          ...addr.sampleSubjects.flatMap(subject => 
            subject.toLowerCase().split(/\s+/).filter(word => word.length > 3)
          ),
          ...addr.sampleSnippets.flatMap(snippet => 
            snippet.toLowerCase().split(/\s+/).filter(word => word.length > 3)
          )
        ];
        
        senderAnalysis[addr.emailAddress] = {
          count: addr.frequency,
          domains: [domain],
          keywords: Array.from(new Set(keywords)).slice(0, 10)
        };
      }

      // Use LLM to generate folders with existing label context
      console.log(`[FOLDER GENERATION] Calling LLM for folder generation (${existingLabels.totalCount} existing labels)...`);
      const folderResult = await this.llmService.generateFoldersFromEmails(
        recentEmails,
        senderAnalysis,
        existingLabels.combinedLabels  // Pass existing labels to avoid duplicates
      );

      // Enforce color policy: map to main palette based on importance with safe defaults
      const sanitized = {
        ...folderResult,
        suggestedFolders: folderResult.suggestedFolders.map((f) => {
          const importance = this.deriveImportance(f.name, (f as any).importance, f.confidence);
          const { colorName, colorHex } = this.resolveColor((f as any).colorName, f.color, f.name, importance);
          return { ...f, importance, colorName, color: colorHex } as typeof f & { importance?: 'high'|'medium'|'low'; colorName?: MainColorName };
        })
      } as typeof folderResult;

      console.log(`[FOLDER GENERATION] ✅ Generated ${sanitized.suggestedFolders.length} folders (total will be ${existingLabels.totalCount + sanitized.suggestedFolders.length})`);
      return sanitized;

    } catch (error) {
      console.error('[FOLDER GENERATION] Error generating folders:', error);
      // Return intelligent fallback similar to masterPromptGenerator
      return this.createIntelligentFolderFallback(receivedEmails);
    }
  }

  // Determine importance using LLM-provided flag if present, otherwise heuristic on confidence/name
  private deriveImportance(
    name: string,
    llmImportance: unknown,
    confidence: number
  ): 'high' | 'medium' | 'low' {
    if (llmImportance === 'high' || llmImportance === 'medium' || llmImportance === 'low') {
      return llmImportance;
    }
    const lower = (name || '').toLowerCase();
    if (/(action|urgent|important|priority)/.test(lower)) return 'high';
    if (/(review|misc|other|later)/.test(lower)) return 'low';
    if (confidence >= 85) return 'high';
    if (confidence >= 70) return 'medium';
    return 'low';
  }

  // Resolve a safe palette color, preferring explicit colorName, then valid hex, otherwise map by importance/name
  private resolveColor(
    colorName: unknown,
    colorHex: string | undefined,
    name: string,
    importance: 'high' | 'medium' | 'low'
  ): { colorName: MainColorName; colorHex: string } {
    // Force Review-like folders to gray
    if ((name || '').toLowerCase().includes('review')) {
      return { colorName: 'gray', colorHex: this.MAIN_COLORS.gray };
    }

    // If LLM provided a valid colorName, use it
    if (typeof colorName === 'string' && (colorName as any) in this.MAIN_COLORS) {
      const key = colorName as MainColorName;
      return { colorName: key, colorHex: this.MAIN_COLORS[key] };
    }

    // If provided hex already matches our palette, keep it
    const paletteHexes = new Set(Object.values(this.MAIN_COLORS).map((h) => h.toLowerCase()));
    if (typeof colorHex === 'string' && paletteHexes.has(colorHex.toLowerCase())) {
      const key = (Object.keys(this.MAIN_COLORS) as Array<MainColorName>)
        .find((k) => this.MAIN_COLORS[k].toLowerCase() === colorHex.toLowerCase())!;
      return { colorName: key, colorHex: this.MAIN_COLORS[key] };
    }

    // Map by importance as a deterministic fallback
    const importanceMap: Record<typeof importance, MainColorName> = {
      high: 'red',
      medium: 'blue',
      low: 'gray',
    };
    const key = importanceMap[importance];
    return { colorName: key, colorHex: this.MAIN_COLORS[key] };
  }

  /**
   * Generate email mappings using worker (main worker method)
   */
  async generateEmailMappings(
    userId: string,
    availableFolders: any[],
    emailAddresses: any[],
    emailPatternContext?: any
  ): Promise<GeneratedMappings> {
    try {
      console.log(`[EMAIL MAPPING] Starting email mapping for user: ${userId} with ${emailAddresses.length} addresses`);

      // Get user learnings for context
      const userLearnings = await this.emailLearningService.getUserLearnings(userId);
      console.log(`[EMAIL MAPPING] Retrieved ${userLearnings.length} user learnings`);

      // Compress inputs neutrally to reduce tokens (no classification hints)
      const MAX_SUBJECTS = 3;
      const MAX_SNIPPETS = 3;
      const MAX_SUBJECT_LEN = 120;
      const MAX_SNIPPET_LEN = 180;

      const compressText = (txt: any, max: number) => (typeof txt === 'string' ? (txt.length > max ? txt.slice(0, max) + '...' : txt) : '');

      const compressedFolders = (availableFolders || []).map((f: any) => ({
        id: f.id,
        name: f.name,
        // metaPrompt can be long; keep concise
        metaPrompt: typeof f.metaPrompt === 'string' ? compressText(f.metaPrompt, 200) : (f.metaPrompt || ''),
        color: f.color,
      }));

      const compressedAddresses = (emailAddresses || []).map((addr: any) => ({
        emailAddress: addr.emailAddress,
        senderName: addr.senderName,
        domain: addr.domain,
        frequency: addr.frequency,
        sampleSubjects: Array.isArray(addr.sampleSubjects)
          ? addr.sampleSubjects.slice(0, MAX_SUBJECTS).map((s: string) => compressText(s, MAX_SUBJECT_LEN))
          : [],
        sampleSnippets: Array.isArray(addr.sampleSnippets)
          ? addr.sampleSnippets.slice(0, MAX_SNIPPETS).map((s: string) => compressText(s, MAX_SNIPPET_LEN))
          : [],
        // Bodies are the main token source; omit entirely for mapping
        sampleBodies: [],
        sampleDates: Array.isArray(addr.sampleDates) ? addr.sampleDates.slice(0, MAX_SUBJECTS) : []
      }));

      // Optional: trim emailPatternContext if very large
      const compressedContext = emailPatternContext ? JSON.parse(JSON.stringify(emailPatternContext)) : undefined;
      if (compressedContext?.keywords && Array.isArray(compressedContext.keywords)) {
        compressedContext.keywords = compressedContext.keywords.slice(0, 50);
      }

      // Single-shot mapping (no chunking)
      console.log(`[EMAIL MAPPING] Calling LLM for email mapping in a single request for ${compressedAddresses.length} addresses`);

      const result = await this.llmService.generateEmailMappings(
        compressedFolders,
        compressedAddresses,
        compressedContext
      );

      // Ensure a stable return shape
      const normalized: GeneratedMappings = {
        mappingSuggestions: result.mappingSuggestions || [],
        bulkMappingOpportunities: result.bulkMappingOpportunities || [],
        unmappedEmails: result.unmappedEmails || [],
        overallStats: result.overallStats || {
          totalEmailsAnalyzed: compressedAddresses.length,
          highConfidenceMappings: 0,
          mediumConfidenceMappings: 0,
          lowConfidenceMappings: 0,
          unmappedCount: 0
        }
      } as any;

      console.log(`[EMAIL MAPPING] ✅ Generated ${normalized.mappingSuggestions.length} mapping suggestions in a single request`);
      return normalized;

    } catch (error) {
      console.error('[EMAIL MAPPING] Error generating mappings:', error);
      // Return fallback mapping structure
      return {
        mappingSuggestions: [],
        bulkMappingOpportunities: [],
        unmappedEmails: emailAddresses.map((email: any) => ({
          email: email.emailAddress || email,
          reasoning: "Mapping generation failed",
          suggestedAction: "manual_review"
        })),
        overallStats: {
          totalEmailsAnalyzed: emailAddresses.length,
          highConfidenceMappings: 0,
          mediumConfidenceMappings: 0,
          lowConfidenceMappings: 0,
          unmappedCount: emailAddresses.length
        }
      };
    }
  }

  /**
   * Generate per-email mappings with improved accuracy (NEW APPROACH)
   * Processes emails individually with pruned content for better LLM performance
   */
  async generatePerEmailMappingsNew(
    userId: string,
    availableFolders: Array<{ id: string; name: string; description?: string; metaPrompt?: string; color?: string }>,
    receivedEmails: Array<{
      from: string;
      subject: string;
      snippet: string;
      body: string;
      date: Date;
      gmailCategories: ('PROMOTIONS'|'SOCIAL'|'UPDATES'|'FORUMS'|'PERSONAL')[];
      messageId: string;
      existingLabel?: string;
    }>
  ): Promise<GeneratedMappings> {
    try {
      console.log(`[PER-EMAIL MAPPING] Starting per-email mapping for user: ${userId} with ${receivedEmails.length} emails`);

      // Prepare emails for LLM with pruned content
      const preparedEmails = receivedEmails.map(email => {
        const { prunedBody } = pruneEmailContentForRouting({ 
          subject: email.subject, 
          body: email.body 
        });

        return {
          id: email.messageId,
          from: email.from,
          subject: email.subject,
          snippet: email.snippet,
          bodyTrimmed: prunedBody,
          date: email.date,
          gmailCategories: email.gmailCategories,
          existingLabel: email.existingLabel
        };
      });

      // Process in batches of 100 emails for optimal LLM performance
      const batchSize = 100;
      const batches = [];
      for (let i = 0; i < preparedEmails.length; i += batchSize) {
        batches.push(preparedEmails.slice(i, i + batchSize));
      }

      console.log(`[PER-EMAIL MAPPING] Processing ${batches.length} batches in parallel`);

      // Process all batches in parallel for speed
      const batchPromises = batches.map(async (batch, index) => {
        try {
          console.log(`[PER-EMAIL MAPPING] Processing batch ${index + 1}/${batches.length} with ${batch.length} emails`);
          return await generatePerEmailMappings({
            availableFolders,
            emails: batch,
          });
        } catch (error) {
          console.error(`[PER-EMAIL MAPPING] Error in batch ${index + 1}:`, error);
          return {
            assignments: [],
            unassigned: batch.map(email => email.id)
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);

      // Combine all batch results
      const allAssignments = batchResults.flatMap(result => result.assignments);
      const allUnassigned = batchResults.flatMap(result => result.unassigned);

      // Transform per-email assignments back to the expected GeneratedMappings format
      // PRESERVE message ID precision for exact tracking
      const mappingSuggestions = allAssignments.map(assignment => {
        const email = preparedEmails.find(e => e.id === assignment.id);
        const folder = availableFolders.find(f => f.id === assignment.folderId);
        
        return {
          email: email?.from || 'unknown',
          messageId: assignment.id, // PRESERVE the exact message ID that was assigned
          suggestedFolderId: assignment.folderId,
          suggestedFolderName: folder?.name || 'Unknown',
          confidence: assignment.confidence,
          reasoning: assignment.reason,
          mappingType: 'EMAIL' as const,
          priority: assignment.confidence >= 85 ? 'high' as const : 
                   assignment.confidence >= 70 ? 'medium' as const : 'low' as const
        };
      });

      const result: GeneratedMappings = {
        mappingSuggestions,
        bulkMappingOpportunities: [], // Per-email approach doesn't generate bulk opportunities
        unmappedEmails: allUnassigned.map(emailId => {
          const email = preparedEmails.find(e => e.id === emailId);
          return {
            email: email?.from || emailId,
            reasoning: "Could not confidently assign to any folder",
            suggestedAction: "manual_review"
          };
        }),
        overallStats: {
          totalEmailsAnalyzed: preparedEmails.length,
          highConfidenceMappings: allAssignments.filter(a => a.confidence >= 80).length,
          mediumConfidenceMappings: allAssignments.filter(a => a.confidence >= 50 && a.confidence < 80).length,
          lowConfidenceMappings: allAssignments.filter(a => a.confidence < 50).length,
          unmappedCount: allUnassigned.length
        }
      };

      console.log(`[PER-EMAIL MAPPING] ✅ Completed: ${allAssignments.length} assigned, ${allUnassigned.length} unassigned`);
      return result;

    } catch (error) {
      console.error('[PER-EMAIL MAPPING] Error in per-email mapping:', error);
      // Fallback to empty result
      return {
        mappingSuggestions: [],
        bulkMappingOpportunities: [],
        unmappedEmails: receivedEmails.map(email => ({
          email: email.from,
          reasoning: "Per-email mapping failed",
          suggestedAction: "manual_review"
        })),
        overallStats: {
          totalEmailsAnalyzed: receivedEmails.length,
          highConfidenceMappings: 0,
          mediumConfidenceMappings: 0,
          lowConfidenceMappings: 0,
          unmappedCount: receivedEmails.length
        }
      };
    }
  }

  /**
   * Process user corrections and generate learnings (main worker method)
   */
  async processUserCorrections(
    userId: string,
    corrections: Array<{
      emailId: string;
      emailFrom: string;
      fromFolder: string;
      toFolder: string;
      shouldLearn: boolean;
      reason?: string;
    }>
  ): Promise<GeneratedLearnings> {
    const startTime = Date.now();
    console.log(`[EMAIL LEARNING] Processing ${corrections.length} corrections for user: ${userId}`);

    try {
      const errors: string[] = [];
      let processedLearnings = 0;
      const learningSummaries: string[] = [];

      // Filter corrections that should create learnings
      const learningCorrections = corrections.filter((c): c is typeof c & { reason: string } => 
        c.shouldLearn && typeof c.reason === 'string'
      );
      
      if (learningCorrections.length === 0) {
        return {
          processedLearnings: 0,
          learningSummaries: [],
          errors: [],
          processingTimeMs: Date.now() - startTime
        };
      }

      // Generate learning summaries using LLM
      console.log('[EMAIL LEARNING] Generating learning summaries with LLM...');
      const summaries = await this.generateLearningSummaries(learningCorrections);

      // Store learnings in database
      for (let i = 0; i < summaries.length; i++) {
        try {
          const correction = learningCorrections[i];
          const summary = summaries[i];

          await prisma.emailLearning.create({
            data: {
              userId,
              emailFrom: correction.emailFrom,
              originalFolder: correction.fromFolder,
              correctedFolder: correction.toFolder,
              userReason: correction.reason,
              aiSummary: summary,
              isActive: true
            }
          });

          processedLearnings++;
          learningSummaries.push(summary);
          console.log(`[EMAIL LEARNING] Created learning for ${correction.emailFrom}`);

        } catch (error) {
          const errorMsg = `Failed to store learning for ${learningCorrections[i].emailFrom}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          console.error(`[EMAIL LEARNING] ${errorMsg}`);
          errors.push(errorMsg);
        }
      }

      console.log(`[EMAIL LEARNING] ✅ Processed ${processedLearnings} learnings with ${errors.length} errors`);
      return {
        processedLearnings,
        learningSummaries,
        errors,
        processingTimeMs: Date.now() - startTime
      };

    } catch (error) {
      console.error('[EMAIL LEARNING] Error processing corrections:', error);
      return {
        processedLearnings: 0,
        learningSummaries: [],
        errors: [`Error processing corrections: ${error instanceof Error ? error.message : 'Unknown error'}`],
        processingTimeMs: Date.now() - startTime
      };
    }
  }

  /**
   * Complete email categorization workflow (main worker method)
   */
  async categorizeReceivedEmails(
    userId: string,
    options: {
      maxEmails?: number;
      minFrequency?: number;
      daysBack?: number;
    } = {}
  ): Promise<EmailCategorizationResult> {
    const startTime = Date.now();
    console.log(`[EMAIL CATEGORIZATION] Starting categorization for user: ${userId}`);
    
    try {
      // Default: last month, up to 500 emails; allow env to ignore date for testing
      const ignoreDate = process.env.FEATURE_FLAG_IGNORE_DATE === 'true';
      const { maxEmails = 500, minFrequency = 1 } = options;
      const daysBack = ignoreDate
        ? undefined
        : (typeof options.daysBack === 'number' && options.daysBack > 0 ? options.daysBack : 30);

      // Get user's OAuth credentials
      const gmailResult = await createGmailServiceForUser({
        userId,
        purpose: 'email-categorization:fetch-emails',
        requester: 'FolderGenerationWorkerService.categorizeReceivedEmails',
      });

      if (!gmailResult) {
        throw new Error(`No valid OAuth token found for user ${userId}`);
      }

      // Initialize Gmail service
      const gmailService = gmailResult.gmail;

      // Fetch received emails with custom label filtering
      console.log('[EMAIL CATEGORIZATION] Fetching received emails...');
      const emailFetchResult = await this.fetchReceivedEmails(gmailService, daysBack, maxEmails);
      const emails = emailFetchResult.processableEmails;
      
      // Log filtering results
      console.log(`[EMAIL CATEGORIZATION] ✅ Email filtering complete:`);
      console.log(`[EMAIL CATEGORIZATION]   📥 Total fetched: ${emailFetchResult.filteringStats.totalFetched}`);
      console.log(`[EMAIL CATEGORIZATION]   🔒 Protected (custom labels): ${emailFetchResult.filteringStats.skippedForCustomLabels}`);
      console.log(`[EMAIL CATEGORIZATION]   ✅ Processing: ${emailFetchResult.filteringStats.processable} emails`);

      // Extract addresses from processable emails only
      const extractedAddresses = await this.extractAddressesFromEmails(emails, minFrequency);
      console.log(`[EMAIL CATEGORIZATION] Extracted ${extractedAddresses.length} unique senders`);

      // Generate folders using a broader window to improve folder quality
      // Always ignore date for folder generation
      const folderDaysBack = undefined;
      const folderMaxEmails = 500;

      console.log('[EMAIL CATEGORIZATION] Generating folders and mappings with LLM...');
      console.log(`[FOLDER EMAIL FETCH] Using daysBack=${folderDaysBack ?? 'none'} maxEmails=${folderMaxEmails} (ignoreDate=true)`);
      const folderEmailFetch = await this.fetchReceivedEmails(gmailService, folderDaysBack, folderMaxEmails);
      const folderEmails = folderEmailFetch.processableEmails;
      const folderResult = await this.generateFoldersFromEmails(userId, folderEmails);
      
      // Wait before second LLM call
      await this.delay(1000);
      
      // Add IDs to folders for mapping (folders don't have IDs from generation)
      const foldersWithIds = folderResult.suggestedFolders.map((folder, index) => ({
        id: `folder-${index}`,
        name: folder.name,
        description: folder.description,
        metaPrompt: folder.metaPrompt,
        color: folder.color
      }));

      // Use new per-email mapping approach for better accuracy
      // Cap mapping to 100 emails for better LLM performance while keeping folder generation at 500
      const mappingEmails = emails.slice(0, 100);
      console.log(`[EMAIL MAPPING] Using ${mappingEmails.length} emails for mapping (capped from ${emails.length} total)`);
      
      const mappingResult = await this.generatePerEmailMappingsNew(
        userId,
        foldersWithIds,
        mappingEmails
      );

      // Transform per-email results back to sender-aggregated format for UI compatibility
      // Build lookup to map folder IDs to folder names  
      const folderIdToName = new Map<string, string>();
      for (const f of foldersWithIds) {
        folderIdToName.set(f.id, f.name);
      }

      // Build map of specific message ID assignments (preserving per-email precision)
      const messageIdAssignments = new Map<string, {
        folderName: string;
        confidence: number;
        reasoning: string;
        senderEmail: string;
      }>();

      for (const suggestion of mappingResult.mappingSuggestions) {
        const folderName = folderIdToName.get(suggestion.suggestedFolderId || '') || suggestion.suggestedFolderName;
        const messageId = (suggestion as any).messageId; // The specific message ID that was assigned
        
        if (messageId) {
          messageIdAssignments.set(messageId, {
            folderName,
            confidence: suggestion.confidence,
            reasoning: suggestion.reasoning,
            senderEmail: suggestion.email
          });
        }
      }

      // Determine if a 'Review' folder exists to map 'Mixed' senders for UI visibility
      const hasReviewFolder = folderResult.suggestedFolders.some(
        f => this.normalizeFolderKey(f.name) === this.normalizeFolderKey('Review')
      );

      // FIXED: Work directly with individual email assignments instead of grouping by sender
      // Create folder-based email counts from individual assignments
      const folderEmailCounts = new Map<string, number>();
      const folderMessageIds = new Map<string, string[]>();
      
      for (const [messageId, assignment] of Array.from(messageIdAssignments.entries())) {
        const folderKey = this.normalizeFolderKey(assignment.folderName);
        
        // Count actual emails assigned to each folder
        folderEmailCounts.set(folderKey, (folderEmailCounts.get(folderKey) || 0) + 1);
        
        // Track message IDs per folder
        if (!folderMessageIds.has(folderKey)) {
          folderMessageIds.set(folderKey, []);
        }
        folderMessageIds.get(folderKey)!.push(messageId);
      }

      // DEBUG: Log unique folder names being assigned
      const assignedFolderNames = new Set<string>();
      for (const [_, assignment] of Array.from(messageIdAssignments.entries())) {
        assignedFolderNames.add(assignment.folderName);
      }
      console.log(`[MAPPING DEBUG] Unique assigned folder names: [${Array.from(assignedFolderNames).join(', ')}]`);
      console.log(`[MAPPING DEBUG] Generated folder names: [${folderResult.suggestedFolders.map(f => f.name).join(', ')}]`);

      // Create categorizedEmails entries - ONE PER EMAIL (preserve per-email precision)
      const categorizedEmails: Array<{
        emailAddress: string;
        senderName?: string;
        frequency: number;
        suggestedFolder: string;
        confidence: number;
        reasoning: string;
        sampleSubjects: string[];
        sampleSnippets: string[];
        sampleBodies: string[];
        sampleDates: Date[];
        sampleMessageIds: string[];
      }> = [];

      const extractCanon = (fromStr: string): string => this.extractSenderAddress(fromStr) || fromStr;
      const extractName = (fromStr: string): string | undefined => this.extractSenderName(fromStr);

      for (const [messageId, assignment] of Array.from(messageIdAssignments.entries())) {
        const email = mappingEmails.find(e => e.messageId === messageId);
        if (!email) continue;

        const canonFrom = extractCanon(email.from);
        const nameFrom = extractName(email.from);

        categorizedEmails.push({
          emailAddress: canonFrom,
          senderName: nameFrom,
          frequency: 1,
          suggestedFolder: assignment.folderName,
          confidence: assignment.confidence,
          reasoning: assignment.reasoning,
          sampleSubjects: [email.subject],
          sampleSnippets: [email.snippet],
          sampleBodies: [],
          sampleDates: [email.date],
          sampleMessageIds: [messageId],
        });
      }

      const folderSuggestions = folderResult.suggestedFolders.map(folder => {
        const folderKey = this.normalizeFolderKey(folder.name);
        
        // FIXED: Use actual email counts from individual assignments
        const emailCount = folderEmailCounts.get(folderKey) || 0;
        
        // Get top senders for this folder from categorizedEmails
        const folderEmails = categorizedEmails.filter(email => this.normalizeFolderKey(email.suggestedFolder) === folderKey);
        const topSenders = folderEmails
          .sort((a, b) => b.frequency - a.frequency)
          .slice(0, 5)
          .map(email => email.senderName || email.emailAddress.split('@')[0]);
        
        // Debug folder matching - now shows actual email assignments
        console.log(`[FOLDER MATCHING] Folder: "${folder.name}" -> Key: "${folderKey}" -> Entries: ${folderEmails.length} -> EmailCount: ${emailCount}`);
        
        return {
          name: folder.name,
          description: folder.description,
          color: folder.color,
          emailCount,
          topSenders
        };
      });

      // CRITICAL FIX: Show ALL generated folders, not just ones with emails
      // This ensures UI displays all 8 folders that were actually generated
      console.log(`[FOLDER SUGGESTIONS] Generated ${folderSuggestions.length} total folders, ${folderSuggestions.filter(f => f.emailCount > 0).length} with emails`);
      
      // CRITICAL DEBUG: Log what categorizedEmails actually contains (per-email)
      console.log(`[CATEGORIZED EMAILS SUMMARY] Generated ${categorizedEmails.length} categorized email entries (per-email):`);
      const folderDistribution = new Map<string, number>();
      categorizedEmails.forEach(email => {
        const folder = email.suggestedFolder;
        folderDistribution.set(folder, (folderDistribution.get(folder) || 0) + 1);
      });
      for (const [folder, count] of Array.from(folderDistribution.entries())) {
        console.log(`[CATEGORIZED EMAILS SUMMARY]   "${folder}": ${count} emails`);
      }
      
      const result = {
        categorizedEmails,
        folderSuggestions: folderSuggestions, // FIXED: Don't filter out folders with 0 emails
        totalEmailsAnalyzed: mappingEmails.length, // Use actual number of emails processed for mapping
        categorizationTimeMs: Date.now() - startTime
      };

      console.log(`[EMAIL CATEGORIZATION] ✅ Completed categorization in ${result.categorizationTimeMs}ms`);
      return result;

    } catch (error) {
      console.error('[EMAIL CATEGORIZATION] Error categorizing emails:', error);
      throw error;
    }
  }

  /**
   * Generate and save complete folder categorization results with caching (following masterPromptGenerator pattern)
   */
  async generateAndSaveFolderCategorization(
    userId: string, 
    options: {
      maxEmails?: number;
      minFrequency?: number;
      daysBack?: number;
    } = {}
  ): Promise<{ id: string; version: number; confidence: number }> {
    try {
      console.log(`[FOLDER CATEGORIZATION] Starting generation and save for user: ${userId}`);

      // Generate categorization
      const result = await this.categorizeReceivedEmails(userId, options);
      
      return await this.saveFolderCategorizationResult(userId, result);
    } catch (error) {
      console.error('Error generating and saving folder categorization:', error);
      // Mark quality as false so background job can retry (if method exists)
      try {
        await (this.qualityTracker as any).markFolderCategorizationQuality?.(userId, false);
      } catch (error) {
        console.warn('Quality tracker method not available:', error);
      }
      throw error;
    }
  }

  /**
   * Save folder categorization results to database (privacy-safe version)
   */
  async saveFolderCategorizationResult(
    userId: string,
    result: EmailCategorizationResult
  ): Promise<{ id: string; version: number; confidence: number }> {
    try {
      console.log(`[FOLDER CATEGORIZATION] Saving privacy-safe categorization for user: ${userId}`);

      // Get current highest version
      const currentResult = await prisma.emailCategorizationResult.findFirst({
        where: { userId },
        orderBy: { version: 'desc' }
      });

      const nextVersion = currentResult ? currentResult.version + 1 : 1;

      // Deactivate existing results
      await prisma.emailCategorizationResult.updateMany({
        where: { userId },
        data: { isActive: false }
      });

      // Calculate confidence based on result quality
      const confidence = this.calculateCategorizationConfidence(result);

      // Create privacy-safe version for database (no email content)
      const sanitizedResult = {
        categorizedEmails: result.categorizedEmails.map(email => ({
          emailAddress: email.emailAddress,
          senderName: email.senderName,
          frequency: email.frequency,
          suggestedFolder: email.suggestedFolder,
          confidence: email.confidence,
          reasoning: email.reasoning,
          // Remove actual email content for privacy
          sampleSubjects: [], // Only metadata in database
          sampleSnippets: [], 
          sampleBodies: [],
          sampleDates: email.sampleDates.slice(0, 3) // Keep dates for analytics
        })),
        folderSuggestions: result.folderSuggestions
      };

      // Save privacy-safe result to database (upsert to handle existing records)
      const savedResult = await prisma.emailCategorizationResult.upsert({
        where: { userId },
        update: {
          categorizedEmails: sanitizedResult.categorizedEmails as any,
          folderSuggestions: sanitizedResult.folderSuggestions as any,
          totalEmailsAnalyzed: result.totalEmailsAnalyzed,
          categorizationTimeMs: result.categorizationTimeMs,
          llmTokensUsed: 0, // TODO: Track this from LLM service
          version: nextVersion,
          isActive: true,
          updatedAt: new Date()
        },
        create: {
          userId,
          categorizedEmails: sanitizedResult.categorizedEmails as any,
          folderSuggestions: sanitizedResult.folderSuggestions as any,
          totalEmailsAnalyzed: result.totalEmailsAnalyzed,
          categorizationTimeMs: result.categorizationTimeMs,
          llmTokensUsed: 0, // TODO: Track this from LLM service
          version: nextVersion,
          isActive: true
        }
      });

      // Mark quality as true (if method exists)
      try {
        await (this.qualityTracker as any).markFolderCategorizationQuality?.(userId, true);
      } catch (error) {
        console.warn('Quality tracker method not available:', error);
      }

      console.log(`✅ Folder categorization v${nextVersion} saved for user ${userId} with ${confidence}% confidence`);

      return {
        id: savedResult.id,
        version: savedResult.version,
        confidence
      };

    } catch (error) {
      console.error('Error generating and saving folder categorization:', error);
      // Mark quality as false so background job can retry (if method exists)
      try {
        await (this.qualityTracker as any).markFolderCategorizationQuality?.(userId, false);
      } catch (error) {
        console.warn('Quality tracker method not available:', error);
      }
      throw error;
    }
  }

  /**
   * Check if user has sufficient emails for folder generation (following masterPromptGenerator pattern)
   */
  async canGenerateFolders(userId: string): Promise<{ canGenerate: boolean; emailCount: number; minimumRequired: number }> {
    const minimumRequired = 10; // Minimum emails needed for reliable folder generation
    
    // Count received emails (not sent)
    const emailCount = await prisma.email.count({
      where: {
        thread: { userId },
        isSent: false
      }
    });

    return {
      canGenerate: emailCount >= minimumRequired,
      emailCount,
      minimumRequired
    };
  }

  /**
   * Ensure user has folder categorization, generate if missing (following masterPromptGenerator pattern)
   */
  async ensureUserHasFolderCategorization(userId: string): Promise<boolean> {
    try {
      // Check if user already has active categorization
      const existingCategorization = await prisma.emailCategorizationResult.findFirst({
        where: {
          userId,
          isActive: true
        }
      });

      if (existingCategorization) {
        console.log(`✅ User ${userId} already has folder categorization v${existingCategorization.version}`);
        return true;
      }

      // Check if user has enough emails
      const canGenerate = await this.canGenerateFolders(userId);
      
      if (!canGenerate.canGenerate) {
        console.log(`⚠️ User ${userId} needs ${canGenerate.minimumRequired - canGenerate.emailCount} more emails for folder generation`);
        return false;
      }

      // Generate folder categorization automatically
      console.log(`🚀 Auto-generating folder categorization for user ${userId} with ${canGenerate.emailCount} emails`);
      
      await this.generateAndSaveFolderCategorization(userId);
      
      console.log(`✅ Successfully auto-generated folder categorization for user ${userId}`);
      return true;

    } catch (error) {
      console.error(`❌ Error ensuring folder categorization for user ${userId}:`, error);
      // Mark quality as false so background job can retry (if method exists)
      try {
        await (this.qualityTracker as any).markFolderCategorizationQuality?.(userId, false);
      } catch (error) {
        console.warn('Quality tracker method not available:', error);
      }
      return false;
    }
  }

  // ===================== PRIVATE HELPER METHODS =====================

  /**
   * Fetch existing user labels from both database and Gmail to avoid duplicates
   */
  private async fetchExistingUserLabels(
    userId: string,
    gmailService: GmailService
  ): Promise<{
    databaseLabels: Array<{ name: string; metaPrompt?: string }>;
    gmailLabels: Array<{ name: string; id: string; type?: string }>;
    combinedLabels: Array<{ name: string; source: 'database' | 'gmail' | 'both' }>;
    totalCount: number;
  }> {
    try {
      console.log(`[EXISTING LABELS] Fetching existing labels for user: ${userId}`);

      // Get user labels from database (excluding system defaults)
      const databaseLabels = await getAllUserFolders(userId);
      const dbLabelNames = databaseLabels.map(label => ({
        name: label.name,
        metaPrompt: label.metaPrompt || undefined
      }));

      // Get Gmail labels (custom user labels only)
      const gmailLabels = await gmailService.getLabels();
      const customGmailLabels = gmailLabels.filter(label => {
        // Only include user-created labels, exclude system labels
        return label.type !== 'system' && 
               !['INBOX', 'SENT', 'DRAFT', 'TRASH', 'SPAM', 'IMPORTANT', 'STARRED', 'UNREAD'].includes(label.name.toUpperCase()) &&
               !label.name.startsWith('CATEGORY_');
      });

      // Normalize names for comparison (lowercase, trim, collapse whitespace)
      const normalizeLabel = (name: string) => name.toLowerCase().replace(/\s+/g, ' ').trim();

      // Create combined view to detect overlaps
      const combinedLabels: Array<{ name: string; source: 'database' | 'gmail' | 'both' }> = [];
      const seenNames = new Set<string>();

      // Add database labels
      for (const label of dbLabelNames) {
        const normalized = normalizeLabel(label.name);
        if (!seenNames.has(normalized)) {
          combinedLabels.push({ name: label.name, source: 'database' as const });
          seenNames.add(normalized);
        }
      }

      // Add Gmail labels that don't overlap with database labels
      for (const label of customGmailLabels) {
        const normalized = normalizeLabel(label.name);
        if (seenNames.has(normalized)) {
          // This Gmail label matches a database label
          const existing = combinedLabels.find(cl => normalizeLabel(cl.name) === normalized);
          if (existing) {
            existing.source = 'both' as const;
          }
        } else {
          // This is a Gmail-only label
          combinedLabels.push({ name: label.name, source: 'gmail' as const });
          seenNames.add(normalized);
        }
      }

      const result = {
        databaseLabels: dbLabelNames,
        gmailLabels: customGmailLabels.map(l => ({ name: l.name, id: l.id, type: l.type })),
        combinedLabels,
        totalCount: combinedLabels.length
      };

      console.log(`[EXISTING LABELS] Found ${result.totalCount} existing labels:`);
      console.log(`[EXISTING LABELS]   Database: ${result.databaseLabels.length} labels`);
      console.log(`[EXISTING LABELS]   Gmail custom: ${result.gmailLabels.length} labels`);
      console.log(`[EXISTING LABELS]   Combined unique: ${result.combinedLabels.length} labels`);
      
      // Log first few labels for debugging
      if (result.combinedLabels.length > 0) {
        const labelSample = result.combinedLabels.slice(0, 5).map(l => `"${l.name}" (${l.source})`).join(', ');
        console.log(`[EXISTING LABELS]   Sample: ${labelSample}${result.combinedLabels.length > 5 ? `, +${result.combinedLabels.length - 5} more` : ''}`);
      }

      return result;

    } catch (error) {
      console.error('[EXISTING LABELS] Error fetching existing labels:', error);
      // Return safe fallback
      return {
        databaseLabels: [] as Array<{ name: string; metaPrompt?: string }>,
        gmailLabels: [] as Array<{ name: string; id: string; type?: string }>,
        combinedLabels: [] as Array<{ name: string; source: 'database' | 'gmail' | 'both' }>,
        totalCount: 0
      };
    }
  }

  /**
   * Fetch received emails from Gmail with robust custom label detection
   * CRITICAL: Excludes emails with custom labels to respect user organization
   */
  private async fetchReceivedEmails(
    gmailService: GmailService,
    daysBack: number | undefined,
    maxEmails: number
  ): Promise<{
    processableEmails: Array<{
      from: string;
      subject: string;
      snippet: string;
      body: string;
      date: Date;
      gmailCategories: ('PROMOTIONS'|'SOCIAL'|'UPDATES'|'FORUMS'|'PERSONAL')[];
      messageId: string;
      labelIds: string[];
      existingLabel?: string;
    }>;
    filteringStats: {
      totalFetched: number;
      skippedForCustomLabels: number;
      processable: number;
      customLabeledEmails: Array<{
        messageId: string;
        from: string;
        customLabels: string[];
        reason: string;
      }>;
    };
  }> {
    try {
      // Canonical Stage 1 query: inbox only, exclude sent/spam/trash
      let query = `in:inbox -in:spam -in:trash -in:sent`;
      
      // Apply date filter if requested
      if (typeof daysBack === 'number' && daysBack > 0) {
        const cutoffDate = new Date();
        cutoffDate.setUTCDate(cutoffDate.getUTCDate() - daysBack);
        const afterDate = cutoffDate.toISOString().slice(0, 10).replace(/-/g, '/');
        query += ` after:${afterDate}`;
        console.log(`[LABEL FILTER] Applying date filter: after ${afterDate}`);
      } else {
        console.log(`[LABEL FILTER] No date filter applied - fetching all available emails`);
      }
      
      console.log(`[LABEL FILTER] Gmail query: "${query}" (max: ${maxEmails})`);
      const rawEmails = await gmailService.searchEmails(query, maxEmails);
      console.log(`[LABEL FILTER] Fetched ${rawEmails.length} raw emails from Gmail`);

      // Filter out sent emails first
      const receivedEmails = rawEmails.filter(email => !email.isSent);
      console.log(`[LABEL FILTER] Filtered to ${receivedEmails.length} received emails (excluded ${rawEmails.length - receivedEmails.length} sent)`);

      // Analyze labels and filter out custom-labeled emails
      const processableEmails = [];
      const customLabeledEmails = [];
      let skippedCount = 0;

      for (const email of receivedEmails) {
        const messageId = email.messageId || email.gmailMessageId || `unknown-${Date.now()}`;
        
        try {
          // CRITICAL: Analyze email labels for custom labels
          const labelAnalysis = GmailLabelClassifier.analyzeEmailLabels(
            messageId, 
            email.labelIds
          );

          if (labelAnalysis.shouldSkip) {
            // Email has custom labels - skip to preserve user organization
            skippedCount++;
            customLabeledEmails.push({
              messageId,
              from: email.from,
              customLabels: labelAnalysis.labelAnalysis.customLabels,
              reason: labelAnalysis.reason
            });

            console.log(`[LABEL FILTER] SKIPPING ${messageId}: ${labelAnalysis.reason}`);
            continue; // Skip this email
          }

          // Email is safe to process - no custom labels detected
          console.log(`[LABEL FILTER] PROCESSABLE ${messageId}: ${labelAnalysis.reason}`);
          
          // Do not pass system labels as existingLabel; we only skip custom-labeled emails above
          const existingLabel: string | undefined = undefined;

          processableEmails.push({
            from: email.from,
            subject: email.subject,
            snippet: email.snippet,
            body: email.body,
            date: email.date,
            gmailCategories: email.gmailCategories || [],
            messageId,
            labelIds: email.labelIds || [],
            existingLabel
          });

        } catch (error) {
          // FAIL-SAFE: If label analysis fails, skip the email to be safe
          console.error(`[LABEL FILTER] ERROR analyzing labels for ${messageId}:`, error);
          skippedCount++;
          customLabeledEmails.push({
            messageId,
            from: email.from,
            customLabels: ['ANALYSIS_FAILED'],
            reason: `Label analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`
          });
        }
      }

      const filteringStats = {
        totalFetched: rawEmails.length,
        skippedForCustomLabels: skippedCount,
        processable: processableEmails.length,
        customLabeledEmails
      };

      // Comprehensive logging
      console.log(`[LABEL FILTER] ✅ FILTERING COMPLETE:`);
      console.log(`[LABEL FILTER]   📥 Total fetched: ${filteringStats.totalFetched}`);
      console.log(`[LABEL FILTER]   📤 Sent emails excluded: ${rawEmails.length - receivedEmails.length}`);
      console.log(`[LABEL FILTER]   🏷️  Custom labeled (skipped): ${filteringStats.skippedForCustomLabels}`);
      console.log(`[LABEL FILTER]   ✅ Processable: ${filteringStats.processable}`);
      
      if (filteringStats.skippedForCustomLabels > 0) {
        console.log(`[LABEL FILTER] 🔒 PROTECTED EMAILS (not modified):`);
        filteringStats.customLabeledEmails.slice(0, 5).forEach(email => {
          console.log(`[LABEL FILTER]   - ${email.messageId}: ${email.from} (${email.customLabels.join(', ')})`);
        });
        if (filteringStats.customLabeledEmails.length > 5) {
          console.log(`[LABEL FILTER]   ... and ${filteringStats.customLabeledEmails.length - 5} more`);
        }
      }

      return {
        processableEmails,
        filteringStats
      };

    } catch (error) {
      console.error('[FOLDER GENERATION] Error fetching received emails:', error);
      throw error;
    }
  }

  /**
   * Extract addresses from emails (reusing existing logic from emailCategorizationService)
   */
  private async extractAddressesFromEmails(
    emails: Array<{
      from: string;
      subject: string;
      snippet: string;
      body: string;
      date: Date;
      gmailCategories: ('PROMOTIONS'|'SOCIAL'|'UPDATES'|'FORUMS'|'PERSONAL')[];
      messageId?: string;
    }>,
    minFrequency: number
  ): Promise<ExtractedEmailAddress[]> {
    const addressMap = new Map<string, {
      emailAddress: string;
      domain: string;
      senderName?: string;
      frequency: number;
      lastSeen: Date;
      sampleSubjects: string[];
      sampleSnippets: string[];
      sampleBodies: string[];
      sampleDates: Date[];
      sampleMessageIds: string[];
      gmailCategoryCounts: Map<string, number>;
      dominantGmailCategory?: string;
    }>();

    for (const email of emails) {
      const senderAddress = this.extractSenderAddress(email.from);
      if (!senderAddress) continue;

      const senderName = this.extractSenderName(email.from);

      const existing = addressMap.get(senderAddress);
      if (existing) {
        existing.frequency++;
        existing.lastSeen = new Date(Math.max(existing.lastSeen.getTime(), email.date.getTime()));
        
        // Keep all samples strictly aligned by only pushing when we accept a new subject
        const canAddSample =
          existing.sampleSubjects.length < 3 &&
          !existing.sampleSubjects.includes(email.subject);
        if (canAddSample) {
          existing.sampleSubjects.push(email.subject);
          existing.sampleSnippets.push(email.snippet);
          existing.sampleBodies.push(email.body);
          existing.sampleDates.push(email.date);
          if (
            email.messageId &&
            existing.sampleMessageIds.length < 3 &&
            !existing.sampleMessageIds.includes(email.messageId)
          ) {
            existing.sampleMessageIds.push(email.messageId);
          }
        }

        for (const category of email.gmailCategories) {
          const count = existing.gmailCategoryCounts.get(category) || 0;
          existing.gmailCategoryCounts.set(category, count + 1);
        }
      } else {
        const categoryCounts = new Map<string, number>();
        for (const category of email.gmailCategories) {
          categoryCounts.set(category, 1);
        }

        addressMap.set(senderAddress, {
          emailAddress: senderAddress,
          domain: '@' + senderAddress.split('@')[1],
          senderName,
          frequency: 1,
          lastSeen: email.date,
          sampleSubjects: [email.subject],
          sampleSnippets: [email.snippet],
          sampleBodies: [email.body],
          sampleDates: [email.date],
          sampleMessageIds: email.messageId ? [email.messageId] : [],
          gmailCategoryCounts: categoryCounts
        });
      }
    }

    // Convert to ExtractedEmailAddress format
    const results: ExtractedEmailAddress[] = [];
    
    for (const addr of Array.from(addressMap.values())) {
      if (addr.frequency < minFrequency) continue;

      // Find dominant Gmail category
      let dominantCategory: string | undefined;
      let maxCount = 0;
      
      for (const [category, count] of Array.from(addr.gmailCategoryCounts.entries())) {
        if (count > maxCount) {
          maxCount = count;
          dominantCategory = category;
        }
      }

      results.push({
        emailAddress: addr.emailAddress,
        domain: addr.domain,
        senderName: addr.senderName,
        frequency: addr.frequency,
        lastSeen: addr.lastSeen,
        sampleSubjects: addr.sampleSubjects,
        sampleSnippets: addr.sampleSnippets,
        sampleBodies: addr.sampleBodies,
        sampleDates: addr.sampleDates,
        sampleMessageIds: addr.sampleMessageIds,
        dominantGmailCategory: dominantCategory
      });
    }

    return results.sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * Extract sender address from "From" field (reusing existing logic)
   */
  private extractSenderAddress(fromField: string): string | null {
    try {
      const emailMatch = fromField.match(/<([^>]+)>/);
      if (emailMatch) {
        return emailMatch[1].trim().toLowerCase();
      }
      
      const directMatch = fromField.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
      if (directMatch) {
        return directMatch[0].trim().toLowerCase();
      }
      
      return null;
    } catch (error) {
      console.warn(`Error extracting address from "${fromField}":`, error);
      return null;
    }
  }

  /**
   * Extract sender name from "From" field (reusing existing logic)
   */
  private extractSenderName(fromField: string): string | undefined {
    try {
      const nameMatch = fromField.match(/^([^<]+)<[^>]+>$/);
      if (nameMatch) {
        return nameMatch[1].trim().replace(/^["']|["']$/g, '');
      }
      
      const emailMatch = fromField.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
      if (emailMatch) {
        const remaining = fromField.replace(emailMatch[0], '').trim();
        if (remaining && !remaining.includes('@')) {
          return remaining.replace(/^["']|["']$/g, '');
        }
      }
      
      return undefined;
    } catch (error) {
      console.warn(`Error extracting name from "${fromField}":`, error);
      return undefined;
    }
  }

  /**
   * Generate learning summaries using LLM
   */
  private async generateLearningSummaries(
    learningCorrections: Array<{
      emailFrom: string;
      fromFolder: string;
      toFolder: string;
      reason: string;
    }>
  ): Promise<string[]> {
    try {
      // Create a simple prompt for learning generation
      const corrections = learningCorrections.map((context, index) => 
        `${index + 1}. Email from: ${context.emailFrom}
   Original folder: ${context.fromFolder}
   Corrected to: ${context.toFolder}
   User's reasoning: ${context.reason}`
      ).join('\n\n');

      const prompt = `Analyze these user email corrections and create concise learning summaries:

${corrections}

For each correction, create a brief summary that captures:
1. The pattern the user identified
2. Why they made the correction
3. How this should inform future categorization

Return a JSON array of strings, one summary per correction.`;

      const response = await this.llmService.generateText(prompt);
      
      try {
        const cleanedResponse = response.replace(/```json\n?|\n?```/g, '').trim();
        const parsed = JSON.parse(cleanedResponse);
        
        if (Array.isArray(parsed) && parsed.length === learningCorrections.length) {
          return parsed.map(summary => String(summary));
        }
      } catch (parseError) {
        console.warn('Failed to parse LLM response, using fallback summaries');
      }

      // Fallback to simple summaries
      return learningCorrections.map(context => 
        `User moved emails from ${context.emailFrom} from ${context.fromFolder} to ${context.toFolder}. Reason: ${context.reason}`
      );

    } catch (error) {
      console.error('Error generating learning summaries:', error);
      return learningCorrections.map(context => 
        `User moved emails from ${context.emailFrom} from ${context.fromFolder} to ${context.toFolder}. Reason: ${context.reason}`
      );
    }
  }


  /**
   * Calculate confidence score for categorization (following masterPromptGenerator pattern)
   */
  private calculateCategorizationConfidence(result: EmailCategorizationResult): number {
    let confidence = 0;

    // Base confidence from email count
    if (result.totalEmailsAnalyzed >= 100) confidence += 40;
    else if (result.totalEmailsAnalyzed >= 50) confidence += 30;
    else if (result.totalEmailsAnalyzed >= 25) confidence += 20;
    else confidence += 10;

    // Confidence from categorization quality
    const avgConfidence = result.categorizedEmails.reduce((sum, email) => sum + email.confidence, 0) / 
                         Math.max(result.categorizedEmails.length, 1);
    confidence += Math.round(avgConfidence * 0.6);

    return Math.min(confidence, 100);
  }

  /**
   * Create intelligent folder fallback (following masterPromptGenerator pattern)
   */
  private createIntelligentFolderFallback(receivedEmails: any[]): GeneratedFolders {
    console.log('🔧 Creating intelligent folder fallback...');

    const fallbackInput: FallbackEmailSample[] = receivedEmails.map((email: any) => ({
      from: email.from,
      subject: email.subject,
      gmailCategories: Array.isArray(email.gmailCategories) ? email.gmailCategories : [],
    }));

    return createFallbackFolderSuggestions(fallbackInput);
  }
}
