/**
 * Smart Folder Icon Helper
 * Intelligent icon mapping for folder names with advanced pattern matching
 */

interface FolderIconMapping {
  keywords: string[];
  icon: string;
  priority: number; // Higher priority = more specific match
}

// Comprehensive icon mappings with priority system
const ICON_MAPPINGS: FolderIconMapping[] = [
  // Financial & Banking (High Priority)
  { keywords: ['payment', 'invoice', 'receipt', 'billing', 'financial', 'finance', 'bank', 'transaction', 'stripe', 'paypal', 'credit', 'expense'], icon: '💰', priority: 10 },
  { keywords: ['tax', 'irs', 'accounting', 'bookkeeping'], icon: '📊', priority: 9 },
  
  // Work & Business (High Priority)
  { keywords: ['work', 'office', 'business', 'corporate', 'company', 'professional', 'meeting', 'project', 'team'], icon: '💼', priority: 10 },
  { keywords: ['hr', 'human resources', 'payroll', 'benefits'], icon: '👥', priority: 9 },
  { keywords: ['legal', 'contract', 'agreement', 'compliance'], icon: '⚖️', priority: 9 },
  
  // Communications & Marketing (High Priority)
  { keywords: ['newsletter', 'marketing', 'promotional', 'campaign', 'email marketing', 'mailchimp', 'constant contact'], icon: '📧', priority: 10 },
  { keywords: ['announcement', 'news', 'update', 'blog', 'digest'], icon: '📰', priority: 8 },
  
  // Notifications & Alerts (High Priority)
  { keywords: ['notification', 'alert', 'reminder', 'notice', 'warning', 'system', 'automated', 'no-reply', 'noreply'], icon: '🔔', priority: 10 },
  { keywords: ['security', 'login', 'password', 'verification', 'auth', '2fa', 'mfa'], icon: '🔐', priority: 9 },
  
  // Shopping & E-commerce (Medium Priority)
  { keywords: ['shopping', 'order', 'purchase', 'cart', 'checkout', 'delivery', 'shipping', 'amazon', 'ebay', 'etsy'], icon: '🛒', priority: 8 },
  { keywords: ['wishlist', 'deals', 'sale', 'discount', 'coupon', 'offer'], icon: '🛍️', priority: 7 },
  
  // Travel & Transportation (Medium Priority)
  { keywords: ['travel', 'flight', 'booking', 'hotel', 'reservation', 'trip', 'vacation', 'airline', 'airbnb'], icon: '✈️', priority: 8 },
  { keywords: ['uber', 'lyft', 'taxi', 'transport', 'ride'], icon: '🚗', priority: 7 },
  
  // Health & Medical (Medium Priority)
  { keywords: ['health', 'medical', 'doctor', 'appointment', 'hospital', 'pharmacy', 'prescription', 'wellness'], icon: '🏥', priority: 8 },
  { keywords: ['fitness', 'gym', 'workout', 'exercise', 'nutrition'], icon: '💪', priority: 7 },
  
  // Education & Learning (Medium Priority)
  { keywords: ['education', 'learning', 'course', 'training', 'school', 'university', 'student', 'academic'], icon: '📚', priority: 8 },
  { keywords: ['certification', 'diploma', 'degree', 'graduation'], icon: '🎓', priority: 7 },
  
  // Personal & Family (Medium Priority)
  { keywords: ['personal', 'family', 'friend', 'social', 'birthday', 'anniversary', 'celebration'], icon: '🏠', priority: 7 },
  { keywords: ['hobby', 'interest', 'entertainment', 'game', 'fun'], icon: '🎯', priority: 6 },
  
  // Technology & Development (Medium Priority)
  { keywords: ['tech', 'technology', 'software', 'app', 'development', 'coding', 'programming', 'github', 'dev'], icon: '💻', priority: 8 },
  { keywords: ['api', 'webhook', 'integration', 'deployment', 'server'], icon: '⚙️', priority: 7 },
  
  // Review & Action Items (Medium Priority)
  { keywords: ['review', 'check', 'verify', 'confirm', 'pending', 'action', 'todo', 'task'], icon: '👀', priority: 8 },
  { keywords: ['urgent', 'important', 'priority', 'asap', 'deadline'], icon: '🚨', priority: 9 },
  
  // Subscriptions & Services (Low Priority)
  { keywords: ['subscription', 'service', 'plan', 'membership', 'saas', 'software'], icon: '🔄', priority: 6 },
  { keywords: ['utility', 'bill', 'electricity', 'gas', 'water', 'internet'], icon: '🏠', priority: 6 },
  
  // Entertainment & Media (Low Priority)
  { keywords: ['entertainment', 'media', 'music', 'video', 'streaming', 'netflix', 'spotify'], icon: '🎵', priority: 6 },
  { keywords: ['book', 'reading', 'kindle', 'audiobook'], icon: '📖', priority: 6 },
  
  // Food & Dining (Low Priority)
  { keywords: ['food', 'restaurant', 'dining', 'delivery', 'recipe', 'cooking', 'grubhub', 'doordash'], icon: '🍕', priority: 6 },
  
  // Real Estate & Home (Low Priority)
  { keywords: ['real estate', 'property', 'home', 'house', 'apartment', 'rent', 'mortgage', 'realtor'], icon: '🏡', priority: 6 },
  
  // Insurance (Low Priority)
  { keywords: ['insurance', 'policy', 'claim', 'coverage', 'premium'], icon: '🛡️', priority: 6 },
  
  // Generic categories (Lowest Priority)
  { keywords: ['misc', 'miscellaneous', 'other', 'general'], icon: '📁', priority: 1 },
  { keywords: ['archive', 'old', 'past', 'historical'], icon: '📦', priority: 2 },
];

