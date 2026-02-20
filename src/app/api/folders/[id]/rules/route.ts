import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { FeatureFlags } from '@/lib/services/utils/featureFlags';
import redis, { safeRedisOperation } from '@/lib/services/utils/redis';

/**
 * Comprehensive Email Routing Rules Management API
 * 
 * Manages sender/domain/subject rules for the always-on email mapping system.
 * Supports multiple rule types with priority-based execution order.
 */

interface CreateRuleRequest {
  type: 'EMAIL' | 'DOMAIN' | 'SUBJECT' | 'SUBJECT_CONTAINS' | 'SUBJECT_STARTS_WITH' | 'SUBJECT_ENDS_WITH' | 'SUBJECT_REGEX';
  value: string;
}

interface UpdateRuleRequest {
  isActive?: boolean;
  value?: string;
}

// GET /api/folders/[id]/rules - Get all rules for a folder
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: folderId } = await params;

    // Validate folder exists and user owns it
    const folder = await prisma.label.findFirst({
      where: {
        id: folderId,
        userId: session.userId
      }
    });

    if (!folder) {
      return NextResponse.json({ 
        error: 'Folder not found or access denied' 
      }, { status: 404 });
    }

    // Get all active rules for this folder, ordered by creation date
    const rules = await prisma.emailMapping.findMany({
      where: {
        labelId: folderId,
        userId: session.userId,
        isActive: true
      },
      select: {
        id: true,
        mappingType: true,
        emailAddress: true,
        domain: true,
        subjectPattern: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: [
        { createdAt: 'asc' }
      ]
    });

    console.log(`📋 Retrieved ${rules.length} rules for folder ${folder.name} (${folderId})`);

    return NextResponse.json({
      success: true,
      folder: {
        id: folder.id,
        name: folder.name
      },
      rules: rules.map(rule => ({
        id: rule.id,
        type: rule.mappingType,
        value: getRuleValue(rule),
        createdAt: rule.createdAt,
        updatedAt: rule.updatedAt
      }))
    });

  } catch (error) {
    console.error('Error fetching folder rules:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch folder rules' 
    }, { status: 500 });
  }
}

// Helper function to get the appropriate value based on rule type
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

// POST /api/folders/[id]/rules - Create a new rule for a folder
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if Folder Management is enabled
    if (!FeatureFlags.isFolderManagementEnabled(session.userId)) {
      return NextResponse.json(
        { 
          error: 'Folder management features not available',
          message: 'Email mapping rules are currently disabled'
        },
        { status: 403 }
      );
    }

    const { id: folderId } = await params;
    const body: CreateRuleRequest = await request.json();

    console.log(`➕ Creating new rule for folder ${folderId} by user ${session.userId}:`, body);

    // Validate input
    if (!body.type || !['EMAIL', 'DOMAIN', 'SUBJECT', 'SUBJECT_CONTAINS', 'SUBJECT_STARTS_WITH', 'SUBJECT_ENDS_WITH', 'SUBJECT_REGEX'].includes(body.type)) {
      return NextResponse.json({ 
        error: 'Invalid rule type. Must be one of: EMAIL, DOMAIN, SUBJECT, SUBJECT_CONTAINS, SUBJECT_STARTS_WITH, SUBJECT_ENDS_WITH, SUBJECT_REGEX' 
      }, { status: 400 });
    }

    if (!body.value || typeof body.value !== 'string') {
      return NextResponse.json({ 
        error: 'Rule value is required and must be a string' 
      }, { status: 400 });
    }

    const value = body.value.trim();
    if (value.length === 0) {
      return NextResponse.json({ 
        error: 'Rule value cannot be empty' 
      }, { status: 400 });
    }

    // Validate folder exists and user owns it
    const folder = await prisma.label.findFirst({
      where: {
        id: folderId,
        userId: session.userId
      }
    });

    if (!folder) {
      return NextResponse.json({ 
        error: 'Folder not found or access denied' 
      }, { status: 404 });
    }

    // Validate based on rule type
    const validationError = validateRuleValue(body.type, value);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    // Check if rule already exists
    const whereClause: any = {
      userId: session.userId,
      labelId: folderId,
      mappingType: body.type,
      isActive: true
    };

    if (body.type === 'EMAIL') {
      whereClause.emailAddress = value;
    } else if (body.type === 'DOMAIN') {
      const normalizedDomain = value.startsWith('@') ? value : `@${value}`;
      whereClause.domain = normalizedDomain;
    } else {
      // Subject-based rules
      whereClause.subjectPattern = value;
    }

    const existingRule = await prisma.emailMapping.findFirst({
      where: whereClause
    });

    if (existingRule) {
      return NextResponse.json({ 
        error: `A rule for ${body.type.toLowerCase()} "${value}" already exists for this folder` 
      }, { status: 409 });
    }

    // Check if there are running batch jobs
    const runningJob = await prisma.batchSortJob.findFirst({
      where: {
        userId: session.userId,
        status: 'running'
      }
    });

    if (runningJob) {
      console.warn(`⚠️ User ${session.userId} trying to create rule while batch job ${runningJob.id} is running`);
      return NextResponse.json({ 
        error: 'Cannot modify rules while email sorting is in progress',
        runningJobId: runningJob.id
      }, { status: 409 });
    }

    // Create the rule
    const ruleData: any = {
      userId: session.userId,
      labelId: folderId,
      mappingType: body.type,
      isActive: true
    };

    if (body.type === 'EMAIL') {
      ruleData.emailAddress = value;
    } else if (body.type === 'DOMAIN') {
      const normalizedDomain = value.startsWith('@') ? value : `@${value}`;
      ruleData.domain = normalizedDomain;
      ruleData.emailAddress = normalizedDomain; // Prisma requirement
    } else {
      // Subject-based rules
      ruleData.subjectPattern = value;
      ruleData.emailAddress = `subject_rule_${Date.now()}`; // Prisma requirement
    }

    const newRule = await prisma.emailMapping.create({
      data: ruleData,
      select: {
        id: true,
        mappingType: true,
        emailAddress: true,
        domain: true,
        subjectPattern: true,
        createdAt: true
      }
    });

    console.log(`✅ Successfully created rule ${newRule.id} for folder ${folder.name}`);
    console.log(`📋 Rule: ${body.type} "${value}" → ${folder.name}`);
    // Invalidate bulk rules cache by bumping user version (best-effort)
    {
      const versionKey = `bulk_rules:ver:${session.userId}`;
      safeRedisOperation(async () => { await redis.incr(versionKey); return true as any; }, true, 'bump bulk rules version (create)');
    }

    return NextResponse.json({
      success: true,
      message: 'Email routing rule created successfully',
      rule: {
        id: newRule.id,
        type: newRule.mappingType,
        value: getRuleValue(newRule),
        createdAt: newRule.createdAt
      },
      folder: {
        id: folder.id,
        name: folder.name
      },
      note: 'Rule will take effect in the next sorting cycle'
    });

  } catch (error) {
    console.error('Error creating folder rule:', error);
    return NextResponse.json({ 
      error: 'Failed to create email routing rule' 
    }, { status: 500 });
  }
}

