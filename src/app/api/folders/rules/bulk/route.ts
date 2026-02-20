import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import redis, { safeRedisOperation } from '@/lib/services/utils/redis';
import crypto from 'crypto';

/**
 * GET /api/folders/rules/bulk
 * Bulk fetch active email routing rules for multiple folders in a single request.
 *
 * Query params (optional):
 * - folderIds: comma-separated list of folder (label) IDs to restrict results. If omitted,
 *   returns rules for all of the user's non-system labels.
 *
 * Response shape:
 * {
 *   success: true,
 *   folders: [
 *     { id, name, rules: [ { id, type, value, createdAt, updatedAt } ] }
 *   ],
 *   totals: { folders: number, rules: number }
 * }
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const folderIdsParam = url.searchParams.get('folderIds');
    const requestedIds = (folderIdsParam || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    // Cache keys with versioning per user for safe invalidation
    const versionKey = `bulk_rules:ver:${session.userId}`;
    const ttl = parseInt(process.env.BULK_RULES_CACHE_TTL || '60', 10); // seconds

    // Obtain current version (default 1)
    const version = await safeRedisOperation(
      async () => (await redis.get(versionKey)) || '1',
      '1',
      'get bulk rules version'
    );

    // 1) Load labels within scope (either requested IDs or all user's non-system labels)
    const labelWhere: any = {
      userId: session.userId,
      isSystemLabel: false,
    };

    if (requestedIds.length > 0) {
      labelWhere.id = { in: requestedIds };
    }

    const labels = await prisma.label.findMany({
      where: labelWhere,
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }],
    });

    // If folderIds were provided but none belong to the user, return empty safely
    if (requestedIds.length > 0 && labels.length === 0) {
      return NextResponse.json({ success: true, folders: [], totals: { folders: 0, rules: 0 } });
    }

    const labelIds = labels.map((l) => l.id);

    // If no labels in scope, return empty immediately to avoid unnecessary queries
    if (labelIds.length === 0) {
      return NextResponse.json({ success: true, folders: [], totals: { folders: 0, rules: 0 } });
    }

    // 0) Try cache
    const sortedIds = [...labelIds].sort();
    const idsHash = sortedIds.length ? crypto.createHash('sha1').update(sortedIds.join(',')).digest('hex') : 'all';
    const cacheKey = `bulk_rules:${session.userId}:v${version}:${idsHash}`;

    const cached = await safeRedisOperation(async () => await redis.get(cacheKey), null, 'get bulk rules cache');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        return NextResponse.json(parsed);
      } catch {
        // fall through on parse error
      }
    }

    // 2) Fetch all active rules for these labels in one query
    const rules = await prisma.emailMapping.findMany({
      where: {
        userId: session.userId,
        isActive: true,
        labelId: { in: labelIds },
      },
      select: {
        id: true,
        labelId: true,
        mappingType: true,
        emailAddress: true,
        domain: true,
        subjectPattern: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ createdAt: 'asc' }],
    });

    // 3) Group rules by labelId
    const rulesByLabel = new Map<string, typeof rules>();
    for (const r of rules) {
      const arr = rulesByLabel.get(r.labelId) || [];
      arr.push(r);
      rulesByLabel.set(r.labelId, arr as any);
    }

    // 4) Build response per label, including empty rule arrays
    const folders = labels.map((label) => {
      const labelRules = rulesByLabel.get(label.id) || [];
      return {
        id: label.id,
        name: label.name,
        rules: labelRules.map((rule) => ({
          id: rule.id,
          type: rule.mappingType,
          value: getRuleValue(rule),
          createdAt: rule.createdAt,
          updatedAt: rule.updatedAt,
        })),
      };
    });

    const totalRules = rules.length;
    const responsePayload = { success: true, folders, totals: { folders: folders.length, rules: totalRules } };
    console.log(`📦 [BULK RULES] Returned ${totalRules} rules across ${folders.length} folders for user ${session.userId}`);

    // 5) Store in cache (best-effort)
    await safeRedisOperation(async () => {
      await redis.setex(cacheKey, ttl, JSON.stringify(responsePayload));
      return true as any;
    }, true, 'set bulk rules cache');

    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error('[BULK RULES] Error fetching rules:', error);
    return NextResponse.json({ error: 'Failed to fetch rules' }, { status: 500 });
  }
}

// Helper: mirror value selection from single-folder endpoint
function getRuleValue(rule: any): string {
  switch (rule.mappingType) {
    case 'EMAIL':
      return rule.emailAddress;
    case 'DOMAIN':
      return rule.domain || rule.emailAddress;
    case 'SUBJECT':
    case 'SUBJECT_CONTAINS':
    case 'SUBJECT_STARTS_WITH':
    case 'SUBJECT_ENDS_WITH':
    case 'SUBJECT_REGEX':
      return rule.subjectPattern || '';
    default:
      return rule.emailAddress || rule.domain || rule.subjectPattern || '';
  }
}
