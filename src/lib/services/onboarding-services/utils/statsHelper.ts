/**
 * Shared Stats Computation Helpers
 * 
 * Consolidates common statistics calculation patterns used across
 * onboarding services to eliminate duplicate logic.
 */

import { prisma } from '../../../prisma';

/**
 * Get mapping count for a specific label/folder
 * 
 * Previously used by services that computed folder stats.
 */
export async function getMappingCountForLabel(
  userId: string, 
  labelId: string, 
  activeOnly: boolean = true
): Promise<number> {
  return await prisma.emailMapping.count({
    where: {
      userId,
      labelId,
      ...(activeOnly ? { isActive: true } : {})
    }
  });
}

/**
 * Get mapping counts for multiple labels at once
 * More efficient than calling getMappingCountForLabel multiple times
 */
export async function getMappingCountsForLabels(
  userId: string, 
  labelIds: string[], 
  activeOnly: boolean = true
): Promise<Map<string, number>> {
  const mappings = await prisma.emailMapping.groupBy({
    by: ['labelId'],
    where: {
      userId,
      labelId: { in: labelIds },
      ...(activeOnly ? { isActive: true } : {})
    },
    _count: {
      id: true
    }
  });

  const counts = new Map<string, number>();
  
  // Initialize all labels with 0 count
  labelIds.forEach(id => counts.set(id, 0));
  
  // Set actual counts
  mappings.forEach(mapping => {
    counts.set(mapping.labelId, mapping._count.id);
  });

  return counts;
}

/**
 * Get email sort count for a label (how many emails have been sorted to this folder)
 */
export async function getEmailSortCountForLabel(
  userId: string, 
  labelId: string
): Promise<number> {
  return await prisma.emailSort.count({
    where: {
      userId,
      labelId
    }
  });
}

/**
 * Get email sort counts for multiple labels at once
 */
export async function getEmailSortCountsForLabels(
  userId: string, 
  labelIds: string[]
): Promise<Map<string, number>> {
  const sorts = await prisma.emailSort.groupBy({
    by: ['labelId'],
    where: {
      userId,
      labelId: { in: labelIds }
    },
    _count: {
      id: true
    }
  });

  const counts = new Map<string, number>();
  
  // Initialize all labels with 0 count
  labelIds.forEach(id => counts.set(id, 0));
  
  // Set actual counts
  sorts.forEach(sort => {
    counts.set(sort.labelId, sort._count.id);
  });

  return counts;
}

/**
 * Get comprehensive folder statistics that combines mapping and email counts
 * Utility to build folder stats breakdown.
 */
export async function getFolderStatsBreakdown(userId: string) {
  // Get all user folders
  const folders = await prisma.label.findMany({
    where: { 
      userId,
      isSystemLabel: false // Exclude Gmail system labels
    },
    select: {
      id: true,
      name: true,
      isSystemDefault: true
    },
    orderBy: [
      { isSystemDefault: 'desc' },
      { name: 'asc' }
    ]
  });

  const folderIds = folders.map(f => f.id);
  
  // Get counts in parallel for efficiency
  const [mappingCounts, emailCounts] = await Promise.all([
    getMappingCountsForLabels(userId, folderIds, true),
    getEmailSortCountsForLabels(userId, folderIds)
  ]);

  return folders.map(folder => ({
    folderId: folder.id,
    folderName: folder.name,
    emailCount: emailCounts.get(folder.id) || 0,
    mappingCount: mappingCounts.get(folder.id) || 0,
    isSystemDefault: folder.isSystemDefault
  }));
}