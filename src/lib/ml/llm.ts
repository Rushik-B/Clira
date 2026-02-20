import { readPromptFile } from '../prompts';
// PHASE 2+: route calls to AI SDK modules/wrappers
import { generateReply as sdkGenerateReply } from '../ai/modules/reply';
import { generateFoldersFromEmails as sdkGenerateFolders } from '../ai/modules/folders';
import { generateEmailMappings as sdkGenerateMappings, suggestEmailMappings as sdkSuggestMappings } from '../ai/modules/mapping';
import { callText } from '../ai/callLlm';
import { models } from '../ai/models';

// Removed legacy token tracker in favor of AI SDK usage logs

export interface EmailContext {
  incomingEmail: {
    from: string;
    to: string[];
    subject: string;
    body: string;
    date: Date;
  };
  historicalEmails: Array<{
    from: string;
    to: string[];
    subject: string;
    body: string;
    date: Date;
    isSent: boolean;
  }>;
  conversationThread?: Array<{
    from: string;
    to: string[];
    subject: string;
    body: string;
    date: Date;
    isSent: boolean;
  }>;
}

export interface ReplyGenerationResult {
  reply: string;
  confidence: number;
  reasoning: string;
  ccRecipients?: string[];
}

export interface FolderGenerationResult {
  suggestedFolders: Array<{
    name: string;
    description: string;
    metaPrompt: string;
    color: string;
    colorName?: 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray';
    importance?: 'high' | 'medium' | 'low';
    icon: string;
    confidence: number;
    reasoning: string;
    exampleSenders: string[];
    keywordPatterns: string[];
  }>;
  overallAnalysis: {
    totalEmailsAnalyzed: number;
    primaryEmailTypes: string[];
    recommendedApproach: string;
  };
  reasoning: string;
}

export interface EmailMappingSuggestion {
  email: string;
  suggestedFolderId: string;
  suggestedFolderName: string;
  confidence: number;
  reasoning: string;
  mappingType: 'EMAIL' | 'DOMAIN';
  priority: 'high' | 'medium' | 'low';
  alternativeOptions?: Array<{
    folderId: string;
    folderName: string;
    confidence: number;
    reasoning: string;
  }>;
}

export interface EmailMappingResult {
  mappingSuggestions: EmailMappingSuggestion[];
  bulkMappingOpportunities: Array<{
    pattern: string;
    suggestedFolderId: string;
    suggestedFolderName: string;
    confidence: number;
    reasoning: string;
    affectedEmails: string[];
    mappingType: 'EMAIL' | 'DOMAIN';
  }>;
  unmappedEmails: Array<{
    email: string;
    reasoning: string;
    suggestedAction: string;
  }>;
  overallStats: {
    totalEmailsAnalyzed: number;
    highConfidenceMappings: number;
    mediumConfidenceMappings: number;
    lowConfidenceMappings: number;
    unmappedCount: number;
  };
}

export class LLMService {
  // Phase 4: all text generations now routed via AI SDK wrappers (no LangChain usage)

  constructor() {
    // Ensure Google AI key is present for AI SDK provider
    if (!process.env.GOOGLE_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      console.error("❌ Google Generative AI API key is not set (GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY)!");
      throw new Error("Google Generative AI API key is required");
    }
  }

  // Removed executeWithRateLimit/processQueue/retryRequest; using AI SDK call wrappers

  // Removed legacy per-call usage aggregation; rely on callLlm.ts logging

  /**
   * Get total token usage summary and reset tracker
   */
  public static getTokenSummary(): never {
    throw new Error('Token summary is deprecated. Use per-call logs emitted by callLlm.ts (usage tokens and ms).');
  }

  /**
   * Generates text based on a prompt (used for Master Prompt generation)
   */
  async generateText(prompt: string): Promise<string> {
    console.log("🤖 Starting LLM text generation (AI SDK)...");
    const systemMessage = "You are an expert at analyzing communication patterns and generating comprehensive style guides.";

    const { text } = await callText({
      model: models.flash(),
      system: systemMessage,
      prompt,
      temperature: 0.5,
      op: 'text.generate',
      concurrency: { key: 'text', maxConcurrency: 2 },
      retry: { maxAttempts: 3 },
    });
    return text;
  }

  /**
   * Generates text using the advanced model (for large prompts)
   */
  async generateTextWithAdvancedModel(prompt: string): Promise<string> {
    console.log("🤖 Starting LLM text generation with ADVANCED model (AI SDK)...");
    const systemMessage = "You are an expert at analyzing communication patterns and generating comprehensive style guides.";

    const { text } = await callText({
      model: models.pro(),
      system: systemMessage,
      prompt,
      temperature: 0.5,
      op: 'text.generate-advanced',
      concurrency: { key: 'text.pro', maxConcurrency: 2 },
      retry: { maxAttempts: 3 },
    });
    return text;
  }

