// Email Mapping Service - Manages email-to-folder mappings with worker integration
// Updated for multi-inbox support: mappings are now scoped to mailboxId
import { prisma } from '../../prisma';
import { emailMappingQueue } from '../utils/queues';
import { getJobStatus } from './utils/queueStatus';
import {
  EmailMapping,
  CreateEmailMappingInput,
  UpdateEmailMappingInput,
  EmailMappingSearchResult,
  GeneratedMappings,
  JobStatus
} from './types';

/**
 * Email Mapping Service - Manages email-to-folder mappings with worker integration
 * 
 * Features:
 * - Create, read, update, delete email mappings
 * - Support for both email address and domain-level mappings
 * - Fast lookup for routing decisions
 * - Bulk operations for onboarding
 * - Worker-based LLM processing for mapping suggestions
 */
export class EmailMappingService {
  
  constructor() {
    // Service is ready for both CRUD operations and worker integration
  }

  /**
   * Queue email mapping job for worker processing
   */
  async queueMappingJob(
    userId: string,
    availableFolders: any[],
    emailAddresses: any[],
    emailPatternContext?: any
  ): Promise<{ jobId: string }> {
    console.log(`[EMAIL MAPPING] Queueing mapping job for user ${userId}`);
    
    try {
      const job = await emailMappingQueue.add('email-mapping', {
        userId,
        availableFolders,
        emailAddresses,
        emailPatternContext
      }, {
        priority: 2, // Medium priority
        delay: 0,
        attempts: 3
      });

      console.log(`[EMAIL MAPPING] ✅ Queued mapping job ${job.id} for user ${userId}`);
      return { jobId: job.id! };

    } catch (error) {
      console.error(`[EMAIL MAPPING] Error queueing mapping job:`, error);
      throw error;
    }
  }

  /**
   * Check mapping job status
   */
  async getMappingJobStatus(jobId: string): Promise<JobStatus> {
    return getJobStatus(emailMappingQueue, jobId);
  }

  /**
   * Create a new email mapping
   *
   * IMPORTANT: mailboxId should be provided to scope the mapping correctly.
   * When mailboxId is omitted (legacy), the mapping is user-global.
   */
  async createMapping(input: CreateEmailMappingInput): Promise<EmailMapping> {
    console.log(`[EMAIL MAPPING] Creating mapping for ${input.emailAddress} → label ${input.labelId}${input.mailboxId ? ` (mailbox: ${input.mailboxId})` : ' (user-global)'}`);

    try {
      // Validate that the label exists and belongs to the user
      const label = await prisma.label.findFirst({
        where: {
          id: input.labelId,
          userId: input.userId
        },
        include: {
          mailbox: {
            select: {
              id: true,
              emailAddress: true
            }
          }
        }
      });

      if (!label) {
        throw new Error(`Label ${input.labelId} not found for user ${input.userId}`);
      }

      // If mailboxId provided, validate ownership
      if (input.mailboxId) {
        const mailbox = await prisma.mailbox.findFirst({
          where: {
            id: input.mailboxId,
            userId: input.userId
          }
        });
        if (!mailbox) {
          throw new Error(`Mailbox ${input.mailboxId} not found for user ${input.userId}`);
        }
      }

      // Extract domain if it's an email address mapping
      const domain = input.mappingType === 'DOMAIN'
        ? input.domain
        : input.emailAddress.includes('@')
          ? '@' + input.emailAddress.split('@')[1]
          : null;

      // Create the mapping
      const mapping = await prisma.emailMapping.create({
        data: {
          userId: input.userId,
          mailboxId: input.mailboxId,
          labelId: input.labelId,
          emailAddress: input.emailAddress,
          domain,
          mappingType: input.mappingType || 'EMAIL',
          confidence: input.confidence
        },
        include: {
          label: {
            select: {
              name: true,
              color: true
            }
          },
          mailbox: {
            select: {
              emailAddress: true
            }
          }
        }
      });

      console.log(`[EMAIL MAPPING] Created mapping ${mapping.id}: ${input.emailAddress} → ${label.name}`);

      return {
        id: mapping.id,
        userId: mapping.userId,
        mailboxId: mapping.mailboxId || undefined,
        mailboxEmail: mapping.mailbox?.emailAddress,
        labelId: mapping.labelId,
        labelName: mapping.label.name,
        labelColor: mapping.label.color || undefined,
        emailAddress: mapping.emailAddress,
        domain: mapping.domain || undefined,
        isActive: mapping.isActive,
        mappingType: mapping.mappingType,
        confidence: mapping.confidence || undefined,
        createdAt: mapping.createdAt,
        updatedAt: mapping.updatedAt
      };

    } catch (error) {
      console.error(`[EMAIL MAPPING] Error creating mapping:`, error);
      throw error;
    }
  }

