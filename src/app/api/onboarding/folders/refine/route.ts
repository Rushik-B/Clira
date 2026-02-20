import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { PromptRefinerService } from '@/lib/ml/promptRefinerService';
import { createGmailServiceForUser } from '@/lib/security/getUserGmailCredentials';

/**
 * POST /api/onboarding/folders/refine
 * Refines a draft folder rule with LLM guidance so the onboarding UI can give
 * instant feedback on the user's adjustments.
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
    const { folderName, userDraft, examples, existingFolders } = body;

    if (!folderName || !userDraft) {
      return NextResponse.json({ 
        error: 'Missing required fields: folderName and userDraft' 
      }, { status: 400 });
    }

    // Initialize the prompt refiner service
    const promptRefiner = new PromptRefinerService();

    // Refine the user's draft rule
    const refinementResult = await promptRefiner.refinePrompt({
      folderName,
      userDraft,
      examples: examples || [],
      existingFolders: existingFolders || []
    });

    return NextResponse.json({
      success: true,
      refinement: refinementResult
    });

  } catch (error) {
    console.error('Error refining folder prompt:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to refine folder prompt' 
    }, { status: 500 });
  }
}

/**
 * GET /api/onboarding/folders/refine
 * Hydrates the editor with the latest folder metadata and example emails so
 * users can iterate on routing logic without guessing.
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

    const { searchParams } = new URL(request.url);
    const folderId = searchParams.get('folderId');
    const folderName = searchParams.get('folderName');

    if (!folderId && !folderName) {
      return NextResponse.json({ 
        error: 'Missing required parameter: folderId or folderName' 
      }, { status: 400 });
    }

    // Get the specific folder
    let folder;
    if (folderId) {
      folder = await prisma.label.findUnique({
        where: { 
          id: folderId,
          userId: user.id
        }
      });
    } else if (folderName) {
      folder = await prisma.label.findFirst({
        where: { 
          name: folderName,
          userId: user.id
        }
      });
    }

    if (!folder) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
    }

    // Get email examples for this folder based on its current rule
    const emailExamples = await getEmailExamplesForFolder(user.id, folder);

    return NextResponse.json({
      success: true,
      folder: {
        id: folder.id,
        name: folder.name,
        color: folder.color,
        metaPrompt: folder.metaPrompt,
        examples: emailExamples
      }
    });

  } catch (error) {
    console.error('Error fetching folder for refinement:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to fetch folder details' 
    }, { status: 500 });
  }
}

// Helper function to get relevant email examples for a folder
async function getEmailExamplesForFolder(userId: string, folder: any): Promise<any[]> {
  try {
    // First try to get examples from the folder's stored examples
    if (folder.exampleEmails && Array.isArray(folder.exampleEmails) && folder.exampleEmails.length > 0) {
      return folder.exampleEmails.slice(0, 5);
    }

    // If no stored examples, try to fetch from Gmail using the folder's meta-prompt
    const gmailResult = await createGmailServiceForUser({
      userId,
      purpose: 'onboarding:folders-refine-examples',
      requester: 'api.onboarding.folders.refine.getEmailExamplesForFolder',
    });

    if (!gmailResult) {
      return [];
    }

    // Use EmailRouter to find emails that might match this folder
    const { EmailRouterService } = await import('@/lib/email/emailRouterService');
    const emailRouter = new EmailRouterService();

    // Get recent emails and see which ones would route to this folder
    const gmailService = gmailResult.gmail;

    // Get a small sample of recent emails
    const recentEmails = await gmailService.searchEmails('in:inbox', 20);
    const emailsToRoute = recentEmails.map(email => {
      const e: any = email;
      return {
        gmailMessageId: e.id || e.gmailMessageId || e.messageId,
        gmailThreadId: e.threadId || e.gmailThreadId,
        from: e.payload?.headers?.find((h: any) => h.name === 'From')?.value || e.from || '',
        subject: e.payload?.headers?.find((h: any) => h.name === 'Subject')?.value || e.subject || '',
        snippet: e.snippet || '',
        labels: e.labelIds || []
      }
    });

    // Route emails and find ones that would go to this folder
    const routingResult = await emailRouter.routeEmails({
      userId,
      emails: emailsToRoute
    });

    // Find emails that were routed to this folder
    const matchingEmails = routingResult.results
      .filter(result => result.decision.labelId === folder.id)
      .map(result => {
        const originalEmail = emailsToRoute.find(e => e.gmailMessageId === result.emailId);
        return originalEmail ? {
          from: originalEmail.from.split('<')[0].trim() || originalEmail.from,
          subject: originalEmail.subject,
          snippet: originalEmail.snippet
        } : null;
      })
      .filter(Boolean)
      .slice(0, 5);

    return matchingEmails;

  } catch (error) {
    console.error('Error getting email examples for folder:', error);
    return [];
  }
}
