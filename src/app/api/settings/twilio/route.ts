import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';

/**
 * E.164 phone number format regex:
 * - Starts with +
 * - Followed by 1-3 digit country code
 * - Then 4-14 more digits (total 7-15 digits after +)
 */
const E164_REGEX = /^\+[1-9]\d{6,14}$/;

/**
 * GET /api/settings/twilio
 * Returns the user's Twilio SMS/RCS integration settings
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const settings = await prisma.userSettings.findUnique({
      where: { userId: session.userId },
      select: {
        twilioPhoneNumber: true,
        twilioVerified: true,
      },
    });

    // Return empty/default state if no settings exist
    if (!settings) {
      return NextResponse.json({
        success: true,
        settings: {
          twilioPhoneNumber: null,
          twilioVerified: false,
        },
      });
    }

    return NextResponse.json({
      success: true,
      settings: {
        twilioPhoneNumber: settings.twilioPhoneNumber,
        twilioVerified: settings.twilioVerified,
      },
    });
  } catch (error) {
    console.error('[Twilio Settings] Error fetching settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch Twilio settings' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/settings/twilio
 * Updates the user's Twilio phone number
 * Automatically sets twilioVerified to false when phone number changes
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { twilioPhoneNumber } = body;

    // Allow clearing the phone number (null or empty string)
    const normalizedPhoneNumber = twilioPhoneNumber?.trim() || null;

    // Validate E.164 format if a phone number is provided
    if (normalizedPhoneNumber && !E164_REGEX.test(normalizedPhoneNumber)) {
      return NextResponse.json(
        {
          error: 'Invalid phone number format. Please use E.164 format (e.g., +16505551234)',
        },
        { status: 400 }
      );
    }

    // Upsert the settings (create if doesn't exist, update if exists)
    const updatedSettings = await prisma.userSettings.upsert({
      where: { userId: session.userId },
      update: {
        twilioPhoneNumber: normalizedPhoneNumber,
        // Reset verification when phone number changes
        twilioVerified: false,
      },
      create: {
        userId: session.userId,
        twilioPhoneNumber: normalizedPhoneNumber,
        twilioVerified: false,
      },
      select: {
        twilioPhoneNumber: true,
        twilioVerified: true,
      },
    });

    console.log(
      `[Twilio Settings] Updated phone number for user ${session.userId}: ${normalizedPhoneNumber ? normalizedPhoneNumber.slice(0, 4) + '***' : 'cleared'}`
    );

    return NextResponse.json({
      success: true,
      message: normalizedPhoneNumber
        ? 'Twilio phone number saved successfully'
        : 'Twilio phone number cleared',
      settings: {
        twilioPhoneNumber: updatedSettings.twilioPhoneNumber,
        twilioVerified: updatedSettings.twilioVerified,
      },
    });
  } catch (error) {
    console.error('[Twilio Settings] Error updating settings:', error);
    return NextResponse.json(
      { error: 'Failed to update Twilio settings' },
      { status: 500 }
    );
  }
}