  /**
   * Find email mapping for routing decisions (fast lookup)
   *
   * IMPORTANT: mailboxId is required for correct multi-inbox routing.
   * When mailboxId is provided, mappings are scoped to that mailbox.
   * When mailboxId is omitted (legacy), falls back to user-global lookup with warning.
   */
  async findMappingForEmail(
    userId: string,
    emailAddress: string,
    mailboxId?: string
  ): Promise<EmailMappingSearchResult> {
    try {
      if (!mailboxId) {
        console.warn(`[EMAIL MAPPING] findMappingForEmail called without mailboxId for ${emailAddress} - using user-global lookup (deprecated)`);
      }

      const findFirstMapping = async (
        where: {
          userId: string;
          mailboxId?: string | null;
          emailAddress?: { equals: string; mode: 'insensitive' };
          domain?: { equals: string; mode: 'insensitive' };
          isActive: boolean;
          mappingType: 'EMAIL' | 'DOMAIN';
        }
      ) => prisma.emailMapping.findFirst({
        where,
        include: {
          label: {
            select: {
              name: true,
              color: true,
              mailboxId: true
            }
          },
          mailbox: {
            select: {
              emailAddress: true
            }
          }
        }
      });

      const toSearchResult = (
        mapping: NonNullable<Awaited<ReturnType<typeof findFirstMapping>>>,
        matchType: 'exact' | 'domain'
      ): EmailMappingSearchResult => ({
        mapping: {
          id: mapping.id,
          userId: mapping.userId,
          mailboxId: mapping.mailboxId || undefined,
          mailboxEmail: mapping.mailbox?.emailAddress,
          labelId: mapping.labelId,
          labelName: mapping.label.name,
          labelColor: mapping.label.color || undefined,
          emailAddress: mapping.emailAddress,
          domain: mapping.domain || undefined,
          isActive: mapping.isActive,
          mappingType: mapping.mappingType,
          confidence: mapping.confidence || undefined,
          createdAt: mapping.createdAt,
          updatedAt: mapping.updatedAt
        },
        matchType
      });

      const exactWhere = {
        userId,
        emailAddress: { equals: emailAddress, mode: 'insensitive' as const },
        isActive: true,
        mappingType: 'EMAIL' as const
      };

      // Prefer mailbox-scoped mappings, then fall back to legacy user-global mappings.
      const exactLookupScopes = mailboxId ? [mailboxId, null] : [undefined];
      for (const scopeMailboxId of exactLookupScopes) {
        const exactMapping = await findFirstMapping({
          ...exactWhere,
          ...(scopeMailboxId === undefined ? {} : { mailboxId: scopeMailboxId })
        });

        if (exactMapping) {
          return toSearchResult(exactMapping, 'exact');
        }
      }

      if (emailAddress.includes('@')) {
        const domain = '@' + emailAddress.split('@')[1];

        const domainWhere = {
          userId,
          domain: { equals: domain, mode: 'insensitive' as const },
          isActive: true,
          mappingType: 'DOMAIN' as const
        };
        const domainLookupScopes = mailboxId ? [mailboxId, null] : [undefined];

        for (const scopeMailboxId of domainLookupScopes) {
          const domainMapping = await findFirstMapping({
            ...domainWhere,
            ...(scopeMailboxId === undefined ? {} : { mailboxId: scopeMailboxId })
          });

          if (domainMapping) {
            return toSearchResult(domainMapping, 'domain');
          }
        }
      }

      // No mapping found
      return {
        mapping: null,
        matchType: 'none'
      };

    } catch (error) {
      console.error(`[EMAIL MAPPING] Error finding mapping for ${emailAddress}:`, error);
      return {
        mapping: null,
        matchType: 'none'
      };
    }
  }

