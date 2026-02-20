import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { LLMService } from '@/lib/ml/llm';
import { prisma } from '@/lib/prisma';
import { createGmailServiceForUser } from '@/lib/security/getUserGmailCredentials';

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

    // Get user's OAuth credentials
    const gmailResult = await createGmailServiceForUser({
      userId: user.id,
      purpose: 'onboarding:llm-folders-fetch',
      requester: 'api.onboarding.llm-folders.generate.POST',
    });

    if (!gmailResult) {
      return NextResponse.json({ 
        error: 'Gmail account not connected. Please reconnect your Google account.' 
      }, { status: 400 });
    }

    // Initialize Gmail service
    const gmailService = gmailResult.gmail;

    // Get emails for analysis (no date restriction, max 100 emails)
    console.log('📧 Fetching emails for folder generation...');
    const emailMessages = await gmailService.searchEmails('', 100);

    if (emailMessages.length === 0) {
      return NextResponse.json({ 
        error: 'No emails found to analyze. Please ensure you have emails in your inbox.' 
      }, { status: 400 });
    }

    // Process emails and extract metadata
    const recentEmails = [];
    const senderCounts: Record<string, { count: number; domains: string[]; keywords: string[] }> = {};

    for (const message of emailMessages) {
      try {
        const headers = message.payload?.headers || [];
        const fromHeader = headers.find(h => h.name === 'From')?.value || '';
        const subjectHeader = headers.find(h => h.name === 'Subject')?.value || '';
        const toHeader = headers.find(h => h.name === 'To')?.value || '';
        const dateHeader = headers.find(h => h.name === 'Date')?.value;

        // Extract email address from "Name <email@domain.com>" format
        const emailMatch = fromHeader.match(/<([^>]+)>/) || fromHeader.match(/([^\s<>]+@[^\s<>]+)/);
        const fromEmail = emailMatch ? emailMatch[1] : fromHeader;
        
        if (!fromEmail || !subjectHeader) continue;

        // Get email body (simplified extraction)
        let bodyText = message.snippet || '';
        if (message.payload?.body?.data) {
          try {
            bodyText = Buffer.from(message.payload.body.data, 'base64').toString('utf-8');
          } catch (e) {
            // Use snippet as fallback
            bodyText = message.snippet || '';
          }
        }

        const emailDate = dateHeader ? new Date(dateHeader) : new Date();
        const toEmails = toHeader ? toHeader.split(',').map(email => email.trim()) : [session.user.email!];

        recentEmails.push({
          from: fromEmail,
          to: toEmails,
          subject: subjectHeader,
          body: bodyText.substring(0, 500), // Limit body length for analysis
          date: emailDate
        });

        // Track sender patterns
        const domain = fromEmail.split('@')[1] || '';
        const keywords = subjectHeader.toLowerCase().split(/\s+/).filter(word => word.length > 3);

        if (!senderCounts[fromEmail]) {
          senderCounts[fromEmail] = { count: 0, domains: [], keywords: [] };
        }
        senderCounts[fromEmail].count++;
        if (domain && !senderCounts[fromEmail].domains.includes(domain)) {
          senderCounts[fromEmail].domains.push(domain);
        }
        senderCounts[fromEmail].keywords.push(...keywords.slice(0, 3)); // Top 3 keywords per email

      } catch (error) {
        console.error('Error processing email:', error);
        continue;
      }
    }

    console.log(`✅ Processed ${recentEmails.length} emails for analysis`);

    if (recentEmails.length === 0) {
      return NextResponse.json({ 
        error: 'No valid emails found to analyze. Please check your email permissions.' 
      }, { status: 400 });
    }

    // Initialize LLM service and generate folders
    console.log('🤖 Generating smart folders with LLM...');
    const llmService = new LLMService();
    
    const folderGeneration = await llmService.generateFoldersFromEmails(
      recentEmails,
      senderCounts
    );

    console.log(`✅ Generated ${folderGeneration.suggestedFolders.length} smart folders`);

    return NextResponse.json({
      success: true,
      folderGeneration,
      emailsAnalyzed: recentEmails.length,
      totalSenders: Object.keys(senderCounts).length
    });

  } catch (error) {
    console.error('Error generating LLM folders:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to generate folders'
    }, { status: 500 });
  }
}