// Additional context-based mappings for common email patterns
const SENDER_PATTERN_MAPPINGS: { pattern: RegExp; icon: string; priority: number }[] = [
  { pattern: /noreply|no-reply|donotreply/i, icon: '🔔', priority: 8 },
  { pattern: /support|help|service/i, icon: '🎧', priority: 7 },
  { pattern: /billing|invoice|payment/i, icon: '💰', priority: 9 },
  { pattern: /newsletter|digest|updates/i, icon: '📧', priority: 8 },
  { pattern: /security|alert|warning/i, icon: '🔐', priority: 9 },
  { pattern: /github|gitlab|bitbucket/i, icon: '💻', priority: 8 },
  { pattern: /linkedin|twitter|facebook/i, icon: '🌐', priority: 7 },
];

/**
 * Get the best matching icon for a folder name
 */
export function getFolderIcon(folderName: string, description?: string, context?: {
  senderEmails?: string[];
  emailSubjects?: string[];
  emailCount?: number;
}): string {
  const searchText = `${folderName} ${description || ''}`.toLowerCase();
  
  let bestMatch: { icon: string; score: number } = { icon: '📁', score: 0 };
  
  // Check keyword mappings
  for (const mapping of ICON_MAPPINGS) {
    for (const keyword of mapping.keywords) {
      if (searchText.includes(keyword)) {
        const score = mapping.priority + (keyword.length / 10); // Longer keywords get slight bonus
        if (score > bestMatch.score) {
          bestMatch = { icon: mapping.icon, score };
        }
      }
    }
  }
  
  // Check sender pattern mappings if context is provided
  if (context?.senderEmails) {
    for (const senderEmail of context.senderEmails) {
      for (const patternMapping of SENDER_PATTERN_MAPPINGS) {
        if (patternMapping.pattern.test(senderEmail)) {
          const score = patternMapping.priority;
          if (score > bestMatch.score) {
            bestMatch = { icon: patternMapping.icon, score };
          }
        }
      }
    }
  }
  
  // Check email subjects for additional context
  if (context?.emailSubjects) {
    const subjectText = context.emailSubjects.join(' ').toLowerCase();
    for (const mapping of ICON_MAPPINGS) {
      for (const keyword of mapping.keywords) {
        if (subjectText.includes(keyword)) {
          const score = mapping.priority * 0.7; // Subject matches get lower priority than folder name matches
          if (score > bestMatch.score) {
            bestMatch = { icon: mapping.icon, score };
          }
        }
      }
    }
  }
  
  return bestMatch.icon;
}

/**
 * Get folder icon with fallback logic for edge cases
 */
export function getFolderIconWithFallback(folderName: string, description?: string): string {
  const icon = getFolderIcon(folderName, description);
  
  // If we still have the default folder icon, try some additional logic
  if (icon === '📁') {
    const name = folderName.toLowerCase();
    
    // Check for common abbreviations
    if (name.includes('hr')) return '👥';
    if (name.includes('pr') && name.includes('marketing')) return '📧';
    if (name.includes('r&d') || name.includes('research')) return '🔬';
    if (name.includes('qa') || name.includes('quality')) return '✅';
    if (name.includes('ops') || name.includes('operations')) return '⚙️';
    if (name.includes('vip') || name.includes('important')) return '⭐';
    
    // Check for numeric or date patterns (might be archives)
    if (/\d{4}/.test(name) || name.includes('archive') || name.includes('old')) return '📦';
    
    // Check for action words
    if (name.includes('draft') || name.includes('temp')) return '📝';
    if (name.includes('spam') || name.includes('junk')) return '🗑️';
    if (name.includes('sent') || name.includes('outbox')) return '📤';
  }
  
  return icon;
}

/**
 * Bulk process folders to get icons efficiently
 */
export function getBulkFolderIcons(folders: Array<{
  name: string;
  description?: string;
  context?: {
    senderEmails?: string[];
    emailSubjects?: string[];
    emailCount?: number;
  };
}>): Array<{ name: string; icon: string }> {
  return folders.map(folder => ({
    name: folder.name,
    icon: getFolderIconWithFallback(folder.name, folder.description)
  }));
}

/**
 * Get icon suggestions for new folder names (useful for folder creation UI)
 */
export function getFolderIconSuggestions(folderName: string, limit = 3): string[] {
  const searchText = folderName.toLowerCase();
  const matches: Array<{ icon: string; score: number }> = [];
  
  for (const mapping of ICON_MAPPINGS) {
    for (const keyword of mapping.keywords) {
      if (searchText.includes(keyword)) {
        const score = mapping.priority + (keyword.length / 10);
        const existingMatch = matches.find(m => m.icon === mapping.icon);
        if (existingMatch) {
          existingMatch.score = Math.max(existingMatch.score, score);
        } else {
          matches.push({ icon: mapping.icon, score });
        }
      }
    }
  }
  
  return matches
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(m => m.icon);
}

// Export default icon for edge cases
export const DEFAULT_FOLDER_ICON = '📁';

// Export icon mappings for reference
export { ICON_MAPPINGS, SENDER_PATTERN_MAPPINGS };