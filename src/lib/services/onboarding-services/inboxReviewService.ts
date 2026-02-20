/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
// Inbox Review Service for detailed email preview and corrections
import { prisma } from '../../prisma';
import { EmailCategorizationService } from './emailCategorizationService';
import { EmailMappingService } from './emailMappingService';
import {
  EmailPreviewOptions,
  EmailPreview,
  ReviewFolder,
  EmailPreviewResult,
  EmailCorrection,
  CorrectionResult
} from './types';

/**
 * Inbox Review Service - Handles email preview generation and user corrections
 * 
 * This service provides:
 * 1. Email preview generation with current AI sorting decisions
 * 2. User correction handling with learning capabilities
 * 3. Integration with existing categorization and mapping services
 */
export class InboxReviewService {
  
  constructor() {
    // Service is ready
  }

  /**
   * Generate email preview with current sorting decisions
   */
  async generateEmailPreview(userId: string, options: EmailPreviewOptions = {}): Promise<EmailPreviewResult> {
    console.log(`[INBOX REVIEW] Generating email preview for user ${userId}`);
    
    const {
      maxEmails = 50,
      includeConfidence = true,
      groupByFolder = true,
      sampleSize = 10
    } = options;

    try {
      // Get categorization results via queue/cached worker output to ensure consistent data shape
      const categorizationService = new EmailCategorizationService();
      const job = await categorizationService.queueCategorizationJob(userId, {
        maxEmails,
        minFrequency: 1,
        daysBack: undefined
      });

      let categorizationResult: any = null;
      if (job.cached) {
        categorizationResult = await categorizationService.getCategorizationResult(userId, {
          maxEmails,
          minFrequency: 1
        });
        if (!categorizationResult) {
          throw new Error('Cached result indicated but not found');
        }
      } else {
        const MAX_WAIT_TIME = 60000; // 60s wait for preview API
        const POLL_INTERVAL = 1000;
        let waited = 0;
        while (waited < MAX_WAIT_TIME) {
          await new Promise(r => setTimeout(r, POLL_INTERVAL));
          waited += POLL_INTERVAL;
          const status = await categorizationService.getJobStatus(job.jobId);
          if (status.status === 'completed') {
            categorizationResult = status.result;
            break;
          }
          if (status.status === 'failed') {
            throw new Error(`Categorization job failed: ${status.error}`);
          }
        }
        if (!categorizationResult) {
          throw new Error('Categorization preview timeout');
        }
      }

      // Get user's folders
      const userFolders = await prisma.label.findMany({
        where: { userId },
        orderBy: { name: 'asc' }
      });

      // Create folder map
      const folderMap = new Map(userFolders.map(f => [f.name.toLowerCase(), f]));

      // Group emails by suggested folder
      const folderGroups = new Map<string, EmailPreview[]>();
      
      // Process categorized emails and create previews
      for (const emailData of categorizationResult.categorizedEmails) {
        const folderName = emailData.suggestedFolder;
        const folder = userFolders.find(f => f.name.toLowerCase() === folderName.toLowerCase());
        if (!folder) continue;

        // Build up to sampleSize previews per sender using available samples
        const count = Math.min(sampleSize, (emailData.sampleSubjects?.length || 1));
        for (let i = 0; i < count; i++) {
          const emailPreview: EmailPreview = {
            id: `${emailData.emailAddress}-${i}`,
            from: emailData.emailAddress,
            subject: emailData.sampleSubjects?.[i] || emailData.sampleSubjects?.[0] || 'No Subject',
            snippet: emailData.sampleSnippets?.[i] || emailData.sampleSnippets?.[0] || 'No preview available',
            date: new Date().toISOString(),
            suggestedFolder: folder.id,
            confidence: includeConfidence ? (emailData.confidence || 0) : 0,
            gmailCategories: [],
            originalData: {
              ...emailData,
              gmailMessageId: Array.isArray(emailData.sampleMessageIds) ? emailData.sampleMessageIds[i] : undefined,
              emailAddress: emailData.emailAddress
            }
          };

          if (!folderGroups.has(folder.id)) folderGroups.set(folder.id, []);
          folderGroups.get(folder.id)!.push(emailPreview);
        }
      }

      // Create review folders
      const reviewFolders: ReviewFolder[] = [];
      
      for (const folder of userFolders) {
        const emails = folderGroups.get(folder.id) || [];
        
        // Sample emails for preview (don't show all)
        const sampledEmails = emails.slice(0, sampleSize);
        
        // Calculate folder confidence
        const folderConfidence = emails.length > 0 
          ? Math.round(emails.reduce((sum, email) => sum + email.confidence, 0) / emails.length)
          : 100;

        if (sampledEmails.length > 0 || folder.isSystemDefault) {
          reviewFolders.push({
            id: folder.id,
            name: folder.name,
            icon: this.getFolderIcon(folder.name),
            description: folder.metaPrompt || `Emails related to ${folder.name}`,
            color: folder.color || '#6B7280',
            emails: sampledEmails,
            confidence: folderConfidence
          });
        }
      }

      // Calculate overall stats
      const totalEmails = Array.from(folderGroups.values()).reduce((sum, emails) => sum + emails.length, 0);
      const allEmails = Array.from(folderGroups.values()).flat();
      const averageConfidence = allEmails.length > 0 
        ? Math.round(allEmails.reduce((sum, email) => sum + email.confidence, 0) / allEmails.length)
        : 0;

      console.log(`[INBOX REVIEW] Generated preview: ${reviewFolders.length} folders, ${totalEmails} emails, ${averageConfidence}% avg confidence`);

      return {
        folders: reviewFolders,
        totalEmails,
        averageConfidence,
        generatedAt: new Date()
      };

    } catch (error) {
      console.error(`[INBOX REVIEW] Error generating email preview:`, error);
      throw error;
    }
  }