  /**
   * Generates a distilled (summary) version of a full Master Prompt.
   */
  async generateDistilledMasterPrompt(fullMasterPrompt: string): Promise<string> {
    console.log("🌀 Starting distilled Master Prompt generation (AI SDK)...");
    const distillPromptTemplate = readPromptFile('style-voice/distilledMasterPromptGenerator.md');
    const prompt = distillPromptTemplate.replace('{fullMasterPrompt}', fullMasterPrompt);
    const systemMessage = "You are an AI Style Summarizer, skilled at creating concise, human-readable summaries of detailed text.";

    const { text } = await callText({
      model: models.flash(),
      system: systemMessage,
      prompt,
      temperature: 0.5,
      op: 'masterPrompt.distill',
      concurrency: { key: 'style', maxConcurrency: 3 },
    });
      console.log("✅ Distilled Master Prompt generated.");
    return text.trim();
  }

  /**
   * Updates a full Master Prompt based on user edits to its distilled version.
   */
  async updateFullMasterPrompt(
    originalFullMasterPrompt: string, 
    originalDistilledPrompt: string, 
    userEditedDistilledPrompt: string
  ): Promise<string> {
    console.log("🔄 Starting full Master Prompt update from distilled edits (AI SDK)...");
    const updaterPromptTemplate = readPromptFile('style-voice/masterPromptUpdaterFromDistilled.md');
    const prompt = updaterPromptTemplate
      .replace('{originalFullMasterPrompt}', originalFullMasterPrompt)
      .replace('{originalDistilledPrompt}', originalDistilledPrompt)
      .replace('{userEditedDistilledPrompt}', userEditedDistilledPrompt);
    const systemMessage = "You are an AI Master Prompt Synchronizer, skilled at intelligently merging user feedback into structured documents.";

    const { text } = await callText({
      model: models.pro(),
      system: systemMessage,
      prompt,
      temperature: 0.5,
      op: 'masterPrompt.update',
      concurrency: { key: 'style.pro', maxConcurrency: 2 },
    });
      console.log("✅ Full Master Prompt updated from distilled edits.");
    return text.trim();
  }

  /**
   * Enhanced reply generation that can work with contextual drafts
   */
  async generateReply(
    masterPrompt: string,
    emailContext: EmailContext,
    styleSummary?: string,
    contextualDraft?: string
  ): Promise<ReplyGenerationResult> {
    console.log("🤖 Starting LLM reply generation (AI SDK module)...");
    const result = await sdkGenerateReply({
        masterPrompt,
      emailContext: {
        incomingEmail: emailContext.incomingEmail,
        conversationThread: emailContext.conversationThread,
      },
      styleSummary,
      contextualDraft,
    });
      console.log("✅ Reply generated via AI SDK struct output", { confidence: result.confidence, cc: result.ccRecipients?.length ?? 0 });

      // Final defensive normalization to preserve formatting invariants
      const normalizeNewlines = (text: string): string => {
        if (!text) return text;
        let t = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        t = t
          .split('\n')
          .map((line) => line.replace(/[\t ]+$/g, ''))
          .join('\n');
        t = t.replace(/\n{3,}/g, '\n\n');
        return t;
      };

      return {
        ...result,
        reply: normalizeNewlines(result.reply),
        reasoning: result.reasoning ? result.reasoning.replace(/\s+/g, ' ').trim() : result.reasoning,
      };
  }

  /**
   * Generate email mappings using LLM - processes all emails at once with Gemini 2.5 Flash
   */
  async generateEmailMappings(
    availableFolders: any[], 
    emailAddresses: any[], 
    emailPatternContext: any
  ): Promise<any> {
    console.log(`🤖 Starting LLM email mapping generation (AI SDK module) for ${emailAddresses.length} addresses...`);
    const object = await sdkGenerateMappings({ availableFolders, emailAddresses, emailPatternContext });
    return this.validateEmailMappingResponse(object, emailAddresses);
  }

  

  // (Phase 2) Removed ad-hoc JSON parsing helpers. Structured outputs replace these.

