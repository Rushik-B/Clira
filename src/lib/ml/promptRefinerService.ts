import { LLMService } from './llm';

export interface EmailExample {
  from: string;
  subject: string;
  snippet: string;
  labels?: string[];
}

export interface PromptRefinementRequest {
  folderName: string;
  userDraft: string;
  examples?: EmailExample[];
  existingFolders?: string[]; // Other folder names to avoid conflicts
}

export interface PromptRefinementResult {
  originalDraft: string;
  refinedPrompt: string;
  suggestions?: string[];
  warnings?: string[];
  confidence: number;
  tokensUsed: number;
}

/**
 * LLM-1: Prompt Refiner Service
 * 
 * Takes user's natural language folder rules and refines them into clear,
 * actionable meta-prompts that LLM-2 can use for accurate email routing.
 */
export class PromptRefinerService {
  private llmService: LLMService;

  constructor() {
    this.llmService = new LLMService();
  }

  /**
   * Refine a user's draft folder rule into an actionable meta-prompt
   */
  async refinePrompt(request: PromptRefinementRequest): Promise<PromptRefinementResult> {
    try {
      console.log(`[PROMPT REFINER] Refining rule for folder "${request.folderName}"`);

      const systemPrompt = this.buildSystemPrompt(request);
      const userPrompt = this.buildUserPrompt(request);
      const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

      console.log(`[PROMPT REFINER] Calling LLM for refinement...`);
      const refinedText = await this.llmService.generateText(fullPrompt);

      // Parse the LLM response to extract the refined prompt and any suggestions
      const parsed = this.parseRefinementResponse(refinedText);

      const result: PromptRefinementResult = {
        originalDraft: request.userDraft,
        refinedPrompt: parsed.refinedPrompt,
        suggestions: parsed.suggestions,
        warnings: parsed.warnings,
        confidence: this.calculateConfidence(request, parsed),
        tokensUsed: 0 // LLMService doesn't return token count currently
      };

      console.log(`[PROMPT REFINER] Successfully refined prompt for "${request.folderName}"`);
      return result;

    } catch (error) {
      console.error(`[PROMPT REFINER] Error refining prompt for "${request.folderName}":`, error);
      throw new Error(`Failed to refine prompt: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Build the system prompt that instructs LLM-1 on how to refine folder rules
   */
  private buildSystemPrompt(request: PromptRefinementRequest): string {
    return `You are an expert AI assistant that helps users create precise email sorting rules. Your job is to take a user's natural language description of what emails should go in a folder and refine it into a clear, actionable rule that another AI can follow consistently.

INSTRUCTIONS:
1. Rewrite the user's rule to be specific, unambiguous, and actionable
2. Use bullet points for clarity and structure
3. Include both positive criteria (what SHOULD be included) and negative criteria (what should NOT be included)
4. Add specific examples based on the provided sample emails when available
5. Make the rule robust enough to handle edge cases and variations
6. If the rule is vague or could cause conflicts, suggest improvements

FORMAT your response as:
REFINED_RULE:
[Your refined rule here]

SUGGESTIONS:
[Any suggestions for improvement - optional]

WARNINGS:
[Any potential conflicts or issues - optional]

CONTEXT:
- Folder name: "${request.folderName}"
- Other existing folders: ${request.existingFolders?.join(', ') || 'None'}
- This rule will be used by an AI to automatically sort emails every few hours
- Unclear emails will be sent to a "Review" folder for manual sorting`;
  }

  /**
   * Build the user prompt with the specific rule and examples
   */
  private buildUserPrompt(request: PromptRefinementRequest): string {
    let prompt = `FOLDER: ${request.folderName}

USER'S RULE: "${request.userDraft}"`;

    // Add email examples if provided
    if (request.examples && request.examples.length > 0) {
      prompt += `\n\nSAMPLE EMAILS THAT SHOULD MATCH THIS RULE:`;
      request.examples.slice(0, 5).forEach((example, index) => {
        prompt += `\n${index + 1}. From: ${example.from}`;
        prompt += `\n   Subject: "${example.subject}"`;
        if (example.snippet) {
          prompt += `\n   Snippet: "${example.snippet.substring(0, 100)}${example.snippet.length > 100 ? '...' : ''}"`;
        }
        prompt += '\n';
      });
    }

    prompt += `\n\nPlease refine this rule to be more precise and actionable for email routing.`;

    return prompt;
  }

  /**
   * Parse the LLM response to extract components
   */
  private parseRefinementResponse(response: string): {
    refinedPrompt: string;
    suggestions?: string[];
    warnings?: string[];
  } {
    try {
      const sections = response.split(/(?:REFINED_RULE:|SUGGESTIONS:|WARNINGS:)/i);
      
      let refinedPrompt = '';
      let suggestions: string[] = [];
      let warnings: string[] = [];

      // Find the refined rule section
      const refinedRuleMatch = response.match(/REFINED_RULE:\s*([\s\S]*?)(?=SUGGESTIONS:|WARNINGS:|$)/i);
      if (refinedRuleMatch) {
        refinedPrompt = refinedRuleMatch[1].trim();
      } else {
        // Fallback: use the entire response if no structured format
        refinedPrompt = response.trim();
      }

      // Extract suggestions if present
      const suggestionsMatch = response.match(/SUGGESTIONS:\s*([\s\S]*?)(?=WARNINGS:|$)/i);
      if (suggestionsMatch && suggestionsMatch[1].trim()) {
        suggestions = suggestionsMatch[1].trim().split('\n').filter(s => s.trim().length > 0);
      }

      // Extract warnings if present
      const warningsMatch = response.match(/WARNINGS:\s*([\s\S]*?)$/i);
      if (warningsMatch && warningsMatch[1].trim()) {
        warnings = warningsMatch[1].trim().split('\n').filter(w => w.trim().length > 0);
      }

      return {
        refinedPrompt: refinedPrompt || 'Error: Could not extract refined prompt',
        suggestions: suggestions.length > 0 ? suggestions : undefined,
        warnings: warnings.length > 0 ? warnings : undefined
      };

    } catch (error) {
      console.error('[PROMPT REFINER] Error parsing LLM response:', error);
      return {
        refinedPrompt: response.trim() || 'Error: Empty response from LLM',
        suggestions: undefined,
        warnings: ['Could not parse LLM response properly']
      };
    }
  }

  /**
   * Calculate confidence score based on various factors
   */
  private calculateConfidence(request: PromptRefinementRequest, parsed: any): number {
    let confidence = 70; // Base confidence

    // Higher confidence if we have examples
    if (request.examples && request.examples.length > 0) {
      confidence += 15;
    }

    // Higher confidence if the rule is specific
    if (request.userDraft.length > 20) {
      confidence += 10;
    }

    // Lower confidence if there are warnings
    if (parsed.warnings && parsed.warnings.length > 0) {
      confidence -= 15;
    }

    // Lower confidence if the refined prompt is very short (might be incomplete)
    if (parsed.refinedPrompt.length < 50) {
      confidence -= 20;
    }

    return Math.max(10, Math.min(95, confidence));
  }

  /**
   * Batch refine multiple folder rules
   */
  async batchRefinePrompts(requests: PromptRefinementRequest[]): Promise<PromptRefinementResult[]> {
    console.log(`[PROMPT REFINER] Batch refining ${requests.length} prompts`);
    
    // Process sequentially to avoid rate limiting
    const results: PromptRefinementResult[] = [];
    
    for (const request of requests) {
      try {
        const result = await this.refinePrompt(request);
        results.push(result);
        
        // Small delay between requests to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`[PROMPT REFINER] Failed to refine prompt for ${request.folderName}:`, error);
        
        // Add error result instead of failing the entire batch
        results.push({
          originalDraft: request.userDraft,
          refinedPrompt: request.userDraft, // Fallback to original
          confidence: 30,
          tokensUsed: 0,
          warnings: ['Failed to refine this prompt automatically']
        });
      }
    }
    
    console.log(`[PROMPT REFINER] Batch refinement completed: ${results.length} results`);
    return results;
  }

  /**
   * Validate if a prompt is clear and actionable
   */
  validatePrompt(prompt: string): { isValid: boolean; issues: string[] } {
    const issues: string[] = [];

    if (prompt.length < 20) {
      issues.push('Prompt is too short and may be unclear');
    }

    if (prompt.length > 1000) {
      issues.push('Prompt is too long and may confuse the routing AI');
    }

    if (!prompt.includes('•') && !prompt.includes('-') && !prompt.includes('*')) {
      issues.push('Consider using bullet points for better structure');
    }

    if (!prompt.toLowerCase().includes('not') && !prompt.toLowerCase().includes('except')) {
      issues.push('Consider adding negative criteria (what should NOT be included)');
    }

    const commonWords = ['email', 'message', 'from', 'subject'];
    const hasEmailTerms = commonWords.some(word => prompt.toLowerCase().includes(word));
    if (!hasEmailTerms) {
      issues.push('Prompt should reference email-specific criteria');
    }

    return {
      isValid: issues.length === 0,
      issues
    };
  }
}