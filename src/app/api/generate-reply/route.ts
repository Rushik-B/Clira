import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { ReplyGeneratorService, IncomingEmailData } from '@/lib/services/core/replyGenerator';

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session || !session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const {
      incomingEmail,
      mailboxId,
      mailboxEmail,
    }: { incomingEmail: IncomingEmailData; mailboxId?: string; mailboxEmail?: string } = body;

    // Validate required fields
    if (!incomingEmail || !incomingEmail.from || !incomingEmail.subject || !incomingEmail.body) {
      return NextResponse.json({ 
        error: 'Missing required fields: from, subject, body' 
      }, { status: 400 });
    }

    console.log(`🚀 Enhanced reply generation request from user ${session.userId} for email from ${incomingEmail.from}`);

    // Initialize enhanced reply generator service
    const replyGenerator = new ReplyGeneratorService();

    // Generate reply using the new two-stage enhanced flow
    const result = await replyGenerator.generateReply({
      userId: session.userId,
      mailboxId,
      mailboxEmail,
      // Test/demo endpoint - no gmailMessageId available, labels won't be applied
      gmailMessageId: undefined,
      currentLabelIds: undefined,
      incomingEmail: {
        ...incomingEmail,
        date: incomingEmail.date ? new Date(incomingEmail.date) : new Date()
      }
    });

    console.log(`✨ Enhanced reply generated - Style confidence: ${result.confidence}%, Context confidence: ${result.contextualInfo?.contextConfidence}%`);

    return NextResponse.json({
      success: true,
      reply: result.reply,
      confidence: result.confidence,
      reasoning: result.reasoning,
      contextualInfo: result.contextualInfo ? {
        calendarUsed: result.contextualInfo.calendarUsed,
        emailsAnalyzed: result.contextualInfo.emailsAnalyzed,
        suggestedActions: result.contextualInfo.suggestedActions,
        contextConfidence: result.contextualInfo.contextConfidence
      } : null,
      timestamp: new Date().toISOString(),
      version: 'v4-enhanced'
    });

  } catch (error) {
    console.error('Error in enhanced generate-reply API:', error);
    return NextResponse.json({ 
      error: 'Failed to generate reply',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// GET endpoint to test the enhanced service
export async function GET() {
  return NextResponse.json({
    message: 'Enhanced Reply Generation API v4 is running',
    features: [
      'Contextual email analysis and fetching',
      'Google Calendar integration',
      'Two-stage generation (context + style)',
      'Enhanced style analysis',
      'Suggested actions'
    ],
    endpoints: {
      POST: '/api/generate-reply - Generate an enhanced reply for an incoming email'
    },
    requiredFields: [
      'incomingEmail.from',
      'incomingEmail.subject', 
      'incomingEmail.body',
      'incomingEmail.to (optional)',
      'incomingEmail.date (optional)'
    ],
    newResponseFields: [
      'contextualInfo.calendarUsed',
      'contextualInfo.emailsAnalyzed',
      'contextualInfo.suggestedActions',
      'contextualInfo.contextConfidence'
    ]
  });
} 
