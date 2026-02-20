import { prisma } from '../prisma';
import { LLMService } from './llm';
import { readPromptFile } from '../prompts';
import { QualityTrackerService } from '../services/utils/qualityTracker';

export interface GeneratedMasterPrompt {
  fullMasterPrompt: string;
  distilledMasterPrompt: string;
  emailsAnalyzed: number;
  generatedAt: Date;
  confidence: number;
}


export class MasterPromptGeneratorService {
  private llmService: LLMService;
  private qualityTracker: QualityTrackerService;

  constructor() {
    this.llmService = new LLMService();
    this.qualityTracker = new QualityTrackerService();
  }

  /**
   * Utility function for delays between LLM calls
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generate a personalized Master Prompt for a user based on their sent emails
   */
  async generateMasterPrompt(userId: string, sentEmails: any[]): Promise<GeneratedMasterPrompt> {
    try {
      console.log(`Starting Master Prompt generation for user: ${userId}`);

      if (sentEmails.length === 0) {
        throw new Error('No sent emails found for Master Prompt generation');
      }

      console.log(`📧 Analyzing ${sentEmails.length} sent emails for Master Prompt generation`);

      // Format emails for analysis
      const emailCorpus = this.formatEmailsForAnalysis(sentEmails);

      // Generate full Master Prompt using LLM
      console.log('🧠 Generating full Master Prompt...');
      const fullMasterPrompt = await this.generateFullMasterPromptWithLLM(emailCorpus);

      // Generate distilled version for user display
      console.log('⏳ Waiting 5 seconds before generating distilled Master Prompt...');
      await this.delay(5000);
      console.log('🌀 Generating distilled Master Prompt...');
      const distilledMasterPrompt = await this.llmService.generateDistilledMasterPrompt(fullMasterPrompt);

      // Calculate confidence based on email count and content quality
      const confidence = this.calculateConfidence(sentEmails.length, emailCorpus);

      console.log(`✅ Master Prompt generated (confidence: ${confidence}%)`)

      return {
        fullMasterPrompt,
        distilledMasterPrompt,
        emailsAnalyzed: sentEmails.length,
        generatedAt: new Date(),
        confidence
      };

    } catch (error) {
      console.error('Error generating Master Prompt:', error);
      throw new Error(`Failed to generate Master Prompt: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // REMOVED: Interaction Network and Strategic Rulebook generation methods - no longer needed

  /**
   * Generate and save Master Prompt for a user, deactivating previous ones
   */
  async generateAndSaveMasterPrompt(userId: string, emails?: any[]): Promise<{ id: string; version: number; confidence: number }> {
    try {
      // Use provided emails or fetch them if not provided
      const emailsToProcess = emails ?? await this.fetchUserSentEmails(userId, 180);

      // Generate the Master Prompt
      const generated = await this.generateMasterPrompt(userId, emailsToProcess);

      // Get current highest version
      const currentPrompt = await prisma.masterPrompt.findFirst({
        where: { userId },
        orderBy: { version: 'desc' }
      });

      const nextVersion = currentPrompt ? currentPrompt.version + 1 : 1;

      // Deactivate all existing prompts
      await prisma.masterPrompt.updateMany({
        where: { userId },
        data: { isActive: false }
      });

      // Save new Master Prompt with both full and distilled versions
      const savedPrompt = await prisma.masterPrompt.create({
        data: {
          userId,
          prompt: generated.distilledMasterPrompt, // User sees distilled version
          version: nextVersion,
          isActive: true,
          isGenerated: true,
          metadata: {
            fullMasterPrompt: generated.fullMasterPrompt, // Full version stored in metadata
            originalDistilledPrompt: generated.distilledMasterPrompt, // Keep original for comparison
            emailsAnalyzed: generated.emailsAnalyzed,
            generatedAt: generated.generatedAt.toISOString(),
            confidence: generated.confidence
          }
        }
      });

      // Mark master prompt as successfully generated
      await prisma.user.update({
        where: { id: userId },
        data: { masterPromptGenerated: true }
      });

      // Mark quality as true
      await this.qualityTracker.markMasterPromptQuality(userId, true);

      console.log(`✅ Master Prompt v${nextVersion} saved for user ${userId}`);

      return {
        id: savedPrompt.id,
        version: savedPrompt.version,
        confidence: generated.confidence
      };

    } catch (error) {
      console.error('Error generating and saving Master Prompt:', error);
      throw error;
    }
  }


  /**
   * Update Master Prompt based on user edits to distilled version
   */
  async updateMasterPromptFromDistilled(
    userId: string, 
    promptId: string, 
    userEditedDistilledPrompt: string
  ): Promise<{ id: string; version: number }> {
    try {
      console.log(`Updating Master Prompt from distilled edits for user: ${userId}`);

      // Get the current prompt
      const currentPrompt = await prisma.masterPrompt.findFirst({
        where: { id: promptId, userId }
      });

      if (!currentPrompt || !currentPrompt.metadata) {
        throw new Error('Master Prompt not found or missing metadata');
      }

      const metadata = currentPrompt.metadata as any;
      const originalFullMasterPrompt = metadata.fullMasterPrompt;
      const originalDistilledPrompt = metadata.originalDistilledPrompt;

      if (!originalFullMasterPrompt || !originalDistilledPrompt) {
        throw new Error('Missing original prompts in metadata');
      }

      // Use LLM to update the full Master Prompt based on user edits
      console.log('🔄 Translating distilled edits to full Master Prompt...');
      const updatedFullMasterPrompt = await this.llmService.updateFullMasterPrompt(
        originalFullMasterPrompt,
        originalDistilledPrompt,
        userEditedDistilledPrompt
      );

      // Get next version number
      const nextVersion = currentPrompt.version + 1;

      // Deactivate current prompt
      await prisma.masterPrompt.updateMany({
        where: { userId },
        data: { isActive: false }
      });

      // Create new version with updated prompts
      const updatedPrompt = await prisma.masterPrompt.create({
        data: {
          userId,
          prompt: userEditedDistilledPrompt, // User's edited distilled version
          version: nextVersion,
          isActive: true,
          isGenerated: true,
          metadata: {
            fullMasterPrompt: updatedFullMasterPrompt, // Updated full version with USER_DIRECTIVE marks
            originalDistilledPrompt: originalDistilledPrompt, // Keep original for reference
            emailsAnalyzed: metadata.emailsAnalyzed,
            generatedAt: metadata.generatedAt,
            confidence: metadata.confidence,
            lastEditedAt: new Date().toISOString(),
            hasUserEdits: true
          }
        }
      });

      console.log(`✅ Master Prompt updated to v${nextVersion} with user edits`);

      return {
        id: updatedPrompt.id,
        version: updatedPrompt.version
      };

    } catch (error) {
      console.error('Error updating Master Prompt from distilled edits:', error);
      throw error;
    }
  }

  /**
   * Check if user has sufficient emails for Master Prompt generation
   */
  async canGenerateMasterPrompt(userId: string): Promise<{ canGenerate: boolean; emailCount: number; minimumRequired: number }> {
    const minimumRequired = 5; // Lowered requirement as requested
    
    const emailCount = await prisma.email.count({
      where: {
        thread: { userId },
        isSent: true
      }
    });

    return {
      canGenerate: emailCount >= minimumRequired,
      emailCount,
      minimumRequired
    };
  }

  /**
   * Check if user has a master prompt, if not generate one automatically
   */
  async ensureUserHasMasterPrompt(userId: string): Promise<boolean> {
    try {
      // Check if user already has an active master prompt
      const existingPrompt = await prisma.masterPrompt.findFirst({
        where: {
          userId,
          isActive: true
        }
      });

      if (existingPrompt) {
        console.log(`✅ User ${userId} already has master prompt v${existingPrompt.version}`);
        return true;
      }

      // Check if user has enough emails
      const canGenerate = await this.canGenerateMasterPrompt(userId);
      
      if (!canGenerate.canGenerate) {
        console.log(`⚠️ User ${userId} needs ${canGenerate.minimumRequired - canGenerate.emailCount} more emails for master prompt generation`);
        return false;
      }

      // Generate master prompt automatically
      console.log(`🚀 Auto-generating master prompt for user ${userId} with ${canGenerate.emailCount} emails`);
      
      await this.generateAndSaveMasterPrompt(userId);
      
      console.log(`✅ Successfully auto-generated master prompt for user ${userId}`);
      return true;

    } catch (error) {
      console.error(`❌ Error ensuring master prompt for user ${userId}:`, error);
      // Mark quality as false so background job can retry
      await this.qualityTracker.markMasterPromptQuality(userId, false);
      return false;
    }
  }


  /**
   * Fetch user's sent emails for analysis - using large limit for 1M context window
   */
  private async fetchUserSentEmails(userId: string, limit: number = 180) {
    const emails = await prisma.email.findMany({
      where: {
        thread: { userId },
        isSent: true,
        // Exclude very short emails (likely auto-replies or brief responses)
        body: {
          not: {
            in: ['', 'Thanks', 'Thank you', 'Got it', 'Ok', 'Okay', 'Yes', 'No']
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        thread: true
      }
    });

    return emails.filter((email: any) => 
      email.body.length > 10 && // Filter out very short emails
      !this.isAutoReply(email.body) // Filter out auto-replies
    );
  }

  /**
   * Format emails into the corpus format expected by the LLM
   */
  private formatEmailsForAnalysis(emails: any[]): string {
    return emails.map(email => {
      const toList = Array.isArray(email.to) ? email.to.join(', ') : email.to;
      
      // Handle both database emails (createdAt) and Gmail API emails (date)
      const emailDate = email.createdAt || email.date;
      const dateString = emailDate instanceof Date ? emailDate.toISOString() : new Date(emailDate).toISOString();
      
      return `--- EMAIL START ---
From: ${email.from}
To: ${toList}
Subject: ${email.subject}
Date: ${dateString}

${email.body}
--- EMAIL END ---`;
    }).join('\n\n');
  }

  /**
   * Generate Master Prompt using LLM service
   */
  private async generateFullMasterPromptWithLLM(emailCorpus: string): Promise<string> {
    try {
      // Load the Master Style Derivation prompt
      const promptTemplate = readPromptFile('style-voice/masterStyleDerivationPrompt.md');
      
      // Replace placeholder with actual email corpus
      const prompt = promptTemplate.replace('{userSentEmailCorpus}', emailCorpus);

      console.log('Sending email corpus to LLM for Master Prompt generation...');
      
      // Generate the Master Prompt
      const response = await this.llmService.generateText(prompt);

      // Extract the markdown block if present
      const markdownMatch = response.match(/```markdown\n([\s\S]*?)\n```/);
      if (markdownMatch) {
        return markdownMatch[1].trim();
      }

      // If no markdown block, return the full response
      return response.trim();

    } catch (error) {
      console.error('Error generating Master Prompt with LLM:', error);
      throw new Error('Failed to generate Master Prompt with LLM');
    }
  }

  /**
   * Calculate confidence score based on email quantity and quality
   */
  private calculateConfidence(emailCount: number, emailCorpus: string): number {
    let confidence = 0;

    // Base confidence from email count (0-60 points) - adjusted for lower requirements
    if (emailCount >= 50) confidence += 60;
    else if (emailCount >= 25) confidence += 50;
    else if (emailCount >= 15) confidence += 40;
    else if (emailCount >= 10) confidence += 35;
    else if (emailCount >= 5) confidence += 25; // Lower threshold
    else confidence += 15;

    // Additional confidence from corpus quality (0-40 points)
    const averageEmailLength = emailCorpus.length / emailCount;
    if (averageEmailLength >= 500) confidence += 40;
    else if (averageEmailLength >= 300) confidence += 30;
    else if (averageEmailLength >= 150) confidence += 20;
    else confidence += 10;

    return Math.min(confidence, 100);
  }

  /**
   * Simple heuristic to detect auto-replies
   */
  private isAutoReply(body: string): boolean {
    const autoReplyIndicators = [
      'out of office',
      'automatic reply',
      'auto-reply',
      'vacation response',
      'currently away',
      'will respond when',
      'thank you for your email'
    ];

    const lowerBody = body.toLowerCase();
    return autoReplyIndicators.some(indicator => lowerBody.includes(indicator));
  }
}