import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { EmailLearningService } from '@/lib/services/onboarding-services/emailLearningService';
import { createGmailServiceForUser } from '@/lib/security/getUserGmailCredentials';

interface EmailCorrectionRequest {
  emailSortId: string;
  targetFolderId: string;
  reason?: string;
  shouldLearn?: boolean;
  batchCorrections?: Array<{
    emailSortId: string;
    targetFolderId: string;
  }>;
}

interface EmailCorrectionResponse {
  success: boolean;
  message: string;
  correctedEmails: number;
  learningsCreated: number;
  errors: string[];
  updatedEmail?: {
    id: string;
    fromFolder: string;
    toFolder: string;
    confidence: number;
  };
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: EmailCorrectionRequest = await request.json();
    console.log(`🔄 Processing email correction for user ${session.userId}:`, body);

    // Validate required fields
    if (!body.emailSortId || !body.targetFolderId) {
      return NextResponse.json({ 
        error: 'emailSortId and targetFolderId are required' 
      }, { status: 400 });
    }

    const emailLearningService = new EmailLearningService();
    const response: EmailCorrectionResponse = {
      success: false,
      message: '',
      correctedEmails: 0,
      learningsCreated: 0,
      errors: []
    };

    // Handle batch corrections if provided
    if (body.batchCorrections && body.batchCorrections.length > 0) {
      return await processBatchCorrections(session.userId, body, emailLearningService);
    }

    // Handle single correction
    const emailSort = await prisma.emailSort.findFirst({
      where: {
        id: body.emailSortId,
        userId: session.userId
      },
      include: {
        label: {
          select: { name: true }
        }
      }
    });

    if (!emailSort) {
      return NextResponse.json({ 
        error: 'Email sort record not found or access denied' 
      }, { status: 404 });
    }

    // Get target folder
    const targetFolder = await prisma.label.findFirst({
      where: {
        id: body.targetFolderId,
        userId: session.userId
      }
    });

    if (!targetFolder) {
      return NextResponse.json({ 
        error: 'Target folder not found or access denied' 
      }, { status: 404 });
    }

    // Check if correction is actually needed
    if (emailSort.labelId === body.targetFolderId) {
      return NextResponse.json({
        success: true,
        message: 'Email is already in the target folder',
        correctedEmails: 0,
        learningsCreated: 0,
        errors: []
      });
    }

    const originalFolderName = emailSort.label.name;
    const targetFolderName = targetFolder.name;