  /**
   * Get all mappings for a user (optionally filtered by mailbox)
   *
   * @param userId - The user ID
   * @param mailboxId - Optional mailbox ID to filter by; omit for all mailboxes (unified view)
   */
  async getUserMappings(userId: string, mailboxId?: string): Promise<EmailMapping[]> {
    try {
      const mappings = await prisma.emailMapping.findMany({
        where: {
          userId,
          ...(mailboxId ? { mailboxId } : {})
        },
        include: {
          label: {
            select: {
              name: true,
              color: true
            }
          },
          mailbox: {
            select: {
              emailAddress: true
            }
          }
        },
        orderBy: [
          { isActive: 'desc' },
          { createdAt: 'desc' }
        ]
      });

      return mappings.map(mapping => ({
        id: mapping.id,
        userId: mapping.userId,
        mailboxId: mapping.mailboxId || undefined,
        mailboxEmail: mapping.mailbox?.emailAddress,
        labelId: mapping.labelId,
        labelName: mapping.label.name,
        labelColor: mapping.label.color || undefined,
        emailAddress: mapping.emailAddress,
        domain: mapping.domain || undefined,
        isActive: mapping.isActive,
        mappingType: mapping.mappingType,
        confidence: mapping.confidence || undefined,
        createdAt: mapping.createdAt,
        updatedAt: mapping.updatedAt
      }));

    } catch (error) {
      console.error(`[EMAIL MAPPING] Error getting user mappings:`, error);
      throw error;
    }
  }

  /**
   * Get mappings for a specific label
   */
  async getLabelMappings(userId: string, labelId: string): Promise<EmailMapping[]> {
    try {
      const mappings = await prisma.emailMapping.findMany({
        where: {
          userId,
          labelId
        },
        include: {
          label: {
            select: {
              name: true,
              color: true
            }
          }
        },
        orderBy: [
          { isActive: 'desc' },
          { emailAddress: 'asc' }
        ]
      });

      return mappings.map(mapping => ({
        id: mapping.id,
        userId: mapping.userId,
        labelId: mapping.labelId,
        labelName: mapping.label.name,
        labelColor: mapping.label.color || undefined,
        emailAddress: mapping.emailAddress,
        domain: mapping.domain || undefined,
        isActive: mapping.isActive,
        mappingType: mapping.mappingType,
        confidence: mapping.confidence || undefined,
        createdAt: mapping.createdAt,
        updatedAt: mapping.updatedAt
      }));

    } catch (error) {
      console.error(`[EMAIL MAPPING] Error getting label mappings:`, error);
      throw error;
    }
  }

