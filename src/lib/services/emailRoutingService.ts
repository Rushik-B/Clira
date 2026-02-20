import { prisma } from '@/lib/prisma';

export interface EmailRoutingRule {
  id: string;
  userId: string;
  labelId: string;
  mappingType: 'EMAIL' | 'DOMAIN' | 'SUBJECT' | 'SUBJECT_CONTAINS' | 'SUBJECT_STARTS_WITH' | 'SUBJECT_ENDS_WITH' | 'SUBJECT_REGEX';
  emailAddress?: string | null;
  domain?: string | null;
  subjectPattern?: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmailData {
  from: string;
  subject: string;
  to: string[];
  cc: string[];
}

export interface RoutingResult {
  labelId: string;
  ruleId: string;
  ruleType: string;
  matchedValue: string;
}

export class EmailRoutingService {
  /**
   * Get all active routing rules for a user, ordered by priority
   */
  async getUserRules(userId: string): Promise<EmailRoutingRule[]> {
    const rules = await prisma.emailMapping.findMany({
      where: {
        userId,
        isActive: true
      },
      orderBy: [
        { createdAt: 'asc' }
      ]
    });
    
    // Map Prisma result to our interface
    return rules.map(rule => ({
      id: rule.id,
      userId: rule.userId,
      labelId: rule.labelId,
      mappingType: rule.mappingType,
      emailAddress: rule.emailAddress,
      domain: rule.domain,
      subjectPattern: rule.subjectPattern,
      isActive: rule.isActive,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt
    }));
  }

