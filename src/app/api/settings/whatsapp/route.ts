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
 * GET /api/settings/whatsapp
 * Returns the user's WhatsApp integration settings
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
        whatsappPhoneNumber: true,
        whatsappVerified: true,
      },
    });

    // Return empty/default state if no settings exist
    if (!settings) {
      return NextResponse.json({
        success: true,
        settings: {
          whatsappPhoneNumber: null,
          whatsappVerified: false,
        },
      });
    }

    return NextResponse.json({
      success: true,
      settings: {
        whatsappPhoneNumber: settings.whatsappPhoneNumber,
        whatsappVerified: settings.whatsappVerified,
      },
    });
  } catch (error) {
    console.error('[WhatsApp Settings] Error fetching settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch WhatsApp settings' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/settings/whatsapp
 * Updates the user's WhatsApp phone number
 * Automatically sets whatsappVerified to false when phone number changes
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { whatsappPhoneNumber } = body;

    // Allow clearing the phone number (null or empty string)
    const normalizedPhoneNumber = whatsappPhoneNumber?.trim() || null;

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
        whatsappPhoneNumber: normalizedPhoneNumber,
        // Reset verification when phone number changes
        whatsappVerified: false,
      },
      create: {
        userId: session.userId,
        whatsappPhoneNumber: normalizedPhoneNumber,
        whatsappVerified: false,
      },
      select: {
        whatsappPhoneNumber: true,
        whatsappVerified: true,
      },
    });

    console.log(
      `[WhatsApp Settings] Updated phone number for user ${session.userId}: ${normalizedPhoneNumber ? normalizedPhoneNumber.slice(0, 4) + '***' : 'cleared'}`
    );

    return NextResponse.json({
      success: true,
      message: normalizedPhoneNumber
        ? 'WhatsApp phone number saved successfully'
        : 'WhatsApp phone number cleared',
      settings: {
        whatsappPhoneNumber: updatedSettings.whatsappPhoneNumber,
        whatsappVerified: updatedSettings.whatsappVerified,
      },
    });
  } catch (error) {
    console.error('[WhatsApp Settings] Error updating settings:', error);
    return NextResponse.json(
      { error: 'Failed to update WhatsApp settings' },
      { status: 500 }
    );
  }
}