  /**
   * Update an email mapping
   */
  async updateMapping(userId: string, mappingId: string, updates: UpdateEmailMappingInput): Promise<EmailMapping> {
    try {
      // Verify the mapping belongs to the user
      const existingMapping = await prisma.emailMapping.findFirst({
        where: {
          id: mappingId,
          userId
        }
      });

      if (!existingMapping) {
        throw new Error(`Mapping ${mappingId} not found for user ${userId}`);
      }

      // If updating labelId, verify the new label exists
      if (updates.labelId) {
        const label = await prisma.label.findFirst({
          where: {
            id: updates.labelId,
            userId
          }
        });

        if (!label) {
          throw new Error(`Label ${updates.labelId} not found for user ${userId}`);
        }
      }

      // Update the mapping
      const updatedMapping = await prisma.emailMapping.update({
        where: { id: mappingId },
        data: updates,
        include: {
          label: {
            select: {
              name: true,
              color: true
            }
          }
        }
      });

      console.log(`[EMAIL MAPPING] Updated mapping ${mappingId}`);

      return {
        id: updatedMapping.id,
        userId: updatedMapping.userId,
        labelId: updatedMapping.labelId,
        labelName: updatedMapping.label.name,
        labelColor: updatedMapping.label.color || undefined,
        emailAddress: updatedMapping.emailAddress,
        domain: updatedMapping.domain || undefined,
        isActive: updatedMapping.isActive,
        mappingType: updatedMapping.mappingType,
        confidence: updatedMapping.confidence || undefined,
        createdAt: updatedMapping.createdAt,
        updatedAt: updatedMapping.updatedAt
      };

    } catch (error) {
      console.error(`[EMAIL MAPPING] Error updating mapping:`, error);
      throw error;
    }
  }

  /**
   * Delete an email mapping
   */
  async deleteMapping(userId: string, mappingId: string): Promise<void> {
    try {
      // Verify the mapping belongs to the user
      const mapping = await prisma.emailMapping.findFirst({
        where: {
          id: mappingId,
          userId
        }
      });

      if (!mapping) {
        throw new Error(`Mapping ${mappingId} not found for user ${userId}`);
      }

      await prisma.emailMapping.delete({
        where: { id: mappingId }
      });

      console.log(`[EMAIL MAPPING] Deleted mapping ${mappingId}: ${mapping.emailAddress}`);

    } catch (error) {
      console.error(`[EMAIL MAPPING] Error deleting mapping:`, error);
      throw error;
    }
  }

  /**
   * Auto-create category-based mappings from Gmail categories
   */
  async createCategoryBasedMappings(
    userId: string, 
    extractedAddresses: Array<{
      emailAddress: string;
      dominantGmailCategory?: string;
      frequency: number;
    }>
  ): Promise<EmailMapping[]> {
    console.log(`[EMAIL MAPPING] Creating category-based mappings for user ${userId}`);

    try {
      const results: EmailMapping[] = [];

      // Get user's default labels
      const labels = await prisma.label.findMany({
        where: {
          userId,
          isSystemDefault: true
        },
        select: {
          id: true,
          name: true,
          color: true
        }
      });

      const labelMap = new Map(labels.map(l => [l.name, l]));

      // Create high-confidence mappings based on Gmail categories
      for (const addr of extractedAddresses) {
        if (!addr.dominantGmailCategory) continue;

        let targetLabelName: string | null = null;
        let confidence = 0.9; // High confidence for category-based mappings

        // Map Gmail categories to our folders
        switch (addr.dominantGmailCategory) {
          case 'PROMOTIONS':
            targetLabelName = 'Newsletters';
            confidence = 0.95; // Very high confidence
            break;
          case 'SOCIAL':
          case 'UPDATES':
            targetLabelName = 'Notifications';
            confidence = 0.9;
            break;
          case 'FORUMS':
            targetLabelName = 'Notifications';
            confidence = 0.8; // Slightly lower confidence
            break;
          case 'PERSONAL':
            // Don't auto-map PERSONAL - let LLM decide
            continue;
        }

        if (targetLabelName && labelMap.has(targetLabelName)) {
          const label = labelMap.get(targetLabelName)!;

          try {
            // Check for existing mapping (can't use upsert with old userId_emailAddress constraint)
            const existing = await prisma.emailMapping.findFirst({
              where: {
                userId,
                emailAddress: addr.emailAddress,
                mailboxId: null // Legacy mappings have no mailbox
              }
            });

            const created = existing
              ? await prisma.emailMapping.update({
                  where: { id: existing.id },
                  data: {
                    labelId: label.id,
                    isActive: true,
                    confidence: confidence
                  }
                })
              : await prisma.emailMapping.create({
                  data: {
                    userId,
                    labelId: label.id,
                    emailAddress: addr.emailAddress,
                    domain: '@' + addr.emailAddress.split('@')[1],
                    mappingType: 'EMAIL',
                    confidence: confidence
                  }
                });

            results.push({
              id: created.id,
              userId: created.userId,
              labelId: created.labelId,
              labelName: label.name,
              labelColor: label.color || undefined,
              emailAddress: created.emailAddress,
              domain: created.domain || undefined,
              isActive: created.isActive,
              mappingType: created.mappingType,
              confidence: created.confidence || undefined,
              createdAt: created.createdAt,
              updatedAt: created.updatedAt
            });

            console.log(`[EMAIL MAPPING] Auto-mapped ${addr.emailAddress} (${addr.dominantGmailCategory}) → ${targetLabelName} (${confidence})`);

          } catch (error) {
            console.warn(`[EMAIL MAPPING] Failed to create category mapping for ${addr.emailAddress}:`, error);
          }
        }
      }

      console.log(`[EMAIL MAPPING] Created ${results.length} category-based mappings`);
      return results;

    } catch (error) {
      console.error(`[EMAIL MAPPING] Error creating category-based mappings:`, error);
      throw error;
    }
  }

