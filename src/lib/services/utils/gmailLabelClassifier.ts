/**
 * Gmail Label Classification Service
 * 
 * Rock-solid system to distinguish between:
 * - System labels (INBOX, SENT, etc.)
 * - Category labels (CATEGORY_PROMOTIONS, etc.) 
 * - User-created custom labels (anything else)
 * 
 * CRITICAL: If we can't determine label type, we assume it's custom (fail-safe)
 */

export interface LabelClassification {
  isSystemLabel: boolean;
  isCategoryLabel: boolean;
  isCustomLabel: boolean;
  labelType: 'system' | 'category' | 'custom' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
}

export class GmailLabelClassifier {
  
  // Comprehensive list of Gmail system labels (case-insensitive)
  private static readonly SYSTEM_LABELS = new Set([
    // Core system labels
    'INBOX', 'SENT', 'DRAFT', 'TRASH', 'SPAM', 'STARRED', 'IMPORTANT', 'UNREAD',
    
    // Additional system labels
    'CHAT', 'CHATS', 'SNOOZED', 'SCHEDULED', 'OUTBOX',
    
    // System flags and states
    'OPENED', 'CLICKED', 'REPLIED', 'FORWARDED',
    
    // Archive and organization
    'ARCHIVE', 'ARCHIVED', 'DELETED',
    
    // Special Gmail labels
    'ALL', 'ALLMAIL', 'ANYWHERE',
    
    // Mobile and device specific
    'MOBILE', 'DESKTOP', 'WEB',
    
    // Security and priority
    'SECURITY', 'PHISHING', 'MALWARE', 'VIRUS',
    
    // System generated
    'AUTO', 'AUTOMATIC', 'SYSTEM'
  ]);

  // Gmail category label patterns (always start with CATEGORY_)
  private static readonly CATEGORY_PATTERNS = [
    'CATEGORY_PROMOTIONS',
    'CATEGORY_SOCIAL', 
    'CATEGORY_UPDATES',
    'CATEGORY_FORUMS',
    'CATEGORY_PERSONAL',
    'CATEGORY_PRIMARY'
  ];

  // System label ID patterns (Gmail internal IDs)
  private static readonly SYSTEM_ID_PATTERNS = [
    /^INBOX$/i,
    /^SENT$/i,
    /^DRAFT$/i,
    /^TRASH$/i,
    /^SPAM$/i,
    /^STARRED$/i,
    /^IMPORTANT$/i,
    /^UNREAD$/i,
    /^CATEGORY_/i,
    /^[A-Z_]+$/i    // All-caps system labels (no digits)
  ];

  /**
   * Classify a single Gmail label with high reliability
   * FAIL-SAFE: Unknown labels are treated as custom to avoid accidental modification
   */
  static classifyLabel(labelId: string | null | undefined): LabelClassification {
    // SAFETY: Handle null/undefined/empty inputs
    if (!labelId || typeof labelId !== 'string' || labelId.trim() === '') {
      console.warn('[LABEL CLASSIFIER] Empty or invalid label ID provided');
      return {
        isSystemLabel: false,
        isCategoryLabel: false, 
        isCustomLabel: false, // Don't assume custom for invalid input
        labelType: 'unknown',
        confidence: 'low'
      };
    }

    const normalizedLabel = labelId.trim().toUpperCase();
    
    // CHECK 1: Exact system label match (highest confidence)
    if (this.SYSTEM_LABELS.has(normalizedLabel)) {
      return {
        isSystemLabel: true,
        isCategoryLabel: false,
        isCustomLabel: false,
        labelType: 'system',
        confidence: 'high'
      };
    }

    // CHECK 2: Category label (starts with CATEGORY_)
    if (normalizedLabel.startsWith('CATEGORY_')) {
      const isKnownCategory = this.CATEGORY_PATTERNS.some(pattern => 
        normalizedLabel === pattern
      );
      
      return {
        isSystemLabel: false,
        isCategoryLabel: true,
        isCustomLabel: false,
        labelType: 'category',
        confidence: isKnownCategory ? 'high' : 'medium'
      };
    }

    // CHECK 3: System ID patterns (medium confidence)
    const matchesSystemPattern = this.SYSTEM_ID_PATTERNS.some(pattern => 
      pattern.test(normalizedLabel)
    );
    
    if (matchesSystemPattern) {
      return {
        isSystemLabel: true,
        isCategoryLabel: false,
        isCustomLabel: false,
        labelType: 'system',
        confidence: 'medium'
      };
    }

    // CHECK 4: Special Gmail-generated patterns (exclude user label IDs like Label_123)
    if (this.isGmailGeneratedLabel(normalizedLabel)) {
      return {
        isSystemLabel: true,
        isCategoryLabel: false,
        isCustomLabel: false,
        labelType: 'system',
        confidence: 'medium'
      };
    }

    // DEFAULT: Treat as custom label (FAIL-SAFE approach)
    // Better to skip a system label than modify a custom one
    return {
      isSystemLabel: false,
      isCategoryLabel: false,
      isCustomLabel: true,
      labelType: 'custom',
      confidence: 'high'
    };
  }

