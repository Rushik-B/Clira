import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { EmailFilterService } from '@/lib/email/emailFilterService';

const emailFilterService = new EmailFilterService();

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log(`📊 Fetching email filter settings for user: ${session.userId}`);

    let settings = await emailFilterService.getFilterSettings(session.userId);
    
    if (!settings) {
      console.log(`⚙️ No settings found, creating defaults for user: ${session.userId}`);
      
      // Create default settings
      settings = await emailFilterService.updateFilterSettings(session.userId, {
        replyScope: 'ALL_SENDERS',
        blockedSenders: [],
        allowedSenders: [],
        enablePushNotifications: true,
        preferencesSaved: false
      });
    }

    const isDefault = !settings.preferencesSaved;
    
    console.log(`📊 Returning settings - Default: ${isDefault}, Reply scope: ${settings.replyScope}`);

    return NextResponse.json({
      success: true,
      isDefault: isDefault,
      settings: {
        replyScope: settings.replyScope,
        blockedSenders: settings.blockedSenders || [],
        allowedSenders: settings.allowedSenders || [],
        enablePushNotifications: settings.enablePushNotifications ?? true
      }
    });

  } catch (error) {
    console.error('Error fetching email filter settings:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch settings' 
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      replyScope,
      blockedSenders,
      allowedSenders,
      enablePushNotifications
    } = body;

    console.log(`💾 Saving email filter settings for user: ${session.userId}`);
    console.log(`📝 Settings:`, { replyScope, blockedSenders, allowedSenders, enablePushNotifications });

    // Validate input
    const validReplyScopeValues = ['ALL_SENDERS', 'CONTACTS_ONLY'];

    if (replyScope && !validReplyScopeValues.includes(replyScope)) {
      return NextResponse.json({ 
        error: 'Invalid replyScope value' 
      }, { status: 400 });
    }

    // Validate arrays
    if (blockedSenders && !Array.isArray(blockedSenders)) {
      return NextResponse.json({ 
        error: 'blockedSenders must be an array' 
      }, { status: 400 });
    }

    if (allowedSenders && !Array.isArray(allowedSenders)) {
      return NextResponse.json({ 
        error: 'allowedSenders must be an array' 
      }, { status: 400 });
    }

    // Update settings and mark preferences as saved
    const updatedSettings = await emailFilterService.updateFilterSettings(session.userId, {
      replyScope,
      blockedSenders: blockedSenders || [],
      allowedSenders: allowedSenders || [],
      enablePushNotifications: enablePushNotifications ?? true,
      preferencesSaved: true,
    });

    console.log(`✅ Updated email filter settings for user ${session.userId}`);

    return NextResponse.json({
      success: true,
      message: 'Email filter settings updated successfully',
      settings: {
        replyScope: updatedSettings.replyScope,
        blockedSenders: updatedSettings.blockedSenders,
        allowedSenders: updatedSettings.allowedSenders,
        enablePushNotifications: updatedSettings.enablePushNotifications
      }
    });

  } catch (error) {
    console.error('Error updating email filter settings:', error);
    return NextResponse.json({ 
      error: 'Failed to update settings' 
    }, { status: 500 });
  }
} 