// Validation function for different rule types
function validateRuleValue(type: string, value: string): string | null {
  switch (type) {
    case 'EMAIL':
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        return 'Please enter a valid email address';
      }
      break;
    
    case 'DOMAIN':
      const domainRegex = /^@?[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.[a-zA-Z.]{2,}$/;
      if (!domainRegex.test(value.startsWith('@') ? value : `@${value}`)) {
        return 'Please enter a valid domain (e.g., @company.com)';
      }
      break;
    
    case 'SUBJECT':
      if (value.length < 2) {
        return 'Subject must be at least 2 characters long';
      }
      break;
    
    case 'SUBJECT_CONTAINS':
    case 'SUBJECT_STARTS_WITH':
    case 'SUBJECT_ENDS_WITH':
      if (value.length < 2) {
        return 'Subject pattern must be at least 2 characters long';
      }
      break;
    
    case 'SUBJECT_REGEX':
      try {
        new RegExp(value);
      } catch {
        return 'Please enter a valid regular expression';
      }
      break;
  }
  
  return null;
}

// DELETE /api/folders/[id]/rules?ruleId=xxx - Delete a specific rule
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if Folder Management is enabled
    if (!FeatureFlags.isFolderManagementEnabled(session.userId)) {
      return NextResponse.json(
        { 
          error: 'Folder management features not available',
          message: 'Email mapping rules are currently disabled'
        },
        { status: 403 }
      );
    }

    const { id: folderId } = await params;
    const { searchParams } = new URL(request.url);
    const ruleId = searchParams.get('ruleId');

    if (!ruleId) {
      return NextResponse.json({ 
        error: 'ruleId query parameter is required' 
      }, { status: 400 });
    }

    console.log(`🗑️ Deleting rule ${ruleId} from folder ${folderId} by user ${session.userId}`);

    // Validate rule exists and user owns it
    const rule = await prisma.emailMapping.findFirst({
      where: {
        id: ruleId,
        labelId: folderId,
        userId: session.userId
      },
      include: {
        label: {
          select: { name: true }
        }
      }
    });

    if (!rule) {
      return NextResponse.json({ 
        error: 'Rule not found or access denied' 
      }, { status: 404 });
    }

    // Check if there are running batch jobs
    const runningJob = await prisma.batchSortJob.findFirst({
      where: {
        userId: session.userId,
        status: 'running'
      }
    });

    if (runningJob) {
      console.warn(`⚠️ User ${session.userId} trying to delete rule while batch job ${runningJob.id} is running`);
      return NextResponse.json({ 
        error: 'Cannot modify rules while email sorting is in progress',
        runningJobId: runningJob.id
      }, { status: 409 });
    }

    // Soft delete by setting isActive to false
    await prisma.emailMapping.update({
      where: { id: ruleId },
      data: { isActive: false }
    });

    const ruleValue = getRuleValue(rule);
    console.log(`✅ Successfully deleted rule: ${rule.mappingType} "${ruleValue}" from ${rule.label.name}`);

    // Invalidate cache version (best-effort)
    {
      const versionKey = `bulk_rules:ver:${session.userId}`;
      safeRedisOperation(async () => { await redis.incr(versionKey); return true as any; }, true, 'bump bulk rules version (delete)');
    }

    return NextResponse.json({
      success: true,
      message: 'Email routing rule deleted successfully',
      rule: {
        id: rule.id,
        type: rule.mappingType,
        value: ruleValue
      },
      note: 'Rule will be removed in the next sorting cycle'
    });

  } catch (error) {
    console.error('Error deleting folder rule:', error);
    return NextResponse.json({ 
      error: 'Failed to delete email routing rule' 
    }, { status: 500 });
  }
}

