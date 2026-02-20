export interface FolderData {
  id: string;
  name: string;
  description: string;
  instruction: string;
  color: string;
  icon: string;
  emailCount: number;
  isSystemDefault: boolean;
  mailboxId?: string;
  mailboxEmail?: string;
  mailboxDisplayName?: string;
  hardRules: HardRule[];
  examples: EmailExample[];
  confidence?: number;
}

export interface EmailExample {
  from: string;
  subject: string;
  snippet: string;
  date?: string;
}

export interface HardRule {
  id: string;
  condition: 'sender' | 'domain' | 'subject' | 'subject_contains' | 'subject_starts_with' | 'subject_ends_with' | 'subject_regex';
  value: string;
  action: 'move_to_folder';
  targetFolderId: string;
}

export interface EmailPreview {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  body?: string;
  date: string;
  suggestedFolder: string;
  confidence: number;
  gmailCategories?: string[];
  isRead?: boolean;
  hasAttachment?: boolean;
  priority?: 'high' | 'medium' | 'low';
  originalData?: any;
}

export interface EmailCorrection {
  emailId: string;
  emailFrom: string;
  fromFolder: string;
  toFolder: string;
  shouldLearn: boolean;
  reason?: string;
}

export interface ReorganizationResult {
  folders: FolderData[];
  emailChanges: {
    folderId: string;
    emails: EmailPreview[];
  }[];
  stats: {
    totalEmails: number;
    emailsMoved: number;
    foldersAffected: number;
  };
}

export type PageMode = 'management' | 'review' | 'reorganizing';

// Helper functions for folder description quality
export function isWellDescribed(folder: FolderData): boolean {
  const instruction = folder.instruction;
  // A folder is well-described if it has any custom instruction (not null/empty)
  // and is not the auto-generated fallback text
  return !!(instruction && 
    instruction.trim() !== '' && 
    instruction !== `Emails related to ${folder.name}`);
}

export function getDescriptionQuality(folder: FolderData): 'high' | 'low' {
  return isWellDescribed(folder) ? 'high' : 'low';
}

export function getAccuracyLevel(folder: FolderData): string {
  return isWellDescribed(folder) ? 'Excellent' : 'Basic';
}