  /**
   * Bulk create mappings (for onboarding)
   */
  async createMappingsBulk(userId: string, mappings: CreateEmailMappingInput[]): Promise<EmailMapping[]> {
    console.log(`[EMAIL MAPPING] Creating ${mappings.length} mappings in bulk for user ${userId}`);

    try {
      const results: EmailMapping[] = [];

      // Validate all labels exist first
      const labelIds = Array.from(new Set(mappings.map(m => m.labelId)));
      const labels = await prisma.label.findMany({
        where: {
          id: { in: labelIds },
          userId
        },
        select: {
          id: true,
          name: true,
          color: true
        }
      });

      const labelMap = new Map(labels.map(l => [l.id, l]));

      // Process in batches to avoid overwhelming the database
      const batchSize = 50;
      for (let i = 0; i < mappings.length; i += batchSize) {
        const batch = mappings.slice(i, i + batchSize);
        
        for (const mapping of batch) {
          try {
            // Check that label exists
            const label = labelMap.get(mapping.labelId);
            if (!label) {
              console.warn(`[EMAIL MAPPING] Skipping mapping for unknown label ${mapping.labelId}`);
              continue;
            }

            // Extract domain
            const domain = mapping.mappingType === 'DOMAIN'
              ? mapping.domain
              : mapping.emailAddress.includes('@')
                ? '@' + mapping.emailAddress.split('@')[1]
                : null;

            // Check for existing mapping (can't use upsert with old userId_emailAddress constraint)
            const existing = await prisma.emailMapping.findFirst({
              where: {
                userId,
                emailAddress: mapping.emailAddress,
                mailboxId: null // Legacy mappings have no mailbox
              }
            });

            const created = existing
              ? await prisma.emailMapping.update({
                  where: { id: existing.id },
                  data: {
                    labelId: mapping.labelId,
                    isActive: true,
                    confidence: mapping.confidence
                  }
                })
              : await prisma.emailMapping.create({
                  data: {
                    userId,
                    labelId: mapping.labelId,
                    emailAddress: mapping.emailAddress,
                    domain,
                    mappingType: mapping.mappingType || 'EMAIL',
                    confidence: mapping.confidence
                  }
                });

            results.push({
              id: created.id,
              userId: created.userId,
              labelId: created.labelId,
              labelName: label.name,
              labelColor: label.color || undefined,
              emailAddress: created.emailAddress,
              domain: created.domain || undefined,
              isActive: created.isActive,
              mappingType: created.mappingType,
              confidence: created.confidence || undefined,
              createdAt: created.createdAt,
              updatedAt: created.updatedAt
            });

          } catch (error) {
            console.warn(`[EMAIL MAPPING] Failed to create mapping for ${mapping.emailAddress}:`, error);
          }
        }
      }

      console.log(`[EMAIL MAPPING] Created ${results.length} mappings successfully`);
      return results;

    } catch (error) {
      console.error(`[EMAIL MAPPING] Error in bulk create:`, error);
      throw error;
    }
  }

