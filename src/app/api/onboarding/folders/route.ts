import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { createGmailServiceForUser } from '@/lib/security/getUserGmailCredentials';
import { normalizeGmailLabelColor } from '@/lib/gmail/labelColors';

/**
 * GET /api/onboarding/folders
 * Returns the working folder set plus fresh examples so the onboarding flow can
 * render cards that match the latest routing decisions.
 */
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

    // Get user's existing labels (if any have been created by LLM)
    const existingLabels = await prisma.label.findMany({
      where: {
        userId: user.id
      },
      orderBy: {
        name: 'asc'
      }
    });

    // If no labels exist yet, return empty array - they will be created by LLM during folder generation
    if (existingLabels.length === 0) {
      return NextResponse.json({
        success: true,
        folders: []
      });
    }

    const folders = existingLabels;
    
    // Get real email examples for each folder
    const foldersWithExamples = await Promise.all(
      folders.map(async (folder) => {
        // Get some sample emails that could match this folder
        const emailExamples = await getEmailExamplesForFolder(user.id, folder.name);
        
        return {
          id: folder.id,
          name: folder.name,
          color: folder.color,
          description: getDefaultFolderDescription(folder.name),
          icon: getDefaultFolderIcon(folder.name),
          metaPrompt: folder.metaPrompt,
          examples: emailExamples,
          systemLocked: folder.systemLocked,
          isSystemDefault: folder.isSystemDefault
        };
      })
    );

    return NextResponse.json({
      success: true,
      folders: foldersWithExamples
    });

  } catch (error) {
    console.error('Error fetching onboarding folders:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to fetch onboarding folders' 
    }, { status: 500 });
  }
}

/**
 * POST /api/onboarding/folders
 * Persists folder edits and custom additions from the onboarding wizard, then
 * provisions matching Gmail labels before marking the flow as complete.
 */
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
    const { folders, customFolders } = body;

    if (!Array.isArray(folders)) {
      return NextResponse.json({ 
        error: 'Invalid request body - folders must be an array' 
      }, { status: 400 });
    }

    // Update folder metadata
    for (const folderData of folders) {
      if (folderData.id && folderData.metaPrompt) {
        await prisma.label.update({
          where: { 
            id: folderData.id,
            userId: user.id
          },
          data: { metaPrompt: folderData.metaPrompt }
        });
      }
      
      if (folderData.id && folderData.name) {
        await prisma.label.update({
          where: { 
            id: folderData.id,
            userId: user.id
          },
          data: { name: folderData.name }
        });
      }
    }

    // Create custom folders if any
    if (customFolders && Array.isArray(customFolders)) {
      for (const customFolder of customFolders) {
        await prisma.label.create({
          data: {
            userId: user.id,
            name: customFolder.name,
            color: customFolder.color,
            metaPrompt: customFolder.metaPrompt || `Emails related to ${customFolder.name}`,
            systemLocked: false,
            isSystemDefault: false,
            isCustom: true,
            isSystemLabel: false,
            emailCount: 0,
            exampleEmails: []
          }
        });
      }
    }

    // Create Gmail labels for all folders
    await createGmailLabelsForUser(user.id);

    // Mark onboarding as complete
    await prisma.user.update({
      where: { id: user.id },
      data: { 
        labelingOnboardingGenerated: true 
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Folder configuration saved successfully'
    });

  } catch (error) {
    console.error('Error saving onboarding folders:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to save onboarding folders' 
    }, { status: 500 });
  }
}

