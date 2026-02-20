import * as fs from 'fs';
import * as path from 'path';

// Simple default master prompt text
export const DEFAULT_MASTER_PROMPT = `You are an AI assistant helping to write professional email replies. 

Keep responses:
- Professional but friendly
- Clear and concise
- Helpful and solution-oriented

Match the tone of the incoming email and be appropriately formal or casual.`;

/**
 * Utility function to read prompt files from the prompts directory
 */
export const readPromptFile = (filename: string): string => {
  try {
    const promptPath = path.join(process.cwd(), 'src/prompts', filename);
    return fs.readFileSync(promptPath, 'utf-8');
  } catch (error) {
    console.error(`Error reading prompt file ${filename}:`, error);
    throw new Error(`Failed to load prompt file: ${filename}`);
  }
};

/**
 * Load default master prompt
 */
export const getDefaultMasterPrompt = (): string => {
  return readPromptFile('style-voice/defaultMasterPrompt.md');
};

/**
 * Load style analysis prompt
 */
export const getStyleAnalysisPrompt = (): string => {
  try {
    return readPromptFile('style-voice/styleAnalysisPrompt.md');
  } catch (error) {
    console.error('Error loading style analysis prompt:', error);
    // Fallback prompt if file doesn't exist
    return `
Analyze the following email history to understand the communication style patterns.

{emailHistory}

{generalUserStyle}

Focus on identifying:
- Tone and formality preferences
- Greeting and closing patterns
- Sentence structure and length
- Vocabulary choices
- Communication personality

Provide a summary that can guide email reply generation.
    `.trim();
  }
};

/**
 * Load reply generation prompt
 */
export const getReplyGenerationPrompt = (): string => {
  return readPromptFile('core-processing/replyGenerationPrompt.md');
};

/**
 * NEW: Load incoming email scanner prompt
 */
export const getIncomingEmailScannerPrompt = (): string => {
  return readPromptFile('core-processing/incomingEmailScannerPrompt.md');
};

/**
 * NEW: Load final tool context generator prompt
 */
export const getFinalToolContextGeneratorPrompt = (): string => {
  return readPromptFile('core-processing/finalToolContextGeneratorPrompt.md');
}; 

/**
 * Stage 1 (Router): Reply eligibility prompt
 */
export const getReplyRouterPrompt = (): string => {
  return readPromptFile('core-processing/replyRouterPrompt.md');
};

export function getEmailMappingPrompt(): string {
  return readPromptFile('organization-routing/emailMappingPrompt.xml');
}

export function getFolderGenerationPrompt(): string {
  // Onboarding uses the original MD template for folder generation
  return readPromptFile('organization-routing/folderGenerationPrompt.xml');
} 