    try {
      const gmailContext = await createGmailServiceForUser({
        userId: session.userId,
        purpose: 'email-review:apply-correction',
        requester: 'api.email-review.correct.POST',
      });

      const gmailServiceForCorrection = gmailContext?.gmail ?? null;

      // Begin transaction for atomic operation
      await prisma.$transaction(async (tx) => {
        // 1. Update the EmailSort record
        await tx.emailSort.update({
          where: { id: body.emailSortId },
          data: {
            labelId: body.targetFolderId,
            wasManuallyOverridden: true,
            reasoning: `User correction: moved from ${originalFolderName} to ${targetFolderName}${body.reason ? `. Reason: ${body.reason}` : ''}`
          }
        });

        // 2. Update Gmail label if we have OAuth access
        try {
          if (gmailServiceForCorrection && targetFolder.gmailLabelId) {
            // Remove old label and add new label
            if (emailSort.label && emailSort.label.name) {
              const oldFolder = await tx.label.findFirst({
                where: {
                  userId: session.userId,
                  name: emailSort.label.name
                }
              });
              
              if (oldFolder?.gmailLabelId) {
                await gmailServiceForCorrection.removeLabelFromEmail(
                  emailSort.gmailMessageId,
                  oldFolder.gmailLabelId
                );
              }
            }

            await gmailServiceForCorrection.addLabelToEmail(
              emailSort.gmailMessageId,
              targetFolder.gmailLabelId
            );

            console.log(`📧 Updated Gmail labels for ${emailSort.gmailMessageId}: ${originalFolderName} → ${targetFolderName}`);
          }
        } catch (gmailError) {
          console.error('Error updating Gmail labels:', gmailError);
          response.errors.push('Failed to update Gmail labels');
          // Continue with correction even if Gmail update fails
        }

        // 3. Update folder email counts
        await tx.label.update({
          where: { id: emailSort.labelId },
          data: { emailCount: { decrement: 1 } }
        });

        await tx.label.update({
          where: { id: body.targetFolderId },
          data: { emailCount: { increment: 1 } }
        });
      });

      response.correctedEmails = 1;
      response.updatedEmail = {
        id: emailSort.id,
        fromFolder: originalFolderName,
        toFolder: targetFolderName,
        confidence: emailSort.confidence || 0
      };

      // 4. Create learning if requested and reason provided
      if (body.shouldLearn && body.reason) {
        try {
          // Get email details for learning
          let emailFrom = 'unknown';
          try {
            if (gmailServiceForCorrection) {
              const gmailEmail = await gmailServiceForCorrection.getMessage(emailSort.gmailMessageId);
              if (gmailEmail?.from) {
                emailFrom = gmailEmail.from;
              }
            }
          } catch (error) {
            console.warn('Could not fetch email details for learning:', error);
          }

          // Process correction with EmailLearningService
          const learningResult = await emailLearningService.processCorrectionsWithFeedback(
            session.userId,
            [{
              emailId: emailSort.gmailMessageId,
              emailFrom,
              fromFolder: originalFolderName,
              toFolder: targetFolderName,
              shouldLearn: true,
              reason: body.reason
            }]
          );

          response.learningsCreated = learningResult.processedLearnings;
          response.errors.push(...learningResult.errors);

          console.log(`🧠 Created ${learningResult.processedLearnings} learnings from correction`);
        } catch (learningError) {
          console.error('Error creating learning:', learningError);
          response.errors.push('Failed to create learning from correction');
        }
      }

      response.success = true;
      response.message = `Email moved from ${originalFolderName} to ${targetFolderName}${response.learningsCreated > 0 ? ' and learning created' : ''}`;

      console.log(`✅ Email correction completed: ${originalFolderName} → ${targetFolderName}`);

    } catch (error) {
      console.error('Error processing email correction:', error);
      response.errors.push(`Failed to correct email: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in email correction endpoint:', error);
    return NextResponse.json({ 
      error: 'Failed to process email correction' 
    }, { status: 500 });
  }
}

async function processBatchCorrections(
  userId: string,
  body: EmailCorrectionRequest,
  emailLearningService: EmailLearningService
): Promise<NextResponse> {
  const response: EmailCorrectionResponse = {
    success: false,
    message: '',
    correctedEmails: 0,
    learningsCreated: 0,
    errors: []
  };

  console.log(`🔄 Processing batch corrections: ${body.batchCorrections!.length} emails`);

  for (const correction of body.batchCorrections!) {
    try {
      // Get email sort record
      const emailSort = await prisma.emailSort.findFirst({
        where: {
          id: correction.emailSortId,
          userId
        },
        include: {
          label: { select: { name: true } }
        }
      });

      if (!emailSort) {
        response.errors.push(`Email sort ${correction.emailSortId} not found`);
        continue;
      }

      // Get target folder
      const targetFolder = await prisma.label.findFirst({
        where: {
          id: correction.targetFolderId,
          userId
        }
      });

      if (!targetFolder) {
        response.errors.push(`Target folder ${correction.targetFolderId} not found`);
        continue;
      }

      // Skip if already in correct folder
      if (emailSort.labelId === correction.targetFolderId) {
        continue;
      }

      // Update EmailSort record
      await prisma.emailSort.update({
        where: { id: correction.emailSortId },
        data: {
          labelId: correction.targetFolderId,
          wasManuallyOverridden: true,
          reasoning: `Batch correction: moved from ${emailSort.label.name} to ${targetFolder.name}`
        }
      });

      response.correctedEmails++;
      console.log(`✅ Batch corrected: ${emailSort.label.name} → ${targetFolder.name}`);

    } catch (error) {
      console.error(`Error in batch correction for ${correction.emailSortId}:`, error);
      response.errors.push(`Failed to correct ${correction.emailSortId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  response.success = response.correctedEmails > 0;
  response.message = `Batch correction completed: ${response.correctedEmails} emails corrected`;

  if (response.errors.length > 0) {
    response.message += ` with ${response.errors.length} errors`;
  }

  return NextResponse.json(response);
}
