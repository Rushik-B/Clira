import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { ReplyGeneratorService } from '@/lib/services/core/replyGenerator';
import { createGmailServiceForUser } from '@/lib/security/getUserGmailCredentials';
import { encryptThreadContent, encryptEmailContent, decryptEmailContent } from '@/lib/security/emailCrypto';
import { randomUUID } from 'crypto';
import { devOnlyGuard } from '@/lib/utils/devOnly';

export async function POST(req: Request) {
  const devBlock = devOnlyGuard();
  if (devBlock) return devBlock;

  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const emailData = await req.json();

    // Find user to associate the email with
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Find or create thread
    let thread = await prisma.thread.findFirst({
      where: {
        userId: user.id,
        subject: emailData.subject,
      },
    });

    if (!thread) {
      const threadContent = {
        subject: emailData.subject,
        snippet: emailData.body.substring(0, 100),
      };
      const encryptedThread = await encryptThreadContent({
        userId: user.id,
        data: threadContent,
      });
      thread = await prisma.thread.create({
        data: {
          userId: user.id,
          subject: '',
          snippet: '',
          ...encryptedThread,
        },
      });
    }

    const emailContent = {
      subject: emailData.subject,
      body: emailData.body,
      from: emailData.from,
      to: [emailData.to],
      cc: emailData.cc ? emailData.cc.split(',').map((s: string) => s.trim()) : [],
      snippet: emailData.body.substring(0, 100),
    };

    const encryptedEmail = await encryptEmailContent({
      userId: user.id,
      data: emailContent,
    });

    const createdEmail = await prisma.email.create({
      data: {
        threadId: thread.id,
        messageId: `${randomUUID()}@test.clira.com`,
        isSent: false, // It's an incoming email
        isDraft: false,
        from: '',
        subject: '',
        body: '',
        snippet: '',
        to: [],
        cc: [],
        ...encryptedEmail,
      },
      include: { thread: true },
    });

    let savedEmail = await decryptEmailContent({ email: createdEmail, userId: user.id });
    
    console.log(`📝 Test email saved to DB with ID: ${savedEmail.id}`);

    // Generate reply
    try {
      const replyGenerator = new ReplyGeneratorService();
      console.log(`🤖 Generating reply for test email ${savedEmail.id}...`);
      const generatedReply = await replyGenerator.generateReply({
        userId: session.userId,
        gmailMessageId: savedEmail.messageId, // Use stored messageId for potential label application
        currentLabelIds: [], // Labels not tracked in test endpoint
        incomingEmail: {
          from: savedEmail.from,
          to: savedEmail.to,
          subject: savedEmail.subject,
          body: savedEmail.body,
          date: savedEmail.createdAt,
        },
      });

      if (generatedReply.reply) {
        const trimmed = generatedReply.reply.trim();
        const isApology = /unable to generate a reply|please try again later|system is still setting up/i.test(trimmed);

        if (trimmed.length === 0 || generatedReply.confidence <= 0 || isApology) {
          console.warn(`⚠️ Generated reply invalid for test email ${savedEmail.id}; skipping persistence`);
          return NextResponse.json({
            success: false,
            message: 'Generated reply invalid or empty; nothing persisted.',
          });
        }

        let gmailDraftId: string | null = null;

        if (process.env.FEATURE_FLAG_GMAIL_DRAFTS === 'false') {
          console.warn(`🚫 Gmail drafts feature flag disabled; cannot persist reply for test email ${savedEmail.id}`);
        } else {
          const gmailResult = await createGmailServiceForUser({
            userId: session.userId,
            purpose: 'test-email:create-draft',
            requester: 'api.test-email.POST',
          });

          if (!gmailResult) {
            console.warn(`⚠️ No OAuth token found for user ${session.userId}, skipping draft creation`);
          } else {
            try {
              const draftResult = await gmailResult.gmail.createDraftReply({
                to: savedEmail.from,
                cc: generatedReply.ccRecipients || [],
                subject: savedEmail.subject.startsWith('Re: ') ? savedEmail.subject : `Re: ${savedEmail.subject}`,
                body: trimmed,
                inReplyTo: undefined,
                references: undefined,
                threadId: undefined,
                labelIds: undefined, // No dedicated AI label for test drafts
              });

              gmailDraftId = draftResult.draftId;
              console.log(`✅ Gmail draft created for test email ${savedEmail.id}: ${gmailDraftId}`);
            } catch (draftError) {
              console.warn(`⚠️ Gmail draft creation failed for test email ${savedEmail.id}:`, draftError);
            }
          }
        }

        if (gmailDraftId) {
          await prisma.generatedDraft.upsert({
            where: { emailId: savedEmail.id },
            update: {
              gmailDraftId,
              confidenceScore: generatedReply.confidence,
              createdBy: 'AI',
              updatedAt: new Date(),
            },
            create: {
              emailId: savedEmail.id,
              gmailDraftId,
              confidenceScore: generatedReply.confidence,
              createdBy: 'AI',
            },
          });
          console.log(`✅ Draft metadata saved for test email ${savedEmail.id}`);

          if (generatedReply.contextualInfo?.emailSummary) {
            try {
              const snippetUpdate = await encryptEmailContent({
                userId: user.id,
                data: { snippet: generatedReply.contextualInfo.emailSummary },
              });

              await prisma.email.update({
                where: { id: savedEmail.id },
                data: snippetUpdate,
              });

              savedEmail = {
                ...savedEmail,
                snippet: generatedReply.contextualInfo.emailSummary,
              };
            } catch (e) {
              console.warn(`⚠️ Failed to store email summary to snippet for test email ${savedEmail.id}:`, e);
            }
          }
        } else {
          console.warn(`⚠️ Skipping draft persistence for test email ${savedEmail.id} because no Gmail draft was created`);
        }
      }
    } catch (replyError) {
      console.error(`❌ Error generating reply for test email:`, replyError);
      // Don't fail the whole request, just log the error
    }

    return NextResponse.json({ success: true, message: 'Test email received and processed.' });
  } catch (error) {
    console.error('❌ Error in test-email endpoint:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET() {
  const devBlock = devOnlyGuard();
  if (devBlock) return devBlock;

  return NextResponse.json({
    endpoint: 'Test Email Simulation',
    description: 'Simulates receiving emails for testing the email processing pipeline',
    usage: {
      method: 'POST',
      requiredFields: ['from', 'subject', 'body'],
      optionalFields: ['to'],
      example: {
        from: 'test@example.com',
        to: 'your-email@gmail.com',
        subject: 'Test Subject',
        body: 'This is a test email body for testing the email processing pipeline.'
      }
    }
  });
} 
