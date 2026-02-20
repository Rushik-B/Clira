import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { EmailMappingService } from '@/lib/services/onboarding-services/emailMappingService';
import { EmailMappingType } from '@prisma/client';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await request.json();
    const { mappings } = body;

    if (!Array.isArray(mappings) || mappings.length === 0) {
      return NextResponse.json({ 
        error: 'mappings must be a non-empty array' 
      }, { status: 400 });
    }

    // Validate mapping structure
    for (const mapping of mappings) {
      if (!mapping.emailAddress || !mapping.labelId) {
        return NextResponse.json({ 
          error: 'Each mapping must have emailAddress and labelId' 
        }, { status: 400 });
      }
    }

    console.log(`[EMAIL MAPPING BULK API] Creating ${mappings.length} mappings for user ${user.id}`);

    const emailMappingService = new EmailMappingService();

    // Prepare mapping inputs
    const mappingInputs = mappings.map((mapping: any) => ({
      userId: user.id,
      labelId: mapping.labelId,
      emailAddress: mapping.emailAddress,
      domain: mapping.domain,
      mappingType: (mapping.mappingType as EmailMappingType) || 'EMAIL',
      confidence: mapping.confidence
    }));

    // Create mappings in bulk
    const results = await emailMappingService.createMappingsBulk(user.id, mappingInputs);

    console.log(`[EMAIL MAPPING BULK API] Created ${results.length} mappings successfully`);

    return NextResponse.json({
      success: true,
      results,
      summary: {
        totalRequested: mappings.length,
        totalCreated: results.length,
        skipped: mappings.length - results.length
      }
    });

  } catch (error) {
    console.error('[EMAIL MAPPING BULK API] Error creating bulk mappings:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to create bulk email mappings',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await request.json();
    const { updates } = body;

    if (!Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json({ 
        error: 'updates must be a non-empty array' 
      }, { status: 400 });
    }

    // Validate update structure
    for (const update of updates) {
      if (!update.mappingId) {
        return NextResponse.json({ 
          error: 'Each update must have mappingId' 
        }, { status: 400 });
      }
    }

    console.log(`[EMAIL MAPPING BULK API] Updating ${updates.length} mappings for user ${user.id}`);

    const emailMappingService = new EmailMappingService();
    const results = [];
    const errors = [];

    // Update mappings one by one (could be optimized with a bulk update method)
    for (const update of updates) {
      try {
        const result = await emailMappingService.updateMapping(
          user.id, 
          update.mappingId, 
          {
            labelId: update.labelId,
            isActive: update.isActive,
            confidence: update.confidence
          }
        );
        results.push(result);
      } catch (error) {
        console.error(`[EMAIL MAPPING BULK API] Error updating mapping ${update.mappingId}:`, error);
        errors.push({
          mappingId: update.mappingId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    console.log(`[EMAIL MAPPING BULK API] Updated ${results.length} mappings, ${errors.length} errors`);

    return NextResponse.json({
      success: true,
      results,
      errors,
      summary: {
        totalRequested: updates.length,
        totalUpdated: results.length,
        failed: errors.length
      }
    });

  } catch (error) {
    console.error('[EMAIL MAPPING BULK API] Error updating bulk mappings:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to update bulk email mappings',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}