  /**
   * Get mapping statistics for analytics
   */
  async getMappingStats(userId: string): Promise<{
    totalMappings: number;
    activeMappings: number;
    emailMappings: number;
    domainMappings: number;
    mappingsByLabel: Array<{ labelName: string; count: number }>;
  }> {
    try {
      const [totalCount, activeCount, emailCount, domainCount, labelCounts] = await Promise.all([
        // Total mappings
        prisma.emailMapping.count({
          where: { userId }
        }),
        
        // Active mappings
        prisma.emailMapping.count({
          where: {
            userId,
            isActive: true
          }
        }),
        
        // Email mappings
        prisma.emailMapping.count({
          where: {
            userId,
            mappingType: 'EMAIL'
          }
        }),
        
        // Domain mappings
        prisma.emailMapping.count({
          where: {
            userId,
            mappingType: 'DOMAIN'
          }
        }),
        
        // Mappings by label
        prisma.emailMapping.groupBy({
          by: ['labelId'],
          where: {
            userId,
            isActive: true
          },
          _count: {
            id: true
          }
        })
      ]);

      // Get label names for the grouped counts
      const labelIds = labelCounts.map(lc => lc.labelId);
      const labels = await prisma.label.findMany({
        where: {
          id: { in: labelIds }
        },
        select: {
          id: true,
          name: true
        }
      });

      const labelMap = new Map(labels.map(l => [l.id, l.name]));
      const mappingsByLabel = labelCounts.map(lc => ({
        labelName: labelMap.get(lc.labelId) || 'Unknown',
        count: lc._count.id
      }));

      return {
        totalMappings: totalCount,
        activeMappings: activeCount,
        emailMappings: emailCount,
        domainMappings: domainCount,
        mappingsByLabel
      };

    } catch (error) {
      console.error(`[EMAIL MAPPING] Error getting mapping stats:`, error);
      throw error;
    }
  }

  /**
   * Deactivate mappings for a label (when label is deleted)
   */
  async deactivateLabelMappings(userId: string, labelId: string): Promise<void> {
    try {
      await prisma.emailMapping.updateMany({
        where: {
          userId,
          labelId
        },
        data: {
          isActive: false
        }
      });

      console.log(`[EMAIL MAPPING] Deactivated all mappings for label ${labelId}`);

    } catch (error) {
      console.error(`[EMAIL MAPPING] Error deactivating label mappings:`, error);
      throw error;
    }
  }

  /**
   * Create rule from user correction during inbox review
   */
  async createRuleFromCorrection(
    userId: string, 
    emailFrom: string, 
    targetLabelId: string, 
    ruleType: 'email' | 'domain' = 'email',
    confidence: number = 95
  ): Promise<EmailMapping> {
    console.log(`[EMAIL MAPPING] Creating correction rule: ${emailFrom} → ${targetLabelId} (${ruleType})`);

    try {
      // Determine the mapping value based on rule type
      let mappingValue = emailFrom;
      let mappingType: 'EMAIL' | 'DOMAIN' = 'EMAIL';

      if (ruleType === 'domain') {
        // Extract domain from email
        if (emailFrom.includes('@')) {
          mappingValue = '@' + emailFrom.split('@')[1];
          mappingType = 'DOMAIN';
        } else if (emailFrom.startsWith('@')) {
          mappingValue = emailFrom;
          mappingType = 'DOMAIN';
        }
      }

      // Create the mapping rule
      const correctionRule = await this.createMapping({
        userId,
        labelId: targetLabelId,
        emailAddress: mappingValue,
        mappingType,
        confidence
      });

      console.log(`[EMAIL MAPPING] Created correction rule ${correctionRule.id}: ${mappingValue} → ${correctionRule.labelName}`);
      return correctionRule;

    } catch (error) {
      console.error(`[EMAIL MAPPING] Error creating correction rule:`, error);
      throw error;
    }
  }

