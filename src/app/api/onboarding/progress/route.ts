import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { DEFAULT_CALENDAR_TIMEZONE } from '@/constants/time';

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
    const { step, stepName, data, flowData } = body;

    console.log(`[ONBOARDING PROGRESS] Saving progress for user ${user.id}: Step ${step} (${stepName})`);

    // Save or update onboarding progress
    // We'll use the UserSettings table to store onboarding progress
    await prisma.userSettings.upsert({
      where: { userId: user.id },
      update: {
        onboardingStep: `${step}_${stepName}`,
        // Store the flow data in a JSON field if needed (for future restoration)
        updatedAt: new Date()
      },
      create: {
        userId: user.id,
        onboardingStep: `${step}_${stepName}`,
        // Other default settings
        autonomyLevel: 0,
        replyScope: 'ALL_SENDERS',
        enablePushNotifications: true,
        preferencesSaved: true,
        newOnboardingCompleted: false,
        autoFileLowPriority: 50,
        autoSendConfidence: 95,
        // Calendar preferences default to PST until user updates in settings
        calendarTimezone: DEFAULT_CALENDAR_TIMEZONE,
        calendarContextCalendarIds: [],
      }
    });

    // Optionally, save detailed progress data to a separate table or JSON field
    // For now, we'll keep it simple and just track the current step

    return NextResponse.json({
      success: true,
      message: 'Onboarding progress saved',
      currentStep: step,
      stepName
    });

  } catch (error) {
    console.error('[ONBOARDING PROGRESS] Error saving progress:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to save onboarding progress',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

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

    console.log(`[ONBOARDING PROGRESS] Loading progress for user ${user.id}`);

    // Get current onboarding progress
    const userSettings = await prisma.userSettings.findUnique({
      where: { userId: user.id },
      select: {
        onboardingStep: true,
        newOnboardingCompleted: true
      }
    });

    if (!userSettings) {
      return NextResponse.json({
        success: true,
        currentStep: 0,
        stepName: 'Greeting',
        completed: false
      });
    }

    // Parse step information
    let currentStep = 0;
    let stepName = 'Greeting';
    
    if (userSettings.onboardingStep) {
      const [stepNumber, stepNameFromDb] = userSettings.onboardingStep.split('_');
      currentStep = parseInt(stepNumber) || 0;
      stepName = stepNameFromDb || 'Greeting';
    }

    return NextResponse.json({
      success: true,
      currentStep,
      stepName,
      completed: userSettings.newOnboardingCompleted || false
    });

  } catch (error) {
    console.error('[ONBOARDING PROGRESS] Error loading progress:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to load onboarding progress',
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

    console.log(`[ONBOARDING PROGRESS] Resetting progress for user ${user.id}`);

    // Reset onboarding progress
    await prisma.userSettings.update({
      where: { userId: user.id },
      data: {
        onboardingStep: null,
        newOnboardingCompleted: false
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Onboarding progress reset'
    });

  } catch (error) {
    console.error('[ONBOARDING PROGRESS] Error resetting progress:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to reset onboarding progress',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}