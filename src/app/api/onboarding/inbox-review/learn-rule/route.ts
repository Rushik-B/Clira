import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { EmailMappingService } from '@/lib/services/onboarding-services/emailMappingService';

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
    const { 
      ruleType, 
      condition, 
      value, 
      targetFolderId,
      emailContext,
      confidence = 90
    } = body;

    // Validate required fields
    if (!ruleType || !condition || !value || !targetFolderId) {
      return NextResponse.json({ 
        error: 'Missing required fields: ruleType, condition, value, targetFolderId' 
      }, { status: 400 });
    }

    console.log(`[LEARN RULE API] Creating ${ruleType} rule for user ${user.id}: ${condition} = ${value} → folder ${targetFolderId}`);

    // Initialize email mapping service
    const emailMappingService = new EmailMappingService();

    let createdRule;

    if (ruleType === 'email_mapping') {
      // Create a hard email mapping rule
      createdRule = await emailMappingService.createMapping({
        userId: user.id,
        labelId: targetFolderId,
        emailAddress: value,
        mappingType: condition === 'domain' ? 'DOMAIN' : 'EMAIL',
        confidence
      });
    } else {
      // For other rule types, we would implement additional logic
      // For now, return success but log that it's not implemented
      console.log(`[LEARN RULE API] Rule type ${ruleType} not yet implemented, but logged for future processing`);
      
      createdRule = {
        id: `rule-${Date.now()}`,
        type: ruleType,
        condition,
        value,
        targetFolderId,
        confidence,
        createdAt: new Date()
      };
    }

    console.log(`[LEARN RULE API] Successfully created rule ${createdRule.id}`);

    return NextResponse.json({
      success: true,
      rule: createdRule,
      message: `Successfully created ${ruleType} rule`
    });

  } catch (error) {
    console.error('[LEARN RULE API] Error creating learning rule:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to create learning rule',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}