  /**
   * Route an email through all applicable rules
   */
  async routeEmail(userId: string, emailData: EmailData): Promise<RoutingResult | null> {
    const rules = await this.getUserRules(userId);
    
    // Sort rules by creation date (oldest first)
    const sortedRules = rules.sort((a, b) => {
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    // Check each rule in priority order
    for (const rule of sortedRules) {
      const match = this.evaluateRule(rule, emailData);
      if (match) {
        return {
          labelId: rule.labelId,
          ruleId: rule.id,
          ruleType: rule.mappingType,
          matchedValue: match
        };
      }
    }

    return null;
  }

  /**
   * Evaluate if a single rule matches the email
   */
  private evaluateRule(rule: EmailRoutingRule, emailData: EmailData): string | null {
    switch (rule.mappingType) {
      case 'EMAIL':
        return this.evaluateEmailRule(rule, emailData);
      case 'DOMAIN':
        return this.evaluateDomainRule(rule, emailData);
      case 'SUBJECT':
        return this.evaluateSubjectRule(rule, emailData);
      case 'SUBJECT_CONTAINS':
        return this.evaluateSubjectContainsRule(rule, emailData);
      case 'SUBJECT_STARTS_WITH':
        return this.evaluateSubjectStartsWithRule(rule, emailData);
      case 'SUBJECT_ENDS_WITH':
        return this.evaluateSubjectEndsWithRule(rule, emailData);
      case 'SUBJECT_REGEX':
        return this.evaluateSubjectRegexRule(rule, emailData);
      default:
        return null;
    }
  }

  private evaluateEmailRule(rule: EmailRoutingRule, emailData: EmailData): string | null {
    if (!rule.emailAddress) return null;
    
    // Check if sender email exactly matches
    if (emailData.from.toLowerCase() === rule.emailAddress.toLowerCase()) {
      return rule.emailAddress;
    }
    
    return null;
  }

  private evaluateDomainRule(rule: EmailRoutingRule, emailData: EmailData): string | null {
    if (!rule.domain) return null;
    
    const senderDomain = this.extractDomain(emailData.from);
    const ruleDomain = rule.domain.startsWith('@') ? rule.domain : `@${rule.domain}`;
    
    // Check if sender domain matches (including subdomains)
    if (senderDomain.toLowerCase() === ruleDomain.toLowerCase() || 
        senderDomain.toLowerCase().endsWith(ruleDomain.toLowerCase().substring(1))) {
      return rule.domain;
    }
    
    return null;
  }

  private evaluateSubjectRule(rule: EmailRoutingRule, emailData: EmailData): string | null {
    if (!rule.subjectPattern) return null;
    
    // Check if subject exactly matches (case-insensitive)
    if (emailData.subject.toLowerCase() === rule.subjectPattern.toLowerCase()) {
      return rule.subjectPattern;
    }
    
    return null;
  }

  private evaluateSubjectContainsRule(rule: EmailRoutingRule, emailData: EmailData): string | null {
    if (!rule.subjectPattern) return null;
    
    // Check if subject contains the pattern (case-insensitive)
    if (emailData.subject.toLowerCase().includes(rule.subjectPattern.toLowerCase())) {
      return rule.subjectPattern;
    }
    
    return null;
  }

  private evaluateSubjectStartsWithRule(rule: EmailRoutingRule, emailData: EmailData): string | null {
    if (!rule.subjectPattern) return null;
    
    // Check if subject starts with the pattern (case-insensitive)
    if (emailData.subject.toLowerCase().startsWith(rule.subjectPattern.toLowerCase())) {
      return rule.subjectPattern;
    }
    
    return null;
  }

  private evaluateSubjectEndsWithRule(rule: EmailRoutingRule, emailData: EmailData): string | null {
    if (!rule.subjectPattern) return null;
    
    // Check if subject ends with the pattern (case-insensitive)
    if (emailData.subject.toLowerCase().endsWith(rule.subjectPattern.toLowerCase())) {
      return rule.subjectPattern;
    }
    
    return null;
  }

  private evaluateSubjectRegexRule(rule: EmailRoutingRule, emailData: EmailData): string | null {
    if (!rule.subjectPattern) return null;
    
    try {
      const regex = new RegExp(rule.subjectPattern, 'i'); // case-insensitive
      if (regex.test(emailData.subject)) {
        return rule.subjectPattern;
      }
    } catch (error) {
      console.error(`Invalid regex pattern in rule ${rule.id}:`, rule.subjectPattern);
    }
    
    return null;
  }

  /**
   * Extract domain from email address
   */
  private extractDomain(email: string): string {
    const atIndex = email.indexOf('@');
    if (atIndex === -1) return '';
    return email.substring(atIndex);
  }

  /**
   * Get rule statistics for a user
   */
  async getRuleStats(userId: string): Promise<{
    totalRules: number;
    rulesByType: Record<string, number>;
  }> {
    const rules = await this.getUserRules(userId);
    
    const rulesByType: Record<string, number> = {};
    
    rules.forEach(rule => {
      rulesByType[rule.mappingType] = (rulesByType[rule.mappingType] || 0) + 1;
    });
    
    return {
      totalRules: rules.length,
      rulesByType
    };
  }

  /**
   * Validate rule configuration
   */
  validateRule(rule: Partial<EmailRoutingRule>): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!rule.mappingType) {
      errors.push('Rule type is required');
    }
    

    
    // Validate value based on type
    if (rule.mappingType) {
      switch (rule.mappingType) {
        case 'EMAIL':
          if (!rule.emailAddress || !this.isValidEmail(rule.emailAddress)) {
            errors.push('Valid email address is required for EMAIL rules');
          }
          break;
        case 'DOMAIN':
          if (!rule.domain || !this.isValidDomain(rule.domain)) {
            errors.push('Valid domain is required for DOMAIN rules');
          }
          break;
        case 'SUBJECT':
        case 'SUBJECT_CONTAINS':
        case 'SUBJECT_STARTS_WITH':
        case 'SUBJECT_ENDS_WITH':
          if (!rule.subjectPattern || rule.subjectPattern.length < 2) {
            errors.push('Subject pattern must be at least 2 characters long');
          }
          break;
        case 'SUBJECT_REGEX':
          if (!rule.subjectPattern) {
            errors.push('Subject pattern is required for regex rules');
          } else {
            try {
              new RegExp(rule.subjectPattern);
            } catch {
              errors.push('Invalid regular expression pattern');
            }
          }
          break;
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private isValidDomain(domain: string): boolean {
    const domainRegex = /^@?[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.[a-zA-Z.]{2,}$/;
    return domainRegex.test(domain.startsWith('@') ? domain : `@${domain}`);
  }
}