// PUT /api/folders/[id]/rules?ruleId=xxx - Update a specific rule
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if Folder Management is enabled
    if (!FeatureFlags.isFolderManagementEnabled(session.userId)) {
      return NextResponse.json(
        { 
          error: 'Folder management features not available',
          message: 'Email mapping rules are currently disabled'
        },
        { status: 403 }
      );
    }

    const { id: folderId } = await params;
    const { searchParams } = new URL(request.url);
    const ruleId = searchParams.get('ruleId');
    const body: UpdateRuleRequest = await request.json();

    if (!ruleId) {
      return NextResponse.json({ 
        error: 'ruleId query parameter is required' 
      }, { status: 400 });
    }

    console.log(`📝 Updating rule ${ruleId} in folder ${folderId} by user ${session.userId}:`, body);

    // Validate rule exists and user owns it
    const rule = await prisma.emailMapping.findFirst({
      where: {
        id: ruleId,
        labelId: folderId,
        userId: session.userId
      },
      include: {
        label: {
          select: { name: true }
        }
      }
    });

    if (!rule) {
      return NextResponse.json({ 
        error: 'Rule not found or access denied' 
      }, { status: 404 });
    }

    // Check if there are running batch jobs
    const runningJob = await prisma.batchSortJob.findFirst({
      where: {
        userId: session.userId,
        status: 'running'
      }
    });

    if (runningJob) {
      console.warn(`⚠️ User ${session.userId} trying to update rule while batch job ${runningJob.id} is running`);
      return NextResponse.json({ 
        error: 'Cannot modify rules while email sorting is in progress',
        runningJobId: runningJob.id
      }, { status: 409 });
    }

    // Prepare updates
    const updates: any = {};

    if (body.isActive !== undefined) {
      updates.isActive = Boolean(body.isActive);
    }

    if (body.value !== undefined) {
      const validationError = validateRuleValue(rule.mappingType, body.value);
      if (validationError) {
        return NextResponse.json({ error: validationError }, { status: 400 });
      }

      // Update the appropriate field based on rule type
      if (rule.mappingType === 'EMAIL') {
        updates.emailAddress = body.value.trim();
      } else if (rule.mappingType === 'DOMAIN') {
        const normalizedDomain = body.value.trim().startsWith('@') ? body.value.trim() : `@${body.value.trim()}`;
        updates.domain = normalizedDomain;
        updates.emailAddress = normalizedDomain;
      } else {
        // Subject-based rules
        updates.subjectPattern = body.value.trim();
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ 
        error: 'No valid updates provided' 
      }, { status: 400 });
    }

    // Update the rule
    const updatedRule = await prisma.emailMapping.update({
      where: { id: ruleId },
      data: updates,
      select: {
        id: true,
        mappingType: true,
        emailAddress: true,
        domain: true,
        subjectPattern: true,
        isActive: true,
        updatedAt: true
      }
    });

    const ruleValue = getRuleValue(updatedRule);
    console.log(`✅ Successfully updated rule: ${updatedRule.mappingType} "${ruleValue}" in ${rule.label.name}`);

    // Invalidate bulk rules cache version (best-effort)
    {
      const versionKey = `bulk_rules:ver:${session.userId}`;
      safeRedisOperation(async () => { await redis.incr(versionKey); return true as any; }, true, 'bump bulk rules version (update)');
    }

    return NextResponse.json({
      success: true,
      message: 'Email routing rule updated successfully',
      rule: {
        id: updatedRule.id,
        type: updatedRule.mappingType,
        value: ruleValue,
        isActive: updatedRule.isActive,
        updatedAt: updatedRule.updatedAt
      },
      note: 'Changes will take effect in the next sorting cycle'
    });

  } catch (error) {
    console.error('Error updating folder rule:', error);
    return NextResponse.json({ 
      error: 'Failed to update email routing rule' 
    }, { status: 500 });
  }
}
