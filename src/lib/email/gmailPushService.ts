import { prisma } from '../prisma';
import { GmailService } from './gmail';
import { ReplyGeneratorService } from '../services/core/replyGenerator';
import { emitQueueEvent } from '@/lib/events/queueEvents';
import { EmailRoutingService } from '@/lib/services/emailRoutingService';
import { EmailFilterService, EmailMessage } from './emailFilterService';
import { ReplyRouterAgent } from '@/lib/ai/agents/replyRouterAgent';
import { FeatureFlags } from '@/lib/services/utils/featureFlags';
import { createGmailServiceForUser } from '@/lib/security/getUserGmailCredentials';
import { encryptEmailContent, encryptThreadContent, decryptEmailContent, decryptEmails, decryptThreadContent } from '@/lib/security/emailCrypto';
import { triggerAlertNotification } from '@/lib/services/alertNotificationService';
import { enqueueInboxIndexJob } from '@/lib/services/inbox-search';
// AI queue label removed: no longer creating/applying a dedicated Gmail label

export interface PushNotificationPayload {
  emailAddress: string;
  historyId: string;
}

export class GmailPushService {
  private gmail: any;
  private gmailService: GmailService | null;
  private gmailContextUserId: string | null;
  private userId: string;
  private emailFilterService: EmailFilterService;
  
  // In-memory, per-mailbox lock to serialize push processing
  private static processingLocks = new Set<string>();
  // Coalesce multiple incoming notifications to the max historyId per mailbox
  private static pendingMaxHistory = new Map<string, bigint>();
  
  // Email-level locks to prevent duplicate reply generation
  private static emailProcessingLocks = new Set<string>();

  constructor(userId?: string) {
    this.userId = userId || '';
    this.emailFilterService = new EmailFilterService();
    this.gmailService = null;
    this.gmailContextUserId = null;
    this.gmail = null;
  }

  private async prepareGmailClient({
    userId,
    mailboxId,
    purpose,
    requester,
  }: {
    userId: string;
    mailboxId?: string;
    purpose: string;
    requester: string;
  }): Promise<void> {
    if (!userId) {
      throw new Error('Cannot prepare Gmail client without userId');
    }

    const context = await createGmailServiceForUser({ userId, mailboxId, purpose, requester });
    if (!context) {
      const error = new Error(`No Gmail credentials available for user ${userId}${mailboxId ? ` (mailbox ${mailboxId})` : ''}`);
      (error as any).code = 'GMAIL_CREDENTIALS_MISSING';
      throw error;
    }

    this.gmailService = context.gmail;
    this.gmail = context.gmail.getNativeGmailClient();
    this.gmailContextUserId = userId;
    this.userId = userId;
    await context.gmail.ensureAuthenticated();
  }

  private async ensureAuthenticated(): Promise<void> {
    if (!this.gmailService) {
      throw new Error('Gmail service not initialized for request');
    }
    await this.gmailService.ensureAuthenticated();
    this.gmail = this.gmailService.getNativeGmailClient();
  }

  /**
   * Set up Gmail push notifications for a user
   */
  async setupPushNotifications({
    userId,
    mailboxId,
    topicName,
  }: {
    userId: string;
    mailboxId: string;
    topicName: string;
  }): Promise<{ historyId: string; expiration: number } | null> {
    try {
      console.log(`📧 Setting up Gmail push notifications for user ${userId}, mailbox ${mailboxId}`);
      if (!userId || !mailboxId) {
        throw new Error('GmailPushService requires userId and mailboxId to setup push notifications');
      }

      const context = await createGmailServiceForUser({
        userId,
        mailboxId,
        purpose: 'gmail-push:setup-watch',
        requester: 'GmailPushService.setupPushNotifications',
      });
      if (!context) {
        console.warn(`⚠️ Gmail credentials missing for user ${userId}, mailbox ${mailboxId}; skipping watch setup`);
        await prisma.mailbox.update({
          where: { id: mailboxId },
          data: { status: 'NEEDS_RECONNECT' },
        });
        return null;
      }

      this.gmailService = context.gmail;
      this.gmail = context.gmail.getNativeGmailClient();
      this.gmailContextUserId = userId;
      this.userId = userId;
      await context.gmail.ensureAuthenticated();
      
      const request = {
        userId: 'me',
        resource: {
          topicName: topicName,
          labelIds: ['INBOX', 'SENT'], // Watch both inbox and sent for complete coverage
          labelFilterBehavior: 'INCLUDE'
        }
      };

      // Ensure token is valid before establishing watch
      await this.ensureAuthenticated();

      const response = await this.gmail.users.watch(request);
      
      console.log(`✅ Push notifications setup - historyId: ${response.data.historyId}, expiration: ${response.data.expiration}`);
      
      // Store the initial history ID to avoid processing old emails on first notification
      if (response.data.historyId) {
        await this.updateLastHistoryId(mailboxId, response.data.historyId);
        console.log(`📧 Stored initial history ID ${response.data.historyId} for mailbox ${mailboxId}`);
        
        // **IMPORTANT**: Do NOT fetch any emails during initial setup
        // This prevents processing emails before onboarding is complete
        console.log(`🚫 Skipping email fetch during initial push setup for mailbox ${mailboxId}`);
      }

      if (response.data.expiration) {
        const expirationDate = new Date(Number(response.data.expiration));
        await prisma.mailbox.update({
          where: { id: mailboxId },
          data: { gmailWatchExpiration: expirationDate },
        });
      }
      
      return {
        historyId: response.data.historyId,
        expiration: response.data.expiration
      };
    } catch (error) {
      console.error('❌ Error setting up Gmail push notifications:', error);
      throw error;
    }
  }

