import { FastOnboardingProposal, GeneratedFolders, ExistingLabelSummary } from '../types';

export type FallbackEmailSample = {
  from: string;
  subject: string;
  gmailCategories: Array<'PROMOTIONS' | 'SOCIAL' | 'UPDATES' | 'FORUMS' | 'PERSONAL'>;
};

const PROMOTION_KEYWORDS = ['newsletter', 'unsubscribe', 'promotion'];
const SOCIAL_KEYWORDS = ['linkedin', 'facebook', 'twitter', 'instagram', 'slack'];
const UPDATE_KEYWORDS = ['notification', 'update', 'alert'];

function toLower(value: string) {
  return value.toLowerCase();
}

function includesKeyword(source: string, keywords: string[]) {
  const lowered = toLower(source);
  return keywords.some(keyword => lowered.includes(keyword));
}

export function createFallbackFolderSuggestions(
  emails: FallbackEmailSample[] = []
): GeneratedFolders {
  const promotionalEmails = emails.filter(email =>
    email.gmailCategories.includes('PROMOTIONS') ||
    includesKeyword(email.subject, PROMOTION_KEYWORDS)
  );

  const socialEmails = emails.filter(email =>
    email.gmailCategories.includes('SOCIAL') || includesKeyword(email.from, SOCIAL_KEYWORDS)
  );

  const updateEmails = emails.filter(email =>
    email.gmailCategories.includes('UPDATES') || includesKeyword(email.subject, UPDATE_KEYWORDS)
  );

  const combinedNotificationSenders = [...socialEmails, ...updateEmails]
    .slice(0, 3)
    .map(email => email.from);

  const suggestions: GeneratedFolders['suggestedFolders'] = [
    {
      name: 'Newsletters',
      description: 'Marketing emails, newsletters, and promotional content',
      metaPrompt: 'Newsletter subscriptions, marketing emails, and promotional content',
      color: '#F59E0B',
      colorName: 'orange',
      importance: 'low',
      icon: '📰',
      confidence: 80,
      reasoning: 'Fallback newsletter folder derived from promotional traffic patterns.',
      exampleSenders: promotionalEmails.slice(0, 3).map(email => email.from),
      keywordPatterns: PROMOTION_KEYWORDS,
    },
    {
      name: 'Notifications',
      description: 'Social media notifications and account updates',
      metaPrompt: 'Social media notifications, account alerts, and system updates',
      color: '#3B82F6',
      colorName: 'blue',
      importance: 'medium',
      icon: '🔔',
      confidence: 75,
      reasoning: 'Fallback notifications folder based on alert-like messages.',
      exampleSenders: combinedNotificationSenders,
      keywordPatterns: UPDATE_KEYWORDS,
      guidance: 'Great for batching alerts from tools, social networks, and SaaS apps.',
    },
    {
      name: 'Action Needed',
      description: 'Emails requiring your attention and response',
      metaPrompt: 'Emails that require action, responses, or decisions',
      color: '#EF4444',
      colorName: 'red',
      importance: 'high',
      icon: '⚡',
      confidence: 70,
      reasoning: 'Fallback action folder for important or urgent threads.',
      exampleSenders: [],
      keywordPatterns: ['urgent', 'action', 'required'],
      guidance: 'Use for quick triage and reply-worthy conversations.',
    },
    {
      name: 'Review',
      description: "Emails that need manual review and sorting",
      metaPrompt:
        "Emails that don't clearly fit into other categories and require manual review",
      color: '#6B7280',
      colorName: 'gray',
      importance: 'low',
      icon: '📋',
      confidence: 100,
      reasoning: 'Safety net folder to catch uncategorised messages.',
      exampleSenders: [],
      keywordPatterns: [],
      guidance: 'Check this daily to fine-tune your system.',
    },
  ];

  return {
    suggestedFolders: suggestions,
    overallAnalysis: {
      totalEmailsAnalyzed: emails.length,
      primaryEmailTypes: ['promotional', 'social', 'updates'],
      recommendedApproach:
        emails.length === 0
          ? 'Starter set applied because inbox sample was unavailable.'
          : 'Starter set blended with detected traffic for coverage.',
    },
    reasoning: 'Intelligent fallback suggestions seeded for fast onboarding.',
  };
}

export function buildFallbackFastOnboardingProposal(
  existingLabels: ExistingLabelSummary
): FastOnboardingProposal {
  const fallback = createFallbackFolderSuggestions();
  return {
    suggestions: fallback.suggestedFolders.map((folder, index) => ({
      ...folder,
      id: `${folder.name}-${index}`,
    })),
    existingLabels,
    filteringStats: {
      totalFetched: 0,
      skippedForCustomLabels: 0,
      processable: 0,
    },
    totalAnalyzed: 0,
    fallbackUsed: true,
  };
}
