import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { EmailMappingService } from '@/lib/services/onboarding-services/emailMappingService';
import { EmailMappingType } from '@prisma/client';

export async function GET(request: NextRequest) {
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

    const url = new URL(request.url);
    const labelId = url.searchParams.get('labelId');

    const emailMappingService = new EmailMappingService();

    if (labelId) {
      // Get mappings for specific label
      const mappings = await emailMappingService.getLabelMappings(user.id, labelId);
      return NextResponse.json({
        success: true,
        mappings
      });
    } else {
      // Get all mappings for user
      const mappings = await emailMappingService.getUserMappings(user.id);
      const stats = await emailMappingService.getMappingStats(user.id);
      
      return NextResponse.json({
        success: true,
        mappings,
        stats
      });
    }

  } catch (error) {
    console.error('[EMAIL MAPPING API] Error getting mappings:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to get email mappings'
    }, { status: 500 });
  }
}

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
    const { emailAddress, labelId, domain, mappingType = 'EMAIL', confidence } = body;

    if (!emailAddress || !labelId) {
      return NextResponse.json({ 
        error: 'Missing required fields: emailAddress and labelId' 
      }, { status: 400 });
    }

    const emailMappingService = new EmailMappingService();

    // Create new mapping
    const mapping = await emailMappingService.createMapping({
      userId: user.id,
      labelId,
      emailAddress,
      domain,
      mappingType: mappingType as EmailMappingType,
      confidence
    });

    console.log(`[EMAIL MAPPING API] Created mapping: ${emailAddress} → ${mapping.labelName}`);

    return NextResponse.json({
      success: true,
      mapping
    });

  } catch (error) {
    console.error('[EMAIL MAPPING API] Error creating mapping:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to create email mapping',
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
    const { mappingId, labelId, isActive, confidence } = body;

    if (!mappingId) {
      return NextResponse.json({ 
        error: 'Missing required field: mappingId' 
      }, { status: 400 });
    }

    const emailMappingService = new EmailMappingService();

    // Update mapping
    const mapping = await emailMappingService.updateMapping(user.id, mappingId, {
      labelId,
      isActive,
      confidence
    });

    console.log(`[EMAIL MAPPING API] Updated mapping: ${mapping.emailAddress} → ${mapping.labelName}`);

    return NextResponse.json({
      success: true,
      mapping
    });

  } catch (error) {
    console.error('[EMAIL MAPPING API] Error updating mapping:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to update email mapping',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
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

    const url = new URL(request.url);
    const mappingId = url.searchParams.get('mappingId');

    if (!mappingId) {
      return NextResponse.json({ 
        error: 'Missing required parameter: mappingId' 
      }, { status: 400 });
    }

    const emailMappingService = new EmailMappingService();

    // Delete mapping
    await emailMappingService.deleteMapping(user.id, mappingId);

    console.log(`[EMAIL MAPPING API] Deleted mapping: ${mappingId}`);

    return NextResponse.json({
      success: true,
      message: 'Email mapping deleted successfully'
    });

  } catch (error) {
    console.error('[EMAIL MAPPING API] Error deleting mapping:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to delete email mapping',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}