  /**
   * Stop Gmail push notifications for a user
   */
  async stopPushNotifications({
    userId,
    mailboxId,
  }: {
    userId: string;
    mailboxId: string;
  }): Promise<void> {
    try {
      console.log(`📧 Stopping Gmail push notifications for user ${userId}, mailbox ${mailboxId}`);
      if (!userId || !mailboxId) {
        throw new Error('GmailPushService requires userId and mailboxId to stop push notifications');
      }

      await this.prepareGmailClient({
        userId,
        mailboxId,
        purpose: 'gmail-push:stop-watch',
        requester: 'GmailPushService.stopPushNotifications',
      });
      
      await this.ensureAuthenticated();
      await this.gmail.users.stop({
        userId: 'me'
      });
      
      console.log(`✅ Push notifications stopped for user ${userId}, mailbox ${mailboxId}`);
    } catch (error) {
      console.error('❌ Error stopping Gmail push notifications:', error);
      throw error;
    }
  }

  /**
   * Process a Gmail push notification with email filtering
   */
  async processPushNotification(payload: PushNotificationPayload): Promise<void> {
    const normalizedEmail = String(payload.emailAddress || '').trim().toLowerCase();
    if (!normalizedEmail) {
      console.log('⚠️ Missing emailAddress in push payload');
      return;
    }

    const mailbox = await prisma.mailbox.findFirst({
      where: {
        emailAddress: normalizedEmail,
        status: 'CONNECTED',
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            createdAt: true,
            masterPromptGenerated: true,
          },
        },
      },
    });

    if (!mailbox) {
      console.log(`⚠️ No connected mailbox found for: ${normalizedEmail}`);
      return;
    }

    const mailboxKey = `mailbox:${mailbox.id}:gmail-sync`;
    const incomingBig = (() => {
      try {
        return BigInt(String(payload.historyId));
      } catch {
        return null as unknown as bigint;
      }
    })();

    // Track max history id for this mailbox (coalescing bursty notifications)
    if (incomingBig) {
      const current = GmailPushService.pendingMaxHistory.get(mailboxKey);
      if (!current || incomingBig > current) {
        GmailPushService.pendingMaxHistory.set(mailboxKey, incomingBig);
      }
    }

    // If another request is already processing this mailbox, just acknowledge; it will pick up the max
    if (GmailPushService.processingLocks.has(mailboxKey)) {
      console.log(`⏭️ Coalesced push for ${normalizedEmail} at history ${payload.historyId} (mailbox busy)`);
      return;
    }

    // Acquire per-mailbox lock
    GmailPushService.processingLocks.add(mailboxKey);
    
    try {
      const coalescedTarget = GmailPushService.pendingMaxHistory.get(mailboxKey);
      const targetHistoryId = coalescedTarget ? String(coalescedTarget) : String(payload.historyId);
      console.log(`📧 Processing push for ${normalizedEmail} (mailbox ${mailbox.id}) → target history ${targetHistoryId}`);

      const user = mailbox.user;
      if (!user) {
        console.log(`⚠️ Mailbox ${mailbox.id} is missing a user record`);
        return;
      }

      // **CRITICAL FIX #1**: Check if user has completed onboarding
      const onboardingComplete = user.masterPromptGenerated;

      if (!onboardingComplete) {
        console.log(`🚫 BLOCKING: User ${normalizedEmail} onboarding not complete. Status:`, {
          masterPrompt: user.masterPromptGenerated
        });
        return; // Exit without processing any emails
      }

      // **CRITICAL FIX #2**: Get user's signup time to filter out pre-signup emails
      const userSignupTime = user.createdAt;
      console.log(`📅 User ${user.id} signed up at: ${userSignupTime.toISOString()}`);

      // EARLY HISTORY ID CHECK - Do this BEFORE any email processing
      const lastHistoryId = await this.getLastHistoryId(mailbox.id, user.id);
      
      // CRITICAL: Check if we've already processed this historyId to prevent duplicates (use BigInt for safety)
      if (lastHistoryId) {
        try {
          const last = BigInt(lastHistoryId);
          const incoming = BigInt(targetHistoryId);
          if (last >= incoming) {
            console.log(`📧 History ${targetHistoryId} already processed for user ${user.id} (last: ${lastHistoryId})`);
            return;
          }
        } catch {
          // If parsing fails, continue processing (best effort)
        }
      }

      // **NEW**: Clean up any stuck processing flags before starting
      const stuckProcessingEmails = await prisma.email.findMany({
        where: {
          mailboxId: mailbox.id,
          thread: { userId: user.id },
          isProcessing: true,
          updatedAt: {
            lt: new Date(Date.now() - 5 * 60 * 1000) // Older than 5 minutes
          }
        },
        select: { id: true, messageId: true, from: true }
      });
      
      if (stuckProcessingEmails.length > 0) {
        console.log(`🧹 Found ${stuckProcessingEmails.length} emails with stuck processing flags, cleaning up...`);
        await prisma.email.updateMany({
          where: {
            id: { in: stuckProcessingEmails.map(e => e.id) }
          },
          data: { isProcessing: false }
        });
        console.log(`🧹 Cleaned up ${stuckProcessingEmails.length} stuck processing flags`);
      }

      try {
        await this.prepareGmailClient({
          userId: user.id,
          mailboxId: mailbox.id,
          purpose: 'gmail-push:process',
          requester: 'GmailPushService.processPushNotification',
        });
      } catch (prepError) {
        console.error(`❌ Unable to initialize Gmail client for user ${user.id}`, prepError);
        if ((prepError as any)?.code === 'GMAIL_CREDENTIALS_MISSING') {
          await prisma.mailbox.update({
            where: { id: mailbox.id },
            data: { status: 'NEEDS_RECONNECT' },
          });
        }
        return;
      }

      const gmailService = this.gmailService;
      if (!gmailService) {
        console.error(`❌ Gmail service missing after initialization for user ${user.id}`);
        return;
      }

      let newEmails: any[] = [];

      if (!lastHistoryId) {
        console.log(`📧 No last history ID found for ${user.id}, fetching recent emails instead of full sync.`);
        // For first notification, get the most recent emails instead of doing full sync
        newEmails = await this.getRecentEmailsWithLabels({
          maxResults: 10,
          userId: user.id,
          mailboxId: mailbox.id,
        }); // Get last 10 emails with labels
      } else {
        // Get history of changes since last known history ID up to the coalesced target
        newEmails = await this.getNewEmailsFromHistoryWithLabels({
          startHistoryId: lastHistoryId,
          endHistoryId: targetHistoryId,
          userId: user.id,
          mailboxId: mailbox.id,
        });
      }
      
      if (newEmails.length > 0) {
        console.log(`📧 Found ${newEmails.length} new emails for user ${user.id}`);
        
        // **CRITICAL FIX #3**: Filter out emails that arrived before user signup
        const postSignupEmails = newEmails.filter(email => {
          const emailDate = new Date(email.date || email.createdAt);
          const isPostSignup = emailDate >= userSignupTime;
          
          if (!isPostSignup) {
            console.log(`⏭️ Skipping pre-signup email from ${email.from} (${emailDate.toISOString()} < ${userSignupTime.toISOString()})`);
          }
          
          return isPostSignup;
        });
        
        console.log(`📧 After filtering pre-signup emails: ${postSignupEmails.length} emails to process`);
        
        if (postSignupEmails.length === 0) {
          console.log(`📧 No post-signup emails to process for user ${user.id}`);
          // Still update history ID to prevent reprocessing
          await this.updateLastHistoryId(mailbox.id, targetHistoryId);
          return;
        }
        
        // Store new emails in database (replacing deprecated method)
        console.log(`💾 DEBUG: Storing ${postSignupEmails.length} emails in database...`);
        
        for (const emailData of postSignupEmails) {
          console.log(`💾 DEBUG: Storing email from ${emailData.from}, messageId: ${emailData.messageId}`);
          
          try {
            // Find or create thread using Gmail thread ID for proper conversation grouping
            let thread = null;
            
            // First try to find by Gmail thread ID if it exists
            if (emailData.gmailThreadId) {
              thread = await prisma.thread.findUnique({
                where: {
                  mailboxId_gmailThreadId: {
                    mailboxId: mailbox.id,
                    gmailThreadId: emailData.gmailThreadId,
                  },
                },
              });
            }
            
            // If not found by Gmail thread ID, try by subject (fallback)
            if (!thread) {
              // Remove common subject prefixes for better thread matching
              const normalizedSubject = emailData.subject
                .replace(/^(re:|fwd?:|fw:)\s*/i, '')
                .trim();

              const candidateThreads = await prisma.thread.findMany({
                where: {
                  userId: user.id,
                  mailboxId: mailbox.id,
                },
                orderBy: { createdAt: 'desc' },
                take: 25,
              });

              const decryptedThreads = await Promise.all(
                candidateThreads.map((t) => decryptThreadContent({ thread: t, userId: user.id }))
              );

              thread = decryptedThreads.find((candidate) => {
                const subject = (candidate.subject || '').trim();
                if (!subject) return false;
                if (subject === emailData.subject) return true;
                if (subject === normalizedSubject) return true;
                return subject.includes(normalizedSubject);
              }) || null;
            }

            if (!thread) {
              console.log(`💾 DEBUG: Creating new thread for subject: "${emailData.subject}" with Gmail thread ID: ${emailData.gmailThreadId}`);
              const threadContent = {
                subject: emailData.subject,
                snippet: emailData.body?.substring(0, 100) || '',
              };
              const encryptedThread = await encryptThreadContent({
                userId: user.id,
                data: threadContent,
              });
              thread = await prisma.thread.create({
                data: {
                  userId: user.id,
                  mailboxId: mailbox.id,
                  gmailThreadId: emailData.gmailThreadId || undefined,
                  subject: '',
                  snippet: '',
                  ...encryptedThread,
                },
              });
            } else if (emailData.gmailThreadId && !thread.gmailThreadId) {
              // Update existing thread with Gmail thread ID if it doesn't have one
              console.log(`💾 DEBUG: Updating thread ${thread.id} with Gmail thread ID: ${emailData.gmailThreadId}`);
              thread = await prisma.thread.update({
                where: { id: thread.id },
                data: { gmailThreadId: emailData.gmailThreadId }
              });
            }

            const emailContent = {
              subject: emailData.subject,
              body: emailData.body || '',
              from: emailData.from,
              to: emailData.to || [],
              cc: emailData.cc || [],
              snippet: emailData.snippet || emailData.body?.substring(0, 100) || '',
            };

            const encryptedEmailCreate = await encryptEmailContent({
              userId: user.id,
              data: emailContent,
            });

            // Use findUnique with compound key for mailbox-scoped lookup
            const existingEmail = await prisma.email.findUnique({
              where: {
                mailboxId_messageId: {
                  mailboxId: mailbox.id,
                  messageId: emailData.messageId,
                },
              },
              include: { generatedDraft: true, thread: true },
            });

            const storedEmail = existingEmail
              ? await prisma.email.update({
                  where: { id: existingEmail.id },
                  data: {
                    gmailThreadId: emailData.gmailThreadId || undefined,
                    rfc2822MessageId: emailData.rfc2822MessageId || undefined,
                    references: emailData.references || undefined,
                    inReplyTo: emailData.inReplyTo || undefined,
                  },
                  include: { generatedDraft: true, thread: true },
                })
              : await prisma.email.create({
                  data: {
                    threadId: thread.id,
                    mailboxId: mailbox.id,
                    messageId: emailData.messageId,
                    gmailThreadId: emailData.gmailThreadId || undefined,
                    rfc2822MessageId: emailData.rfc2822MessageId || undefined,
                    references: emailData.references || undefined,
                    inReplyTo: emailData.inReplyTo || undefined,
                    isSent: emailData.isSent || false,
                    isDraft: false,
                    createdAt: emailData.date ? new Date(emailData.date) : new Date(),
                    from: '',
                    subject: '',
                    body: '',
                    snippet: '',
                    to: [],
                    cc: [],
                    ...encryptedEmailCreate,
                  },
                  include: { generatedDraft: true, thread: true },
                });

            const savedEmail = await decryptEmailContent({ email: storedEmail, userId: user.id });

            await enqueueInboxIndexJob({
              userId: user.id,
              mailboxId: mailbox.id,
              messageId: savedEmail.messageId,
            });

            console.log(`💾 DEBUG: Successfully stored/updated email with ID: ${savedEmail.id}, messageId: ${savedEmail.messageId}`);
            
          } catch (storageError) {
            console.error(`💾 DEBUG: Error storing email ${emailData.messageId}:`, storageError);
            // Continue with other emails even if one fails
          }
        }
        
        console.log(`💾 DEBUG: Finished storing emails in database`);
        
        // Add small delay to ensure database transactions complete
        console.log(`⏳ DEBUG: Waiting 500ms for database transactions to complete...`);
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Filter and generate replies for new, non-sent emails with filtering
        const replyGenerator = new ReplyGeneratorService();
        
        console.log(`🔬 DEBUG: Starting filtering loop for ${postSignupEmails.length} emails`);
        
        for (const emailData of postSignupEmails) {
          console.log(`🔬 DEBUG: Processing email with messageId: ${emailData.messageId}`);
          console.log(`🔬 DEBUG: Email from: ${emailData.from}, subject: "${emailData.subject}"`);
          console.log(`🔬 DEBUG: Email isSent flag: ${emailData.isSent}`);
          
          // Try multiple lookup strategies to handle race conditions
          let savedEmail = null;
          let retryCount = 0;
          const maxRetries = 3;
          
          while (!savedEmail && retryCount < maxRetries) {
            if (retryCount > 0) {
              console.log(`🔬 DEBUG: Retry ${retryCount} - looking up email after ${retryCount * 200}ms delay`);
              await new Promise(resolve => setTimeout(resolve, 200 * retryCount));
            }
            
            // Try finding by compound unique key (mailboxId + messageId)
            const fetchedEmail = await prisma.email.findUnique({
              where: {
                mailboxId_messageId: {
                  mailboxId: mailbox.id,
                  messageId: emailData.messageId,
                },
              },
              include: { generatedDraft: true, thread: true },
            });

            savedEmail = fetchedEmail
              ? await decryptEmailContent({ email: fetchedEmail, userId: user.id })
              : null;
            
            if (!savedEmail) {
              console.log(`🔬 DEBUG: Attempt ${retryCount + 1} - Email not found by messageId: ${emailData.messageId}`);
              
              // Also try finding by from/subject/timestamp as backup
              const recentEmails = await prisma.email.findMany({
                where: {
                  mailboxId: mailbox.id,
                  thread: { userId: user.id },
                  from: emailData.from,
                  subject: emailData.subject,
                  createdAt: {
                    gte: new Date(Date.now() - 60000) // Last 60 seconds
                  }
                },
                include: { generatedDraft: true, thread: true },
                orderBy: { createdAt: 'desc' },
                take: 1
              });
              
              if (recentEmails.length > 0) {
                const [decryptedRecent] = await decryptEmails(recentEmails, user.id);
                savedEmail = decryptedRecent;
                console.log(`🔬 DEBUG: Found email by backup search: ${savedEmail.id}`);
              }
            }
            
            retryCount++;
          }
          
          console.log(`🔬 DEBUG: Found savedEmail: ${!!savedEmail}`);
          if (savedEmail) {
            console.log(`🔬 DEBUG: SavedEmail ID: ${savedEmail.id}, isSent: ${savedEmail.isSent}`);
            console.log(`🔬 DEBUG: SavedEmail has existing draft metadata: ${!!savedEmail.generatedDraft}`);
          } else {
            console.log(`🔬 DEBUG: Failed to find email after ${maxRetries} attempts`);
            console.log(`🔬 DEBUG: This suggests a database storage issue or messageId mismatch`);
            
            // Log available recent emails for debugging
            const debugEmails = await prisma.email.findMany({
              where: {
                mailboxId: mailbox.id,
                thread: { userId: user.id },
                createdAt: {
                  gte: new Date(Date.now() - 300000) // Last 5 minutes
                }
              },
              select: { id: true, messageId: true, from: true, subject: true, createdAt: true },
              orderBy: { createdAt: 'desc' },
              take: 5
            });
            console.log(`🔬 DEBUG: Recent emails in database:`, debugEmails);
          }
          
          // Only process incoming emails, not emails sent by the user
          if (savedEmail && !savedEmail.isSent) {
            console.log(`🔍 Applying filters to email: ${savedEmail.id} from ${emailData.from}`);
            
            // CRITICAL: Email-level locking to prevent race conditions
            const emailLockKey = `email-${savedEmail.id}`;
            if (GmailPushService.emailProcessingLocks.has(emailLockKey)) {
              console.log(`⚠️ Email ${savedEmail.id} is already being processed by another thread, skipping`);
              continue;
            }
            
            // Acquire email-level lock
            GmailPushService.emailProcessingLocks.add(emailLockKey);
            
            try {
              // Double-check if email already has a generated reply or is being processed (after acquiring lock)
              const emailWithReplyRecord = await prisma.email.findUnique({
                where: { id: savedEmail.id },
                include: { generatedDraft: true, thread: true },
              });

              const emailWithReply = emailWithReplyRecord
                ? await decryptEmailContent({ email: emailWithReplyRecord, userId: user.id })
                : null;

              if (emailWithReply?.generatedDraft) {
                console.log(`⚠️ Email ${savedEmail.id} already has generated draft metadata, skipping duplicate generation`);
                continue;
              }
              
              if (emailWithReply?.isProcessing) {
                console.log(`⚠️ Email ${savedEmail.id} is already being processed for reply generation, skipping`);
                continue;
              }
              
              // Mark email as being processed
              await prisma.email.update({
                where: { id: savedEmail.id },
                data: { isProcessing: true }
              });
              
              console.log(`🔒 Marked email ${savedEmail.id} as processing`);
              
              // Predict label (for UI scoping) — used if we emit events later
              let predictedLabelId: string | undefined;
              let predictedLabelName: string | undefined;
              let predictedLabelColor: string | undefined;
              let predictedGmailLabelId: string | undefined;
              try {
                const router = new EmailRoutingService();
                const route = await router.routeEmail(user.id, {
                  from: emailData.from,
                  subject: emailData.subject,
                  to: emailData.to || [],
                  cc: emailData.cc || [],
                });
                if (route?.labelId) {
                  const label = await prisma.label.findFirst({
                    where: { id: route.labelId, userId: user.id },
                    select: { id: true, name: true, color: true, gmailLabelId: true },
                  });
                  if (label) {
                    predictedLabelId = label.id;
                    predictedLabelName = label.name;
                    predictedLabelColor = label.color || '#6B7280';
                    predictedGmailLabelId = label.gmailLabelId || undefined;
                  }
                }
              } catch (e) {
                console.warn(`⚠️ Label prediction failed for email ${savedEmail.id}:`, e);
              }

              const queueLabelId = predictedLabelId;
              
              // Apply email filtering
              const emailMessage: EmailMessage = {
                messageId: emailData.messageId,
                labelIds: emailData.labelIds || [],
                from: emailData.from,
                to: emailData.to,
                cc: emailData.cc || [],
                subject: emailData.subject,
                body: emailData.body
              };
              
              console.log(`🔬 DEBUG: Created emailMessage for filtering`);
              console.log(`🔬 DEBUG: EmailMessage from: ${emailMessage.from}, to: ${JSON.stringify(emailMessage.to)}`);
              
              // Get user's email from database for filtering
              const userDetails = await prisma.user.findUnique({
                where: { id: user.id },
                select: { email: true }
              });
              
              if (!userDetails) {
                console.log(`⚠️ User details not found for ${user.id}`);
                continue;
              }
              
              console.log(`🔬 DEBUG: User email for filtering: ${userDetails.email}`);
              console.log(`🔬 DEBUG: About to call shouldReplyToEmail...`);
              
              const filterResult = await this.emailFilterService.shouldReplyToEmail(
                emailMessage, 
                user.id, 
                userDetails.email
              );
              
              console.log(`🔬 DEBUG: Filter result - shouldReply: ${filterResult.shouldReply}, reason: ${filterResult.reason}`);
              
                              if (!filterResult.shouldReply) {
                console.log(`🚫 Email filtered: ${filterResult.reason}`);
                
                // Store filter reason in action history for transparency
                await prisma.actionHistory.create({
                  data: {
                    userId: user.id,
                    actionType: 'EMAIL_REJECTED',
                    actionSummary: `Filtered: ${emailData.from} - ${emailData.subject}`,
                    actionDetails: {
                      emailFrom: emailData.from,
                      emailSubject: emailData.subject,
                      filterReason: filterResult.reason,
                      filterCategory: filterResult.category
                    },
                    emailReference: savedEmail.id,
                    undoable: false,
                    metadata: {
                      autoFiltered: true,
                      filterReason: filterResult.reason
                    }
                  }
                });
                
                continue;
              }
              
              console.log(`✅ Email passed filters: ${filterResult.reason}`);

              // Stage 1 (Router): LLM-based second-pass evaluator to prevent unnecessary drafts
              // Runs after deterministic filter has allowed the email
              const router = new ReplyRouterAgent();
              const routerDecision = await router.evaluate({
                userId: user.id,
                userEmail: userDetails.email,
                message: emailMessage,
                filterResult,
                strict: false,
              });

              console.log(
                `🧭 Router decision - shouldReply: ${routerDecision.shouldReply}, reason: ${routerDecision.reason}`,
              );

              if (routerDecision.shouldNotify && routerDecision.matchedAlertId) {
                console.log(
                  `🔔 Alert matched: ${routerDecision.matchedAlertDescription || routerDecision.matchedAlertId}`,
                );

                await triggerAlertNotification({
                  userId: user.id,
                  userEmail: userDetails.email,
                  email: {
                    from: emailData.from,
                    subject: emailData.subject,
                    snippet: (emailData.body || '').slice(0, 300),
                  },
                  alert: {
                    id: routerDecision.matchedAlertId,
                    description: routerDecision.matchedAlertDescription || '',
                  },
                });
              }

              if (!routerDecision.shouldReply) {
                console.log(`🚫 Email blocked by Router Agent: ${routerDecision.reason}`);

                await prisma.actionHistory.create({
                  data: {
                    userId: user.id,
                    actionType: 'EMAIL_REJECTED',
                    actionSummary: `Router blocked: ${emailData.from} - ${emailData.subject}`,
                    actionDetails: {
                      emailFrom: emailData.from,
                      emailSubject: emailData.subject,
                      filterReason: filterResult.reason,
                      filterCategory: filterResult.category,
                      routerDecision,
                    },
                    emailReference: savedEmail.id,
                    undoable: false,
                    metadata: {
                      autoFiltered: true,
                      filterReason: filterResult.reason,
                      routerBlocked: true,
                    },
                  },
                });

                continue;
              }

              console.log(`🤖 Generating reply for filtered email: ${savedEmail.id}`);
              
              try {
                // Emit SSE start event ONLY AFTER filters pass
                try {
                  emitQueueEvent({
                    type: 'start',
                    userId: user.id,
                    emailId: savedEmail.id,
                    messageId: savedEmail.messageId,
                    subject: emailData.subject,
                    from: emailData.from,
                    snippet: (emailData.body || '').slice(0, 160),
                    receivedAt: (savedEmail.createdAt || new Date()).toISOString(),
                    labelId: queueLabelId,
                    labelName: predictedLabelName,
                    labelColor: predictedLabelColor,
                    gmailLabelId: predictedGmailLabelId,
                  });
                } catch (e) {
                  console.warn(`⚠️ Failed to emit queue:start for email ${savedEmail.id}:`, e);
                }

                const generatedReply = await replyGenerator.generateReply({
                  userId: user.id,
                  mailboxId: mailbox.id,
                  mailboxEmail: mailbox.emailAddress,
                  gmailMessageId: emailData.gmailMessageId,
                  currentLabelIds: emailData.labelIds || [],
                  incomingEmail: {
                    from: emailData.from,
                    to: emailData.to,
                    subject: emailData.subject,
                    body: emailData.body,
                    date: new Date(emailData.date),
                    threadId: emailData.gmailThreadId,
                  },
                });

                // Robust guard: only persist successful generations.
                const draftText = (generatedReply.reply || '').trim();
                const isApology = /unable to generate a reply|please try again later|system is still setting up/i.test(draftText);
                if (draftText.length > 0 && generatedReply.confidence > 0 && !isApology) {
                  let gmailDraftId: string | null = null;

                  if (process.env.FEATURE_FLAG_GMAIL_DRAFTS === 'false') {
                    console.warn(`🚫 Gmail drafts feature flag disabled; skipping draft persistence for email ${savedEmail.id}`);
                  } else {
                    try {
                      const draftResult = await gmailService.createDraftReply({
                        to: emailData.from,
                        cc: generatedReply.ccRecipients || [],
                        subject: emailData.subject.startsWith('Re: ') ? emailData.subject : `Re: ${emailData.subject}`,
                        body: draftText,
                        inReplyTo: emailData.rfc2822MessageId || undefined,
                        references: emailData.references || undefined,
                        threadId: emailData.gmailThreadId || undefined,
                        // No dedicated AI label applied to drafts
                        labelIds: undefined,
                      });
                      gmailDraftId = draftResult.draftId;
                      console.log(`✅ Gmail draft created for email ${savedEmail.id}: ${gmailDraftId}`);
                    } catch (draftError) {
                      console.warn(`⚠️ Gmail draft creation failed for email ${savedEmail.id}:`, draftError);
                    }
                  }

                  if (gmailDraftId) {
                    const savedGeneratedDraft = await prisma.generatedDraft.upsert({
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

                    console.log(`✅ Draft metadata saved for email ${savedEmail.id} (draft ${savedGeneratedDraft.gmailDraftId})`);

                    // Store concise email summary into Email.snippet for UI
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
                        savedEmail.snippet = generatedReply.contextualInfo.emailSummary;
                      } catch (e) {
                        console.warn(`⚠️ Failed to store email summary to snippet for email ${savedEmail.id}:`, e);
                      }
                    }

                    // Emit SSE ready event so UI triggers a refetch
                    try {
                    emitQueueEvent({
                      type: 'ready',
                      userId: user.id,
                      emailId: savedEmail.id,
                      messageId: savedEmail.messageId,
                      labelId: queueLabelId,
                    });
                    } catch (e) {
                      console.warn(`⚠️ Failed to emit queue:ready for email ${savedEmail.id}:`, e);
                    }
                  } else {
                    try {
                      emitQueueEvent({
                        type: 'fail',
                        userId: user.id,
                        emailId: savedEmail.id,
                        messageId: savedEmail.messageId,
                        reason: 'Draft creation failed',
                        labelId: queueLabelId,
                      });
                    } catch {}
                  }
                } else {
                  console.log(
                    `⚠️ Skipping persist for email ${savedEmail.id} — ` +
                    (draftText.length === 0
                      ? 'empty draft'
                      : generatedReply.confidence <= 0
                        ? `non-positive confidence (${generatedReply.confidence})`
                        : 'error-style draft text')
                  );
                  // Notify UI to remove placeholder when nothing is persisted
                  try {
                    emitQueueEvent({
                      type: 'fail',
                      userId: user.id,
                      emailId: savedEmail.id,
                      messageId: savedEmail.messageId,
                      reason: 'Draft not persisted',
                      labelId: queueLabelId,
                    });
                  } catch {}
                }
              } catch (replyError) {
                console.error(`❌ Error generating reply for email ${savedEmail.id}:`, replyError);
                try {
                  emitQueueEvent({
                    type: 'fail',
                    userId: user.id,
                    emailId: savedEmail.id,
                    messageId: savedEmail.messageId,
                    reason: replyError instanceof Error ? replyError.message : 'Unknown error',
                    labelId: queueLabelId,
                  });
                } catch {}
              }
            } finally {
              // Always clear the processing flag and release the email-level lock
              try {
                await prisma.email.update({
                  where: { id: savedEmail.id },
                  data: { isProcessing: false }
                });
                console.log(`🔓 Cleared processing flag for email ${savedEmail.id}`);
              } catch (clearError) {
                console.error(`❌ Error clearing processing flag for email ${savedEmail.id}:`, clearError);
              }
              
              GmailPushService.emailProcessingLocks.delete(emailLockKey);
              console.log(`🔓 Released email lock for ${savedEmail.id}`);
            }
          } else {
            console.log(`🔬 DEBUG: Skipping email processing because:`);
            console.log(`🔬 DEBUG: - savedEmail exists: ${!!savedEmail}`);
            if (savedEmail) {
              console.log(`🔬 DEBUG: - savedEmail.isSent: ${savedEmail.isSent}`);
            }
            console.log(`🔬 DEBUG: - Condition (savedEmail && !savedEmail.isSent): ${!!(savedEmail && !savedEmail.isSent)}`);
          }
        }
        
        console.log(`🔬 DEBUG: Finished processing all emails in filtering loop`);
        
        // Update last history ID (monotonic)
        await this.updateLastHistoryId(mailbox.id, targetHistoryId);
        console.log(`✅ Processed ${postSignupEmails.length} new emails via push notification with filtering`);
      } else {
        console.log(`📧 No new emails found in history update for user ${user.id}`);
        // Still update history ID (monotonic) to prevent reprocessing
        await this.updateLastHistoryId(mailbox.id, targetHistoryId);
      }
      
    } catch (error) {
      console.error('❌ Error processing Gmail push notification:', error);
    } finally {
      // Always release the per-mailbox lock and clear coalesced target
      GmailPushService.processingLocks.delete(mailboxKey);
      GmailPushService.pendingMaxHistory.delete(mailboxKey);
      console.log(`🔓 Released push lock for ${mailboxKey}`);
    }
  }

  /**
   * Get recent emails with labels when no history ID exists (for first-time setup)
   */
  private async getRecentEmailsWithLabels({
    maxResults = 10,
    userId,
    mailboxId,
  }: {
    maxResults?: number;
    userId: string;
    mailboxId: string;
  }): Promise<any[]> {
    try {
      console.log(`📧 Fetching ${maxResults} most recent emails for mailbox ${mailboxId} (inbox + sent)`);
      
      await this.ensureAuthenticated();
      // Use Gmail API directly to get recent emails from both inbox and sent
      const response = await this.gmail.users.messages.list({
        userId: 'me',
        labelIds: ['INBOX', 'SENT'],
        maxResults: maxResults
      });

      const messages = response.data.messages || [];
      if (messages.length === 0) {
        console.log(`📧 No recent emails found in inbox or sent`);
        return [];
      }

      // Fetch the actual email content with labels
      const emails = [];
      for (const message of messages) {
        try {
          await this.ensureAuthenticated();
          const fullMessage = await this.gmail.users.messages.get({
            userId: 'me',
            id: message.id
          });

          const parsedEmail = this.parseGmailMessageWithLabels(fullMessage.data);
          if (parsedEmail) {
            // Always add the email to the list for processing
            emails.push(parsedEmail);
            
            // If this is a sent email, check if it resolves any pending AI replies
            if (parsedEmail.isSent) {
              console.log(`📤 Detected sent email: ${parsedEmail.messageId}, processing for reply resolution`);
              await this.handleSentEmailForReplyResolution(parsedEmail, userId, mailboxId);
            }
          }
        } catch (error) {
          console.error(`Error fetching recent message ${message.id}:`, error);
        }
      }
      
      console.log(`📧 Found ${emails.length} recent emails (inbox + sent) with labels for mailbox ${mailboxId}`);
      return emails;
      
    } catch (error) {
      console.error('❌ Error getting recent emails:', error);
      return [];
    }
  }

  /**
   * Get new emails from Gmail history with labels
   */
  private async getNewEmailsFromHistoryWithLabels({
    startHistoryId,
    endHistoryId,
    userId,
    mailboxId,
  }: {
    startHistoryId: string;
    endHistoryId: string;
    userId: string;
    mailboxId: string;
  }): Promise<any[]> {
    try {
      console.log(`📧 Fetching emails from history ${startHistoryId} → ${endHistoryId} for mailbox ${mailboxId} (paged)`);
      
      // Use Gmail history.list to get changes (page through results)
      await this.ensureAuthenticated();
      let pageToken: string | undefined = undefined;
      const messageIds: string[] = [];
      let pages = 0;

      do {
        const response: any = await this.gmail.users.history.list({
          userId: 'me',
          startHistoryId: startHistoryId,
          historyTypes: ['messageAdded'],
          pageToken,
        });

        const history = response.data.history || [];
        history.forEach((historyItem: any) => {
          if (historyItem.messagesAdded) {
            historyItem.messagesAdded.forEach((added: any) => {
              messageIds.push(added.message.id);
            });
          }
        });

        pageToken = response.data.nextPageToken || undefined;
        pages += 1;
      } while (pageToken && pages < 50); // safety cap

      if (messageIds.length === 0) {
        console.log(`📧 No new message IDs found in history`);
        return [];
      }

      console.log(`📧 Found ${messageIds.length} new message IDs from history across ${pages} page(s)`);

      // Fetch the actual emails with labels
      const emails = [];
      for (const messageId of messageIds) {
        try {
          await this.ensureAuthenticated();
          const message = await this.gmail.users.messages.get({
            userId: 'me',
            id: messageId
          });

          const parsedEmail = this.parseGmailMessageWithLabels(message.data);
          if (parsedEmail) {
            // Always add the email to the list for processing
            emails.push(parsedEmail);
            
            // If this is a sent email, check if it resolves any pending AI replies
            if (parsedEmail.isSent) {
              console.log(`📤 Detected sent email in history: ${parsedEmail.messageId}, processing for reply resolution`);
              await this.handleSentEmailForReplyResolution(parsedEmail, userId, mailboxId);
            }
          }
        } catch (error: any) {
          // Handle occasional 404s from history drift or quick deletes
          if (error?.code === 404 || error?.status === 404) {
            console.warn(`⚠️ Message ${messageId} not found (404), skipping`);
            continue;
          }
          console.error(`Error fetching message ${messageId}:`, error);
        }
      }

      console.log(`📧 Successfully parsed ${emails.length} emails (inbox + sent) from history with labels for mailbox ${mailboxId}`);
      return emails;
    } catch (error) {
      console.error('❌ Error getting emails from history:', error);
      return [];
    }
  }

  /**
   * Parse Gmail message to our email format WITH LABELS for filtering
   */
  private parseGmailMessageWithLabels(message: any): any | null {
    try {
      const headers = message.payload?.headers || [];
      const getHeader = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

      return {
        messageId: message.id,
        gmailThreadId: message.threadId,
        rfc2822MessageId: getHeader('Message-ID'),
        references: getHeader('References'),
        inReplyTo: getHeader('In-Reply-To'),
        from: getHeader('from'),
        to: getHeader('to').split(',').map((email: string) => email.trim()),
        cc: getHeader('cc').split(',').map((email: string) => email.trim()).filter(Boolean),
        subject: getHeader('subject'),
        body: this.extractEmailBody(message.payload),
        snippet: message.snippet || '',
        isSent: message.labelIds?.includes('SENT') || false,
        isDraft: message.labelIds?.includes('DRAFT') || false,
        labelIds: message.labelIds || [], // Include label IDs for filtering
        date: new Date(parseInt(message.internalDate))
      };
    } catch (error) {
      console.error('Error parsing Gmail message:', error);
      return null;
    }
  }

  /**
   * Extract email body from Gmail message payload
   */
  private extractEmailBody(payload: any): string {
    if (payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }

    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
      }
    }

    return '';
  }

  /**
   * Get last processed history ID for mailbox
   */
  private async getLastHistoryId(mailboxId: string, userId?: string): Promise<string | null> {
    try {
      const mailbox = await prisma.mailbox.findUnique({
        where: { id: mailboxId },
        select: { gmailHistoryId: true },
      });

      if (mailbox?.gmailHistoryId) {
        return mailbox.gmailHistoryId;
      }

      if (userId) {
        const legacy = await prisma.userSettings.findUnique({
          where: { userId },
          select: { gmailHistoryId: true },
        });
        if (legacy?.gmailHistoryId) {
          console.warn(`⚠️ Using legacy gmailHistoryId from UserSettings for user ${userId} (mailbox ${mailboxId})`);
          return legacy.gmailHistoryId;
        }
      }

      return null;
    } catch (error) {
      console.error('Error getting last history ID:', error);
      return null;
    }
  }

  /**
   * Update last processed history ID for mailbox (monotonic)
   */
  private async updateLastHistoryId(mailboxId: string, historyId: string): Promise<void> {
    try {
      // Ensure historyId is a string and only move forwards (monotonic)
      const incoming = String(historyId);
      await prisma.$transaction(async (tx) => {
        const current = await tx.mailbox.findUnique({
          where: { id: mailboxId },
          select: { gmailHistoryId: true },
        });

        if (!current) {
          console.warn(`⚠️ Mailbox ${mailboxId} not found; cannot update gmailHistoryId`);
          return;
        }

        let shouldUpdate = true;
        try {
          if (current.gmailHistoryId) {
            const cur = BigInt(current.gmailHistoryId);
            const inc = BigInt(incoming);
            shouldUpdate = inc > cur;
          }
        } catch {
          // If parsing fails, fall back to updating (best effort)
          shouldUpdate = true;
        }

        if (!shouldUpdate) {
          console.log(`↩️ Skipping historyId update for mailbox ${mailboxId} (incoming ${incoming} <= current ${current.gmailHistoryId ?? 'none'})`);
          return;
        }

        await tx.mailbox.update({
          where: { id: mailboxId },
          data: { gmailHistoryId: incoming },
        });
      });
      console.log(`📧 Updated last history ID for mailbox ${mailboxId}: ${incoming}`);
    } catch (error) {
      console.error('Error updating last history ID:', error);
    }
  }

  /**
   * Handle sent emails to mark corresponding AI replies as handled
   */
  private async handleSentEmailForReplyResolution(sentEmail: any, userId: string, mailboxId: string): Promise<void> {
    try {
      console.log(`📤 Processing sent email for reply resolution: ${sentEmail.messageId} in thread ${sentEmail.gmailThreadId} (mailbox ${mailboxId})`);
      
      if (!sentEmail.gmailThreadId) {
        console.log(`⚠️ No Gmail thread ID for sent email ${sentEmail.messageId}, skipping resolution`);
        return;
      }

      // Ensure token is valid before attempting any Gmail operations
      await this.ensureAuthenticated();

      // Find the latest incoming email in this thread that has a generated reply but no feedback
      const unprocessedRecord = await prisma.email.findFirst({
        where: {
          mailboxId,
          thread: { userId, mailboxId },
          gmailThreadId: sentEmail.gmailThreadId,
          isSent: false,
          feedback: null,
          generatedDraft: { isNot: null },
        },
        include: { generatedDraft: true, thread: true },
        orderBy: { createdAt: 'desc' }, // Get the most recent one
      });

      if (!unprocessedRecord) {
        console.log(`📤 No unprocessed AI replies found for thread ${sentEmail.gmailThreadId}`);
        return;
      }

      const unprocessedEmail = await decryptEmailContent({ email: unprocessedRecord, userId });

      console.log(`📤 Found unprocessed AI reply for email ${unprocessedEmail.id}, marking as externally handled`);

      // Create feedback entry to mark as handled externally
      await prisma.feedback.upsert({
        where: { emailId: unprocessedEmail.id },
        update: {
          action: 'ACCEPTED',
          editDelta: {
            external: true,
            sentVia: 'gmail_client',
            repliedAt: new Date().toISOString(),
            sentEmailId: sentEmail.messageId,
        },
      },
      create: {
        userId: userId,
        emailId: unprocessedEmail.id,
        action: 'ACCEPTED',
        editDelta: {
          external: true,
          sentVia: 'gmail_client', 
          repliedAt: new Date().toISOString(),
          sentEmailId: sentEmail.messageId,
        },
      },
    });

    // If there's a Gmail draft ID, we can try to clean it up (optional)
    if (unprocessedEmail.generatedDraft?.gmailDraftId) {
      try {
        console.log(`📤 Attempting to clean up Gmail draft ${unprocessedEmail.generatedDraft.gmailDraftId}`);
        await this.ensureAuthenticated();
        await this.gmail.users.drafts.delete({
          userId: 'me',
          id: unprocessedEmail.generatedDraft.gmailDraftId,
        });
        
        // Remove draft metadata to keep pointers accurate
        await prisma.generatedDraft.delete({
          where: { id: unprocessedEmail.generatedDraft.id },
        });
        
        console.log(`✅ Cleaned up Gmail draft ${unprocessedEmail.generatedDraft.gmailDraftId}`);
      } catch (draftCleanupError) {
        console.warn(`⚠️ Failed to clean up Gmail draft ${unprocessedEmail.generatedDraft.gmailDraftId}:`, draftCleanupError);
        // Don't fail the whole process if draft cleanup fails
      }
    }

      console.log(`✅ Marked AI reply for email ${unprocessedEmail.id} as handled externally`);
      
    } catch (error) {
      console.error(`❌ Error handling sent email for reply resolution:`, error);
      // Don't throw - this is a background process and shouldn't fail the main flow
    }
  }
} 
