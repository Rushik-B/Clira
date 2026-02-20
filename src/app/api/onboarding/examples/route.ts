import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { createGmailServiceForUser } from '@/lib/security/getUserGmailCredentials';
import { parseBoundedInt } from '@/lib/utils/params';

/**
 * GET /api/onboarding/examples
 * Pulls a small, human-friendly sample of emails for one folder concept so the
 * onboarding flow can show realistic training examples.
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
    const folderName = searchParams.get('folderName');
    const countResult = parseBoundedInt('count', searchParams.get('count'), { defaultValue: 3, min: 1, max: 10 });
    if (!countResult.ok) {
      return NextResponse.json({ error: countResult.error }, { status: 400 });
    }

    const count = countResult.value;

    if (!folderName) {
      return NextResponse.json({ 
        error: 'Missing required parameter: folderName' 
      }, { status: 400 });
    }

    // Get email examples for the specified folder
    const examples = await getEmailExamplesForFolder(user.id, folderName, count);

    return NextResponse.json({
      success: true,
      folderName,
      examples,
      count: examples.length
    });

  } catch (error) {
    console.error('Error fetching email examples:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to fetch email examples' 
    }, { status: 500 });
  }
}

/**
 * POST /api/onboarding/examples
 * Bulk variant that fetches examples for many folder names in one network hop,
 * keeping the onboarding preview responsive.
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
    const { folders } = body;

    if (!Array.isArray(folders)) {
      return NextResponse.json({ 
        error: 'Invalid request body - folders must be an array' 
      }, { status: 400 });
    }

    // Get email examples for multiple folders
    const foldersWithExamples = await Promise.all(
      folders.map(async (folderName: string) => {
        const examples = await getEmailExamplesForFolder(user.id, folderName, 3);
        return {
          folderName,
          examples
        };
      })
    );

    return NextResponse.json({
      success: true,
      folders: foldersWithExamples
    });

  } catch (error) {
    console.error('Error fetching multiple folder examples:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to fetch folder examples' 
    }, { status: 500 });
  }
}

// Helper function to get email examples for a specific folder type
async function getEmailExamplesForFolder(
  userId: string, 
  folderName: string, 
  count: number = 3
): Promise<any[]> {
  try {
    // Get user's OAuth credentials
    const gmailResult = await createGmailServiceForUser({
      userId,
      purpose: 'onboarding:examples-folder',
      requester: 'api.onboarding.examples.getEmailExamplesForFolder',
    });

    if (!gmailResult) {
      return [];
    }

    // Initialize Gmail service
    const gmailService = gmailResult.gmail;

    // Get search queries specific to this folder type
    const searchQueries = getSearchQueriesForFolder(folderName);
    const examples: any[] = [];

    // Try each search query until we get enough examples
    for (const query of searchQueries) {
      if (examples.length >= count) break;
      
      try {
        const emails = await gmailService.searchEmails(query, 5);
        
        for (const email of emails) {
          if (examples.length >= count) break;
          
          const emailAny: any = email;
          const from = emailAny.payload?.headers?.find((h: any) => h.name === 'From')?.value || email.from || '';
          const subject = emailAny.payload?.headers?.find((h: any) => h.name === 'Subject')?.value || email.subject || '';
          const date = emailAny.payload?.headers?.find((h: any) => h.name === 'Date')?.value || email.date?.toString() || '';
          
          // Clean up the from field
          const cleanFrom = from.split('<')[0].trim() || from.split('@')[0] || from;
          
          // Avoid duplicates
          const isDuplicate = examples.some(ex => 
            ex.subject === subject || ex.from === cleanFrom
          );
          
          if (!isDuplicate && subject && cleanFrom) {
            examples.push({
              from: cleanFrom,
              subject,
              snippet: email.snippet || '',
              date: date ? new Date(date).toLocaleDateString() : 'Recent',
              confidence: calculateMatchConfidence(folderName, { from: cleanFrom, subject, snippet: email.snippet || '' })
            });
          }
        }
      } catch (error) {
        console.error(`Error searching with query "${query}":`, error);
      }
    }

    // Sort by confidence and return top matches
    return examples
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, count);

  } catch (error) {
    console.error('Error getting email examples for folder:', error);
    return [];
  }
}

// Helper function to get search queries for different folder types
function getSearchQueriesForFolder(folderName: string): string[] {
  const name = folderName.toLowerCase();
  
  switch (name) {
    case 'newsletters':
      return [
        'unsubscribe',
        'newsletter',
        'digest',
        'from:newsletter@',
        'from:news@',
        'from:marketing@',
        'promotional',
        'campaign'
      ];
      
    case 'finance':
      return [
        'receipt',
        'invoice',
        'payment',
        'billing',
        'from:paypal',
        'from:stripe',
        'from:square',
        'bank statement',
        'transaction',
        'refund'
      ];
      
    case 'personal':
      return [
        'from:gmail.com',
        'from:yahoo.com',
        'from:outlook.com',
        'from:icloud.com',
        'birthday',
        'congratulations',
        'invitation'
      ];
      
    case 'notifications':
      return [
        'verify',
        'confirm',
        'security',
        'alert',
        'from:noreply',
        'from:no-reply',
        'password',
        'account',
        'verification'
      ];
      
    case 'travel':
      return [
        'booking',
        'reservation',
        'flight',
        'hotel',
        'itinerary',
        'check-in',
        'from:expedia',
        'from:booking.com',
        'confirmation'
      ];
      
    case 'work':
      return [
        'meeting',
        'project',
        'deadline',
        'team',
        'conference',
        'schedule',
        'collaborate',
        'office'
      ];
      
    default:
      return ['in:inbox newer_than:30d'];
  }
}

// Helper function to calculate how well an email matches a folder
function calculateMatchConfidence(folderName: string, email: { from: string; subject: string; snippet: string }): number {
  const name = folderName.toLowerCase();
  const text = `${email.from} ${email.subject} ${email.snippet}`.toLowerCase();
  
  let confidence = 0;
  
  switch (name) {
    case 'newsletters':
      if (text.includes('unsubscribe')) confidence += 40;
      if (text.includes('newsletter')) confidence += 30;
      if (text.includes('digest')) confidence += 25;
      if (text.includes('marketing')) confidence += 20;
      if (email.from.includes('news@') || email.from.includes('newsletter@')) confidence += 35;
      break;
      
    case 'finance':
      if (text.includes('receipt')) confidence += 35;
      if (text.includes('payment')) confidence += 30;
      if (text.includes('invoice')) confidence += 35;
      if (text.includes('paypal') || text.includes('stripe')) confidence += 40;
      if (text.includes('$') || text.includes('payment')) confidence += 20;
      break;
      
    case 'personal':
      if (email.from.includes('gmail.com') || email.from.includes('yahoo.com')) confidence += 25;
      if (text.includes('birthday') || text.includes('congratulations')) confidence += 30;
      if (!text.includes('noreply') && !text.includes('no-reply')) confidence += 15;
      break;
      
    case 'notifications':
      if (text.includes('verify') || text.includes('confirm')) confidence += 35;
      if (email.from.includes('noreply') || email.from.includes('no-reply')) confidence += 40;
      if (text.includes('security') || text.includes('alert')) confidence += 30;
      break;
      
    case 'travel':
      if (text.includes('booking') || text.includes('reservation')) confidence += 40;
      if (text.includes('flight') || text.includes('hotel')) confidence += 35;
      if (text.includes('itinerary') || text.includes('check-in')) confidence += 30;
      break;
      
    case 'work':
      if (text.includes('meeting') || text.includes('project')) confidence += 30;
      if (text.includes('deadline') || text.includes('team')) confidence += 25;
      if (text.includes('conference') || text.includes('schedule')) confidence += 20;
      break;
  }
  
  return Math.min(confidence, 100);
}