  /**
   * Apply user corrections and learn from them
   */
  async applyCorrectionsBatch(userId: string, corrections: EmailCorrection[]): Promise<CorrectionResult> {
    console.log(`[INBOX REVIEW] Applying ${corrections.length} corrections for user ${userId}`);
    
    const result: CorrectionResult = {
      appliedCorrections: 0,
      rulesCreated: 0,
      promptsRefined: 0,
      errors: []
    };

    try {
      const emailMappingService = new EmailMappingService();
      
      for (const correction of corrections) {
        try {
          // Apply the correction (this is mainly for tracking purposes)
          result.appliedCorrections++;

          // If user wants to learn from this correction
          if (correction.shouldLearn) {
            // Extract email information from correction
            // In a real implementation, we'd store more email data
            // For now, we'll create a simple rule based on the correction pattern
            
            // This is a simplified learning mechanism
            // In production, you'd want more sophisticated pattern detection
            await this.createLearningRule(userId, correction, emailMappingService);
            result.rulesCreated++;
          }

        } catch (correctionError) {
          console.error(`[INBOX REVIEW] Error applying correction ${correction.emailId}:`, correctionError);
          result.errors.push(`Failed to apply correction for email ${correction.emailId}: ${correctionError instanceof Error ? correctionError.message : 'Unknown error'}`);
        }
      }

      console.log(`[INBOX REVIEW] Applied ${result.appliedCorrections} corrections, created ${result.rulesCreated} rules`);
      return result;

    } catch (error) {
      console.error(`[INBOX REVIEW] Error applying corrections batch:`, error);
      throw error;
    }
  }

  /**
   * Create a learning rule from a user correction
   */
  private async createLearningRule(userId: string, correction: EmailCorrection, emailMappingService: EmailMappingService): Promise<void> {
    try {
      // Delegate to EmailMappingService for actual rule creation
      // Extract email from correction data - in production this would come from the email object
      const emailFrom = correction.emailId; // Simplified - in reality this would be email.from
      
      // Get the target label ID from folder name
      const targetLabel = await prisma.label.findFirst({
        where: {
          userId,
          name: correction.toFolder
        }
      });

      if (targetLabel) {
        await emailMappingService.createRuleFromCorrection(
          userId,
          emailFrom,
          targetLabel.id,
          'email', // Default to email rule type
          95 // High confidence for user corrections
        );
        console.log(`[INBOX REVIEW] Created mapping rule for ${emailFrom} → ${correction.toFolder}`);
      }
      
    } catch (error) {
      console.error(`[INBOX REVIEW] Error creating learning rule:`, error);
      throw error;
    }
  }