  /**
   * Check if an email has any custom labels that should prevent processing
   * CRITICAL: This is the main function used by the email processing pipeline
   */
  static hasCustomLabels(labelIds: string[] | null | undefined): {
    hasCustom: boolean;
    customLabels: string[];
    systemLabels: string[];
    categoryLabels: string[];
    analysis: LabelClassification[];
  } {
    // SAFETY: Handle invalid input
    if (!Array.isArray(labelIds) || labelIds.length === 0) {
      return {
        hasCustom: false,
        customLabels: [],
        systemLabels: [],
        categoryLabels: [],
        analysis: []
      };
    }

    const customLabels: string[] = [];
    const systemLabels: string[] = [];
    const categoryLabels: string[] = [];
    const analysis: LabelClassification[] = [];

    // Classify each label
    for (const labelId of labelIds) {
      const classification = this.classifyLabel(labelId);
      analysis.push(classification);

      if (classification.isCustomLabel) {
        customLabels.push(labelId);
      } else if (classification.isSystemLabel) {
        systemLabels.push(labelId);
      } else if (classification.isCategoryLabel) {
        categoryLabels.push(labelId);
      }
      // Unknown labels are not categorized but logged in analysis
    }

    return {
      hasCustom: customLabels.length > 0,
      customLabels,
      systemLabels,
      categoryLabels,
      analysis
    };
  }

  /**
   * Detailed analysis for debugging and logging
   */
  static analyzeEmailLabels(emailId: string, labelIds: string[] | null | undefined): {
    emailId: string;
    shouldSkip: boolean;
    reason: string;
    labelAnalysis: ReturnType<typeof GmailLabelClassifier.hasCustomLabels>;
    recommendations: string[];
  } {
    const labelAnalysis = this.hasCustomLabels(labelIds);
    
    let shouldSkip = false;
    let reason = '';
    const recommendations: string[] = [];

    if (labelAnalysis.hasCustom) {
      shouldSkip = true;
      reason = `Email has ${labelAnalysis.customLabels.length} custom label(s): ${labelAnalysis.customLabels.join(', ')}`;
      recommendations.push('Skip this email to preserve user organization');
    } else if (labelAnalysis.systemLabels.length === 0 && labelAnalysis.categoryLabels.length === 0) {
      reason = 'Email has no labels - safe to process';
      recommendations.push('Can be processed normally');
    } else {
      reason = `Email has only system/category labels: ${[...labelAnalysis.systemLabels, ...labelAnalysis.categoryLabels].join(', ')}`;
      recommendations.push('Safe to process - no custom organization detected');
    }

    return {
      emailId,
      shouldSkip,
      reason,
      labelAnalysis,
      recommendations
    };
  }

  /**
   * Detect Gmail-generated labels (not user-created)
   */
  private static isGmailGeneratedLabel(normalizedLabel: string): boolean {
    // Gmail auto-generated label patterns
    // IMPORTANT: Do NOT include /^LABEL_\d+$/ — those are USER labels in Gmail API (custom)
    const gmailPatterns = [
      /^AUTO_/,                // Auto-generated labels  
      /^SYSTEM_/,              // System labels
      /^GMAIL_/,               // Gmail internal labels
      /^[A-Z]+_[A-Z]+_\d+$/,  // Pattern like USER_LABEL_123
      /^\d+$/                  // Pure numeric labels (system IDs)
    ];

    return gmailPatterns.some(pattern => pattern.test(normalizedLabel));
  }