  /**
   * Suggest similar emails for batch corrections
   */
  async suggestSimilarEmails(
    userId: string, 
    emailFrom: string, 
    suggestionType: 'domain' | 'sender' = 'domain'
  ): Promise<{
    similarEmails: string[];
    suggestedRule: string;
    affectedCount: number;
  }> {
    try {
      // This is a simplified implementation
      // In production, you'd query actual email data to find similar patterns
      
      const similarEmails: string[] = [];
      let suggestedRule = '';
      let affectedCount = 0;

      if (suggestionType === 'domain' && emailFrom.includes('@')) {
        const domain = emailFrom.split('@')[1];
        suggestedRule = `All emails from @${domain}`;
        // In production, query email data to find all emails from this domain
        affectedCount = 1; // Placeholder
      } else {
        suggestedRule = `Emails from ${emailFrom}`;
        affectedCount = 1;
      }

      console.log(`[EMAIL MAPPING] Generated similarity suggestion for ${emailFrom}: ${suggestedRule} (${affectedCount} emails)`);

      return {
        similarEmails,
        suggestedRule,
        affectedCount
      };

    } catch (error) {
      console.error(`[EMAIL MAPPING] Error generating similar email suggestions:`, error);
      return {
        similarEmails: [],
        suggestedRule: 'No suggestions available',
        affectedCount: 0
      };
    }
  }

  /**
   * Get correction statistics and insights
   */
  async getCorrectionStats(userId: string): Promise<{
    totalCorrections: number;
    rulesByType: Record<string, number>;
    topCorrectedDomains: Array<{ domain: string; count: number }>;
    recentCorrections: Array<{
      id: string;
      emailAddress: string;
      labelName: string;
      createdAt: Date;
    }>;
  }> {
    try {
      // Get all user mappings created with high confidence (likely corrections)
      const correctionMappings = await prisma.emailMapping.findMany({
        where: {
          userId,
          confidence: { gte: 90 }, // High confidence mappings are likely user corrections
        },
        include: {
          label: {
            select: {
              name: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      // Calculate statistics
      const totalCorrections = correctionMappings.length;
      
      const rulesByType: Record<string, number> = {};
      const domainCounts: Record<string, number> = {};

      correctionMappings.forEach(mapping => {
        // Count by mapping type
        rulesByType[mapping.mappingType] = (rulesByType[mapping.mappingType] || 0) + 1;
        
        // Count domains for domain mappings
        if (mapping.mappingType === 'DOMAIN' && mapping.domain) {
          domainCounts[mapping.domain] = (domainCounts[mapping.domain] || 0) + 1;
        }
      });

      // Get top corrected domains
      const topCorrectedDomains = Object.entries(domainCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .map(([domain, count]) => ({ domain, count }));

      // Get recent corrections
      const recentCorrections = correctionMappings.slice(0, 10).map(mapping => ({
        id: mapping.id,
        emailAddress: mapping.emailAddress,
        labelName: mapping.label.name,
        createdAt: mapping.createdAt
      }));

      console.log(`[EMAIL MAPPING] Correction stats for user ${userId}: ${totalCorrections} total corrections`);

      return {
        totalCorrections,
        rulesByType,
        topCorrectedDomains,
        recentCorrections
      };

    } catch (error) {
      console.error(`[EMAIL MAPPING] Error getting correction stats:`, error);
      return {
        totalCorrections: 0,
        rulesByType: {},
        topCorrectedDomains: [],
        recentCorrections: []
      };
    }
  }
}