// Helper function to get email examples for a folder
async function getEmailExamplesForFolder(userId: string, folderName: string): Promise<any[]> {
  try {
    // Get user's OAuth credentials
    const gmailResult = await createGmailServiceForUser({
      userId,
      purpose: 'onboarding:folders-examples',
      requester: 'api.onboarding.folders.getEmailExamplesForFolder',
    });

    if (!gmailResult) {
      return [];
    }

    // Initialize Gmail service
    const gmailService = gmailResult.gmail;

    // Search for emails that might match this folder
    const searchQueries = getSearchQueriesForFolder(folderName);
    const examples: any[] = [];

    for (const query of searchQueries) {
      try {
        const emails = await gmailService.searchEmails(query, 3);
        
        for (const email of emails) {
          const from = email.payload?.headers?.find(h => h.name === 'From')?.value || '';
          const subject = email.payload?.headers?.find(h => h.name === 'Subject')?.value || '';
          
          examples.push({
            from: from.split('<')[0].trim() || from,
            subject,
            snippet: email.snippet || ''
          });
          
          if (examples.length >= 2) break;
        }
        
        if (examples.length >= 2) break;
      } catch (error) {
        console.error(`Error searching for ${folderName} examples:`, error);
      }
    }

    return examples.slice(0, 2);
  } catch (error) {
    console.error('Error getting email examples:', error);
    return [];
  }
}

// Helper function to get search queries for different folder types
function getSearchQueriesForFolder(folderName: string): string[] {
  switch (folderName.toLowerCase()) {
    case 'newsletters':
      return ['unsubscribe', 'newsletter', 'from:newsletter@', 'from:news@'];
    case 'finance':
      return ['receipt', 'invoice', 'payment', 'from:paypal', 'from:stripe'];
    case 'personal':
      return ['from:gmail.com', 'from:yahoo.com', 'from:outlook.com'];
    case 'notifications':
      return ['verify', 'confirm', 'security', 'alert', 'from:noreply'];
    case 'travel':
      return ['booking', 'flight', 'hotel', 'reservation', 'itinerary'];
    case 'work':
      return ['meeting', 'project', 'deadline', 'team'];
    default:
      return ['in:inbox'];
  }
}

// Helper function to get default folder descriptions
function getDefaultFolderDescription(folderName: string): string {
  const descriptions: Record<string, string> = {
    'Newsletters': 'Marketing emails, promos, subscriptions, and promotional content',
    'Notifications': 'Automated alerts from services, social networks, and system notifications',
    'Financials': 'Receipts, invoices, bank statements, and payment confirmations',
    'Travel': 'Flight confirmations, hotel bookings, itineraries, and travel updates',
    'Action Needed': 'Emails explicitly requesting action, responses, or decisions',
    'Review': 'Anything the system is uncertain about (manual review required)'
  };
  return descriptions[folderName] || 'Smart email organization';
}

// Helper function to get default folder icons
function getDefaultFolderIcon(folderName: string): string {
  const icons: Record<string, string> = {
    'Newsletters': '📧',
    'Notifications': '🔔',
    'Financials': '💰',
    'Travel': '✈️',
    'Action Needed': '👀',
    'Review': '📋'
  };
  return icons[folderName] || '📁';
}

// Helper function to create Gmail labels
async function createGmailLabelsForUser(userId: string): Promise<void> {
  try {
    // Get user's OAuth credentials
    const gmailResult = await createGmailServiceForUser({
      userId,
      purpose: 'onboarding:folders-create-labels',
      requester: 'api.onboarding.folders.createGmailLabelsForUser',
    });

    if (!gmailResult) {
      console.log('No OAuth account found for user');
      return;
    }

    // Initialize Gmail service
    const gmailService = gmailResult.gmail;

    // Get user's labels that don't have Gmail label IDs
    const labels = await prisma.label.findMany({
      where: {
        userId,
        gmailLabelId: null
      }
    });

    // Create Gmail labels
    for (const label of labels) {
      try {
        const { backgroundColor, textColor } = normalizeGmailLabelColor(label.color);
        const gmailLabelId = await gmailService.createLabel(
          label.name,
          'labelShow',
          'show',
          backgroundColor,
          textColor
        );

        // Update the label with Gmail ID and ensure stored color matches Gmail
        await prisma.label.update({
          where: { id: label.id },
          data: {
            gmailLabelId,
            color: backgroundColor
          }
        });
        
        console.log(`Created Gmail label "${label.name}" with ID: ${gmailLabelId}`);
      } catch (error) {
        console.error(`Error creating Gmail label for "${label.name}":`, error);
      }
    }
  } catch (error) {
    console.error('Error creating Gmail labels:', error);
  }
}
