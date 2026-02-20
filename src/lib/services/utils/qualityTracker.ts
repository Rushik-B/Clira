import { prisma } from '../../prisma';

/**
 * Quality Tracker Service
 * 
 * Handles tracking of quality flags for prompt generation
 * Uses raw SQL to avoid TypeScript issues with new columns
 */
export class QualityTrackerService {
  
  /**
   * Mark master prompt as quality generated
   */
  async markMasterPromptQuality(userId: string, isQuality: boolean): Promise<void> {
    try {
      await prisma.$executeRaw`
        UPDATE "User" 
        SET "masterPromptQualityGenerated" = ${isQuality}
        WHERE id = ${userId}
      `;
    } catch (error) {
      console.error('Error updating master prompt quality flag:', error);
    }
  }

  /**
   * Get users who need quality regeneration
   */
  async getUsersNeedingQualityRegeneration(): Promise<Array<{
    id: string;
    email: string;
    masterPromptQualityGenerated: boolean;
  }>> {
    try {
      const users = await prisma.$queryRaw<Array<{
        id: string;
        email: string;
        masterPromptQualityGenerated: boolean;
      }>>`
        SELECT 
          id, 
          email,
          "masterPromptQualityGenerated"
        FROM "User" 
        WHERE 
          "masterPromptQualityGenerated" = false
      `;
      return users;
    } catch (error) {
      console.error('Error getting users needing quality regeneration:', error);
      return [];
    }
  }
} 