  /**
   * Configuration for different strictness levels
   */
  static getStrictnessConfig(level: 'strict' | 'moderate' | 'permissive' = 'strict') {
    switch (level) {
      case 'strict':
        // Skip anything that might be custom (safest)
        return {
          skipUnknownLabels: true,
          skipLowConfidenceClassification: true,
          requireHighConfidenceSystemLabels: true
        };
      case 'moderate': 
        // Balance between safety and processing
        return {
          skipUnknownLabels: true,
          skipLowConfidenceClassification: false,
          requireHighConfidenceSystemLabels: false
        };
      case 'permissive':
        // Process more emails, higher risk
        return {
          skipUnknownLabels: false,
          skipLowConfidenceClassification: false,
          requireHighConfidenceSystemLabels: false
        };
    }
  }

  /**
   * CRITICAL SAFETY CHECK: Verify an email is safe to process before any operation
   * Use this before START SORTING, batch operations, or any email modification
   */
  static isSafeToProcess(
    emailId: string,
    labelIds: string[] | null | undefined,
    operation: 'sorting' | 'labeling' | 'moving' | 'batch_operation' = 'sorting'
  ): {
    isSafe: boolean;
    reason: string;
    recommendation: string;
    analysis: ReturnType<typeof GmailLabelClassifier.analyzeEmailLabels>;
  } {
    const analysis = this.analyzeEmailLabels(emailId, labelIds);
    
    if (analysis.shouldSkip) {
      return {
        isSafe: false,
        reason: `BLOCKED: ${analysis.reason}`,
        recommendation: `Skip ${operation} to preserve user organization`,
        analysis
      };
    }

    return {
      isSafe: true,
      reason: `SAFE: ${analysis.reason}`,
      recommendation: `Proceed with ${operation}`,
      analysis
    };
  }

  /**
   * BATCH SAFETY CHECK: Verify multiple emails at once
   * Returns only emails that are safe to process
   */
  static filterSafeEmails<T extends { messageId?: string; labelIds?: string[] }>(
    emails: T[],
    operation: 'sorting' | 'labeling' | 'moving' | 'batch_operation' = 'sorting'
  ): {
    safeEmails: T[];
    blockedEmails: Array<T & { blockReason: string }>;
    summary: {
      total: number;
      safe: number;
      blocked: number;
      safetyRate: number;
    };
  } {
    const safeEmails: T[] = [];
    const blockedEmails: Array<T & { blockReason: string }> = [];

    for (const email of emails) {
      const emailId = email.messageId || `unknown-${Date.now()}`;
      const safety = this.isSafeToProcess(emailId, email.labelIds, operation);
      
      if (safety.isSafe) {
        safeEmails.push(email);
      } else {
        blockedEmails.push({
          ...email,
          blockReason: safety.reason
        });
      }
    }

    const total = emails.length;
    const safe = safeEmails.length;
    const blocked = blockedEmails.length;
    
    return {
      safeEmails,
      blockedEmails,
      summary: {
        total,
        safe,
        blocked,
        safetyRate: total > 0 ? Math.round((safe / total) * 100) : 100
      }
    };
  }

  /**
   * EMERGENCY STOP: Check if any emails in a batch have custom labels
   * Use this as a final safety check before bulk operations
   */
  static emergencyCheck(
    emails: Array<{ messageId?: string; labelIds?: string[] }>,
    operationDescription: string
  ): {
    shouldProceed: boolean;
    blockingEmails: string[];
    safetyReport: string;
  } {
    const result = this.filterSafeEmails(emails, 'batch_operation');
    
    const shouldProceed = result.blockedEmails.length === 0;
    const blockingEmails = result.blockedEmails.map(email => email.messageId || 'unknown');
    
    const safetyReport = shouldProceed 
      ? `✅ SAFE: All ${result.summary.total} emails cleared for ${operationDescription}`
      : `🛑 BLOCKED: ${result.summary.blocked} emails have custom labels. Operation '${operationDescription}' cancelled to preserve user organization.`;

    return {
      shouldProceed,
      blockingEmails,
      safetyReport
    };
  }
}