  /**
   * Validate and normalize email mapping response structure
   */
  private validateEmailMappingResponse(response: any, emailAddresses: any[]): any {
    // Ensure we have the basic structure
    const validated = {
      mappingSuggestions: Array.isArray(response.mappingSuggestions) ? response.mappingSuggestions : [],
      bulkMappingOpportunities: Array.isArray(response.bulkMappingOpportunities) ? response.bulkMappingOpportunities : [],
      unmappedEmails: Array.isArray(response.unmappedEmails) ? response.unmappedEmails : [],
      overallStats: response.overallStats || {}
    };

    // Validate mapping suggestions
    validated.mappingSuggestions = validated.mappingSuggestions.filter((suggestion: any) => {
      return suggestion && 
             typeof suggestion.email === 'string' && 
             typeof suggestion.suggestedFolderName === 'string' &&
             typeof suggestion.confidence === 'number';
    });

    // Validate bulk mapping opportunities
    validated.bulkMappingOpportunities = validated.bulkMappingOpportunities.filter((opportunity: any) => {
      return opportunity && 
             typeof opportunity.pattern === 'string' && 
             typeof opportunity.suggestedFolderName === 'string' &&
             typeof opportunity.confidence === 'number';
    });

    // Ensure unmapped emails are properly formatted
    if (validated.unmappedEmails.length === 0 && emailAddresses.length > 0) {
      // If no unmapped emails were provided but we have email addresses,
      // create unmapped entries for emails not in mapping suggestions
      const mappedEmails = new Set(validated.mappingSuggestions.map((s: any) => s.email));
      validated.unmappedEmails = emailAddresses
        .filter((email: any) => !mappedEmails.has(email.emailAddress || email))
        .map((email: any) => ({
          email: email.emailAddress || email,
          reasoning: "Not mapped by LLM",
          suggestedAction: "manual_review"
        }));
    }

    // Ensure overall stats are complete
    validated.overallStats = {
      totalEmailsAnalyzed: emailAddresses.length,
      highConfidenceMappings: validated.mappingSuggestions.filter((s: any) => s.confidence >= 80).length,
      mediumConfidenceMappings: validated.mappingSuggestions.filter((s: any) => s.confidence >= 50 && s.confidence < 80).length,
      lowConfidenceMappings: validated.mappingSuggestions.filter((s: any) => s.confidence < 50).length,
      unmappedCount: validated.unmappedEmails.length,
      ...validated.overallStats
    };

    return validated;
  }

  /**
   * Generate smart folders based on user's email patterns
   */
  async generateFoldersFromEmails(
    recentEmails: Array<{
      from: string;
      to: string[];
      subject: string;
      body: string;
      date: Date;
    }>,
    senderAnalysis: Record<string, { count: number; domains: string[]; keywords: string[] }>,
    existingLabels?: Array<{ name: string; source: 'database' | 'gmail' | 'both' }>
  ): Promise<FolderGenerationResult> {
    try {
      console.log('🗂️ Generating smart folders from email patterns (AI SDK module)...');
      const object = await sdkGenerateFolders({ 
        recentEmails, 
        senderAnalysis, 
        existingLabels: existingLabels || []
      });
      console.log(`✅ Generated ${object.suggestedFolders.length} smart folders`);
      return object as FolderGenerationResult;
    } catch (error) {
      console.error('❌ Error generating folders from emails:', error);
      // Return fallback folder structure
        return {
          suggestedFolders: [
            {
              name: "Work",
              description: "Professional emails and work-related communications",
              metaPrompt: "Emails from colleagues, work tools, and professional communications",
              color: "#3B82F6",
              colorName: 'blue',
              importance: 'medium',
              icon: "💼",
              confidence: 70,
              reasoning: "Fallback work folder due to generation error",
              exampleSenders: [],
              keywordPatterns: ["meeting", "project", "work"]
            },
            {
              name: "Personal",
              description: "Personal communications and social emails",
              metaPrompt: "Personal emails from friends, family, and personal services",
              color: "#10B981",
              colorName: 'green',
              importance: 'low',
              icon: "👥",
              confidence: 70,
              reasoning: "Fallback personal folder due to generation error",
              exampleSenders: [],
              keywordPatterns: ["personal", "friend", "family"]
            },
            {
              name: "Newsletters",
              description: "Subscriptions, updates, and marketing emails",
              metaPrompt: "Newsletter subscriptions, marketing emails, and promotional content",
              color: "#F59E0B",
              colorName: 'orange',
              importance: 'low',
              icon: "📰",
              confidence: 70,
              reasoning: "Fallback newsletter folder due to generation error",
              exampleSenders: [],
              keywordPatterns: ["newsletter", "unsubscribe", "promotion"]
            },
            {
              name: "Review",
              description: "Emails that need manual review and sorting",
              metaPrompt: "Emails that don't clearly fit into other categories and require manual review",
              color: "#6B7280",
              colorName: 'gray',
              importance: 'low',
              icon: "📋",
              confidence: 100,
              reasoning: "Required review folder for manual classification",
              exampleSenders: [],
              keywordPatterns: []
            }
          ],
        overallAnalysis: {
          totalEmailsAnalyzed: recentEmails.length,
          primaryEmailTypes: ["work", "personal", "newsletters"],
          recommendedApproach: "Fallback structure due to generation error"
        },
        reasoning: "Folder generation failed, using fallback structure with basic categories"
      };
    }
  }

  /**
   * Suggest email address mappings to folders
   */
  async suggestEmailMappings(
    emailAddresses: string[],
    availableFolders: Array<{ id: string; name: string; metaPrompt: string; color: string }>,
    emailPatternContext?: string
  ): Promise<EmailMappingResult> {
    try {
      console.log('📧 Generating email mapping suggestions (AI SDK module)...');
      const object = await sdkSuggestMappings({ emailAddresses, availableFolders, emailPatternContext });
      console.log(`✅ Generated mappings for ${object.mappingSuggestions.length} email addresses`);
      return object as EmailMappingResult;
    } catch (error) {
      console.error('❌ Error generating email mappings:', error);
      // Return fallback mapping structure
      return {
        mappingSuggestions: [],
        bulkMappingOpportunities: [],
        unmappedEmails: emailAddresses.map(email => ({
          email,
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

} 