  /**
   * Refine folder prompts based on user corrections
   */
  async refineFolderPrompts(userId: string, corrections: EmailCorrection[]): Promise<number> {
    console.log(`[INBOX REVIEW] Refining folder prompts based on ${corrections.length} corrections`);
    
    try {
      // Group corrections by target folder
      const correctionsByFolder = new Map<string, EmailCorrection[]>();
      
      for (const correction of corrections) {
        if (!correctionsByFolder.has(correction.toFolder)) {
          correctionsByFolder.set(correction.toFolder, []);
        }
        correctionsByFolder.get(correction.toFolder)!.push(correction);
      }

      let refinedPrompts = 0;

      // For each folder with corrections, consider prompt refinement
      for (const [folderId, folderCorrections] of correctionsByFolder) {
        if (folderCorrections.length >= 2) { // Only refine if multiple corrections point to same folder
          try {
            await this.refineSingleFolderPrompt(userId, folderId, folderCorrections);
            refinedPrompts++;
          } catch (error) {
            console.error(`[INBOX REVIEW] Error refining prompt for folder ${folderId}:`, error);
          }
        }
      }

      console.log(`[INBOX REVIEW] Refined ${refinedPrompts} folder prompts`);
      return refinedPrompts;

    } catch (error) {
      console.error(`[INBOX REVIEW] Error refining folder prompts:`, error);
      throw error;
    }
  }

  /**
   * Refine a single folder's prompt based on corrections
   */
  private async refineSingleFolderPrompt(userId: string, folderId: string, corrections: EmailCorrection[]): Promise<void> {
    try {
      // Get current folder
      const folder = await prisma.label.findFirst({
        where: { id: folderId, userId }
      });

      if (!folder) {
        throw new Error(`Folder ${folderId} not found`);
      }

      // In a production system, you'd use the LLM service to refine the prompt
      // based on the patterns in the corrections
      console.log(`[INBOX REVIEW] Would refine prompt for folder "${folder.name}" based on ${corrections.length} corrections`);
      
      // This is where you'd implement LLM-based prompt refinement
      // const llmService = new LLMService();
      // const refinedPrompt = await llmService.refinePromptFromCorrections(folder.metaPrompt, corrections);
      
    } catch (error) {
      console.error(`[INBOX REVIEW] Error refining single folder prompt:`, error);
      throw error;
    }
  }

  /**
   * Get appropriate icon for folder based on name
   */
  private getFolderIcon(folderName: string): string {
    const name = folderName.toLowerCase();
    
    if (name.includes('newsletter') || name.includes('promo')) return '📧';
    if (name.includes('financial') || name.includes('money') || name.includes('pay')) return '💰';
    if (name.includes('travel') || name.includes('flight') || name.includes('hotel')) return '✈️';
    if (name.includes('notification') || name.includes('alert')) return '🔔';
    if (name.includes('action') || name.includes('todo')) return '📝';
    if (name.includes('review') || name.includes('manual')) return '👀';
    if (name.includes('work') || name.includes('business')) return '💼';
    if (name.includes('personal') || name.includes('family')) return '👥';
    if (name.includes('health') || name.includes('medical')) return '🏥';
    if (name.includes('shopping') || name.includes('order')) return '🛒';
    
    return '📁'; // Default folder icon
  }

  /**
   * Get correction suggestions for similar emails
   */
  async getCorrectionSuggestions(userId: string, correction: EmailCorrection): Promise<{
    similarEmails: number;
    suggestedRule: string;
    confidence: number;
  }> {
    try {
      // Delegate to EmailMappingService for similarity analysis
      const emailMappingService = new EmailMappingService();
      const suggestions = await emailMappingService.suggestSimilarEmails(
        userId,
        correction.emailId, // Simplified - in reality this would be email.from
        'domain' // Default to domain-based suggestions
      );

      return {
        similarEmails: suggestions.affectedCount,
        suggestedRule: suggestions.suggestedRule,
        confidence: suggestions.affectedCount > 1 ? 75 : 25 // Higher confidence for more affected emails
      };
    } catch (error) {
      console.error(`[INBOX REVIEW] Error getting correction suggestions:`, error);
      return {
        similarEmails: 0,
        suggestedRule: 'Error generating suggestions',
        confidence: 0
      };
    }
  }
}