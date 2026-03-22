import { google } from 'googleapis'
import { logger } from '../logger'
import { prisma } from '../prisma'
import { EmailContextQuery } from '../../types'
import { encryptToken } from '@/lib/encryption'
import {
  extractGmailPayloadBodyText,
  extractGmailPayloadBodyTextWithAttachments,
  truncateGmailExtractedBody,
} from '@/lib/email/gmailPayloadBody'

export interface EmailData {
  messageId: string
  gmailMessageId?: string // Gmail message ID (alias for messageId)
  gmailThreadId?: string // Gmail's actual thread ID
  rfc2822MessageId?: string // RFC 2822 Message-ID header for threading
  references?: string // RFC 2822 References header for threading chain
  inReplyTo?: string // RFC 2822 In-Reply-To header
  from: string
  to: string[]
  cc: string[]
  subject: string
  body: string
  snippet: string
  isSent: boolean
  isDraft: boolean
  date: Date
  hasAttachments: boolean
  labelIds?: string[] // Gmail label IDs
  gmailCategories?: ('PROMOTIONS'|'SOCIAL'|'UPDATES'|'FORUMS'|'PERSONAL')[] // Gmail's automatic categories

  // Additional raw Gmail fields used in some onboarding routes
  id?: string // Raw Gmail message ID (alias for gmailMessageId)
  threadId?: string // Raw Gmail thread ID (alias for gmailThreadId)
  payload?: {
    headers?: Array<{ name: string; value: string }>
    body?: { data?: string }
    parts?: any[]
  }
}

interface GmailMessage {
  id: string
  threadId?: string // Gmail's thread ID
  payload: {
    headers: Array<{ name: string; value: string }>
    body?: { data?: string }
    parts?: Array<{
      mimeType: string
      filename?: string
      body?: { data?: string; attachmentId?: string }
      parts?: Array<{
        mimeType: string
        filename?: string
        body?: { data?: string; attachmentId?: string }
        parts?: any[]
      }>
    }>
  }
  snippet: string
  labelIds?: string[]
}

export interface GmailDraftData {
  draftId: string
  messageId?: string
  threadId?: string
  subject: string
  body: string
  to: string[]
  cc: string[]
  snippet: string
  inReplyTo?: string
  references?: string
}

type DraftCacheEntry = {
  data: GmailDraftData
  expiresAt: number
}

const DRAFT_CACHE_TTL_MS = 60_000
const DRAFT_CACHE_MAX = 200
const draftCache = new Map<string, DraftCacheEntry>()

function getDraftCacheKey(userId: string, draftId: string) {
  return `${userId || 'anonymous'}:${draftId}`
}

function evictDraftCacheEntry(userId: string, draftId: string) {
  draftCache.delete(getDraftCacheKey(userId, draftId))
}

export class GmailService {
  private gmail: any
  private auth: any
  private userId: string
  private mailboxId: string | null

  constructor(accessToken: string, refreshToken?: string, userId?: string, mailboxId?: string | null) {
    this.userId = userId || ''
    this.mailboxId = mailboxId ?? null
    this.auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.NEXTAUTH_URL + '/api/auth/callback/google'
    )

    this.auth.setCredentials({ 
      access_token: accessToken,
      refresh_token: refreshToken
    })

    this.gmail = google.gmail({ version: 'v1', auth: this.auth })
  }

  getOAuthClient() {
    return this.auth
  }

  getNativeGmailClient() {
    return this.gmail
  }

  async ensureAuthenticated(): Promise<void> {
    await this.refreshTokenIfNeeded()
  }

  private async refreshTokenIfNeeded(): Promise<void> {
    try {
      // Check if token needs refresh by making a simple API call
      await this.gmail.users.getProfile({ userId: 'me' })
    } catch (error: any) {
      if (error.code === 401) {
        if (this.auth.credentials.refresh_token && this.userId) {
          console.log('Access token expired, attempting to refresh...')
          try {
            const { credentials } = await this.auth.refreshAccessToken()
            this.auth.setCredentials(credentials)
            
            // Update the token in database
            if (credentials.access_token) {
              if (!this.userId) {
                throw new Error('Cannot encrypt refreshed token without user context')
              }

              await prisma.oAuthAccount.updateMany({
                where: {
                  userId: this.userId,
                  provider: 'google',
                  ...(this.mailboxId ? { mailboxId: this.mailboxId } : {}),
                },
                data: {
                  accessToken: encryptToken(credentials.access_token),
                  ...(credentials.refresh_token
                    ? { refreshToken: encryptToken(credentials.refresh_token) }
                    : {}),
                  expiresAt: credentials.expiry_date ? Math.floor(credentials.expiry_date / 1000) : null,
                }
              })
              console.log('Token refreshed successfully')
            }
          } catch (refreshError) {
            console.error('Failed to refresh token:', refreshError)
            throw new Error('OAuth token expired and refresh failed. Please re-authenticate.')
          }
        } else {
          console.error('Access token expired and no refresh token available')
          throw new Error('OAuth token expired and no refresh token available. Please sign out and sign in again to re-authorize Gmail access.')
        }
      } else {
        throw error
      }
    }
  }

  async fetchRecentEmails(maxResults: number = 180): Promise<EmailData[]> {
    try {
      console.log(`Fetching ${maxResults} recent emails...`)
      
      // Ensure token is valid before making requests
      await this.refreshTokenIfNeeded()
      
      // Get list of message IDs
      const listResponse = await this.gmail.users.messages.list({
        userId: 'me',
        maxResults,
        q: 'in:sent' //Only sent emails are needed
      })

      if (!listResponse.data.messages) {
        console.log('No Sent messages found')
        return []
      }

      console.log(`Found ${listResponse.data.messages.length} messages, fetching details...`)

      // Fetch details for each message in batches
      const emails: EmailData[] = []
      const batchSize = 10 // Process in smaller batches to avoid rate limits
      
      for (let i = 0; i < listResponse.data.messages.length; i += batchSize) {
        const batch = listResponse.data.messages.slice(i, i + batchSize)
        console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(listResponse.data.messages.length / batchSize)}`)
        
        const batchPromises = batch.map(async (message: { id: string }) => {
          try {
            const messageResponse = await this.gmail.users.messages.get({
              userId: 'me',
              id: message.id,
              format: 'full'
            })

            return await this.parseEmailMessage(messageResponse.data)
          } catch (error) {
            console.error(`Error fetching message ${message.id}:`, error)
            return null
          }
        })

        const batchResults = await Promise.all(batchPromises)
        emails.push(...batchResults.filter(email => email !== null))

        // Small delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      console.log(`Successfully processed ${emails.length} emails`)
      return emails
    } catch (error) {
      console.error('Error fetching emails:', error)
      throw error
    }
  }

  async fetchAndParseEmails(maxResults: number = 180): Promise<EmailData[]> {
    try {
      console.log(`Fetching and parsing ${maxResults} recent emails without storing...`)
      
      await this.refreshTokenIfNeeded()
      
      const listResponse = await this.gmail.users.messages.list({
        userId: 'me',
        maxResults,
        q: 'in:sent'
      })

      if (!listResponse.data.messages) {
        console.log('No Sent messages found')
        return []
      }

      console.log(`Found ${listResponse.data.messages.length} messages, fetching details...`)

      const emails: EmailData[] = []
      const batchSize = 10
      
      for (let i = 0; i < listResponse.data.messages.length; i += batchSize) {
        const batch = listResponse.data.messages.slice(i, i + batchSize)
        console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(listResponse.data.messages.length / batchSize)}`)
        
        const batchPromises = batch.map(async (message: { id: string }) => {
          try {
            const messageResponse = await this.gmail.users.messages.get({
              userId: 'me',
              id: message.id,
              format: 'full'
            })

            return await this.parseEmailMessage(messageResponse.data)
          } catch (error) {
            console.error(`Error fetching message ${message.id}:`, error)
            return null
          }
        })

        const batchResults = await Promise.all(batchPromises)
        emails.push(...batchResults.filter((email): email is EmailData => email !== null));

        await new Promise(resolve => setTimeout(resolve, 100))
      }

      console.log(`Successfully parsed ${emails.length} emails without storing.`)
      return emails
    } catch (error) {
      console.error('Error fetching and parsing emails:', error)
      throw error
    }
  }

  async fetchInboxEmailsSecurely(maxResults: number = 500): Promise<EmailData[]> {
    try {
      console.log(`Fetching and parsing ${maxResults} inbox emails for labeling analysis...`)
      
      await this.refreshTokenIfNeeded()
      
      // Fetch inbox emails excluding spam, promotions, social, and sent items
      const listResponse = await this.gmail.users.messages.list({
        userId: 'me',
        maxResults,
        labelIds: ['INBOX'],
        q: '-in:sent -category:promotions -category:social -category:forums -category:updates'
      })

      if (!listResponse.data.messages) {
        console.log('No inbox messages found')
        return []
      }

      console.log(`Found ${listResponse.data.messages.length} inbox messages, fetching details...`)

      const emails: EmailData[] = []
      const batchSize = 10
      
      for (let i = 0; i < listResponse.data.messages.length; i += batchSize) {
        const batch = listResponse.data.messages.slice(i, i + batchSize)
        console.log(`Processing inbox batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(listResponse.data.messages.length / batchSize)}`)
        
        const batchPromises = batch.map(async (message: { id: string }) => {
          try {
            const messageResponse = await this.gmail.users.messages.get({
              userId: 'me',
              id: message.id,
              format: 'full'
            })

            return await this.parseEmailMessage(messageResponse.data)
          } catch (error) {
            console.error(`Error fetching inbox message ${message.id}:`, error)
            return null
          }
        })

        const batchResults = await Promise.all(batchPromises)
        emails.push(...batchResults.filter((email): email is EmailData => email !== null));

        await new Promise(resolve => setTimeout(resolve, 100))
      }

      console.log(`Successfully parsed ${emails.length} inbox emails for labeling analysis.`)
      return emails
    } catch (error) {
      console.error('Error fetching inbox emails:', error)
      throw error
    }
  }

  /**
   * List Gmail message IDs that currently have the specified Gmail label ID.
   * Excludes spam and trash by default.
   */
  async listMessageIdsByLabel(
    gmailLabelId: string,
    options?: { maxResults?: number; excludeSpamTrash?: boolean }
  ): Promise<string[]> {
    const maxResults = options?.maxResults ?? 500
    const excludeSpamTrash = options?.excludeSpamTrash ?? true
    await this.refreshTokenIfNeeded()
    const listResp = await this.gmail.users.messages.list({
      userId: 'me',
      labelIds: [gmailLabelId],
      maxResults,
      q: excludeSpamTrash ? '-in:spam -in:trash' : undefined
    })
    return (listResp.data.messages || []).map((m: any) => m.id)
  }

  /**
   * Search message IDs by sender. Optionally include archived messages via in:anywhere.
   */
  async searchMessageIdsBySender(senderEmail: string, options?: { maxResults?: number; includeArchived?: boolean; daysBack?: number }): Promise<string[]> {
    const maxResults = options?.maxResults ?? 200
    const includeArchived = options?.includeArchived ?? true
    const daysBack = options?.daysBack
    try {
      await this.refreshTokenIfNeeded()
      const qParts: string[] = []
      qParts.push(`from:${senderEmail}`)
      qParts.push('-in:spam', '-in:trash')
      if (!includeArchived) {
        qParts.push('in:inbox')
      } else {
        qParts.push('in:anywhere')
      }
      if (daysBack && daysBack > 0) {
        qParts.push(`newer_than:${daysBack}d`)
      }
      const q = qParts.join(' ')
      const listResponse = await this.gmail.users.messages.list({
        userId: 'me',
        maxResults,
        q
      })
      const messages = listResponse.data.messages || []
      return messages.map((m: any) => m.id)
    } catch (error) {
      console.error(`Error searching messages for sender ${senderEmail}:`, error)
      return []
    }
  }



  /**
   * Build a raw RFC 2822 message for sending or draft creation
   */
  private buildRawReplyMessage(params: {
    to: string;
    cc?: string[];
    subject: string;
    body: string;
    inReplyTo?: string;
    references?: string;
  }): string {
    const { to, cc, subject, body, inReplyTo, references } = params;

    // Build proper References chain for email threading
    let referencesHeader = '';
    if (references && inReplyTo) {
      referencesHeader = `${references} ${inReplyTo}`;
    } else if (references) {
      referencesHeader = references;
    } else if (inReplyTo) {
      referencesHeader = inReplyTo;
    }

    // --- Build a robust multipart/alternative message ---
    const boundary = `----=_Part_${Math.random().toString(36).substring(2)}`;

    // 1. Plain text version (remove markdown formatting for plain text)
    const plainBody = body
      .replace(/\*\*(.*?)\*\*/g, '$1') // Remove **bold** formatting
      .replace(/\*(.*?)\*/g, '$1')     // Remove *italic* formatting
      .replace(/__(.*?)__/g, '$1')     // Remove __bold__ formatting
      .replace(/_(.*?)_/g, '$1');      // Remove _italic_ formatting

    // Normalize line endings to CRLF for RFC 2822 compliance
    const plainBodyCRLF = plainBody.replace(/\r?\n/g, '\r\n');

    // 2. HTML version (convert markdown to HTML)
    const htmlBody = body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Convert **bold** to <strong>
      .replace(/\*(.*?)\*/g, '<em>$1</em>')             // Convert *italic* to <em>
      .replace(/__(.*?)__/g, '<strong>$1</strong>')     // Convert __bold__ to <strong>
      .replace(/_(.*?)_/g, '<em>$1</em>')               // Convert _italic_ to <em>
      .replace(/\n/g, '<br>');

    const emailParts = [
      `To: ${to}`,
      cc && cc.length > 0 ? `Cc: ${cc.join(', ')}` : undefined,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      inReplyTo ? `In-Reply-To: ${inReplyTo}` : undefined,
      referencesHeader ? `References: ${referencesHeader}` : undefined,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      // Use 8bit to safely carry UTF-8 characters in body
      'Content-Transfer-Encoding: 8bit',
      '',
      plainBodyCRLF,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      // Use 8bit to safely carry UTF-8 characters in body
      'Content-Transfer-Encoding: 8bit',
      '',
      // Wrap in a simple HTML structure for better compatibility
      `<!DOCTYPE html><html><body>${htmlBody}</body></html>`,
      '',
      `--${boundary}--`
    ];
    
    // Join with CRLF to ensure Gmail parses headers/body correctly
    return emailParts
      .filter(part => part !== null && part !== undefined)
      .join('\r\n');
  }

  async sendEmail(params: {
    to: string;
    cc?: string[];
    subject: string;
    body: string;
    inReplyTo?: string;
    references?: string;
    threadId?: string;
  }): Promise<any> {
    await this.refreshTokenIfNeeded();

    const { to, cc, subject, body, inReplyTo, references, threadId } = params;

    const rawMessage = this.buildRawReplyMessage({ to, cc, subject, body, inReplyTo, references });
    
    const encodedMessage = Buffer.from(rawMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    
    const requestBody: { raw: string; threadId?: string } = {
      raw: encodedMessage,
    };
    if (threadId) {
      requestBody.threadId = threadId;
    }

    try {
      console.log(`📧 Sending multipart email to: ${to}`);
      if (cc && cc.length > 0) {
        console.log(`   CC: ${cc.join(', ')}`);
      }
      console.log(`   Subject: ${subject}`);
      console.log(`   In-Reply-To: ${inReplyTo || 'none'}`);
      console.log(`   References: ${references || 'none'}`);
      
      const response = await this.gmail.users.messages.send({
        userId: 'me',
        requestBody,
      });
      console.log(`✅ Email sent successfully to ${to}${cc && cc.length > 0 ? ` (CC: ${cc.join(', ')})` : ''}. Message ID: ${response.data.id}`);
      return response.data;
    } catch (error) {
      console.error(`❌ Error sending email to ${to}:`, error);
      throw error;
    }
  }

  /**
   * Create a Gmail reply draft for a given email
   */
  async createDraftReply(params: {
    to: string;
    cc?: string[];
    subject: string;
    body: string;
    inReplyTo?: string;
    references?: string;
    threadId?: string;
    labelIds?: string[];
  }): Promise<{ draftId: string; messageId?: string; threadId?: string }> {
    await this.refreshTokenIfNeeded();

    const { to, cc, subject, body, inReplyTo, references, threadId, labelIds } = params;

    const rawMessage = this.buildRawReplyMessage({ to, cc, subject, body, inReplyTo, references });
    
    const encodedMessage = Buffer.from(rawMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const requestBody: { message: { raw: string; threadId?: string; labelIds?: string[] } } = {
      message: {
        raw: encodedMessage,
      },
    };

    if (threadId) {
      requestBody.message.threadId = threadId;
    }

    if (labelIds && labelIds.length > 0) {
      requestBody.message.labelIds = labelIds;
    }

    try {
      console.log(`📝 Creating Gmail draft reply to: ${to}`);
      if (cc && cc.length > 0) {
        console.log(`   CC: ${cc.join(', ')}`);
      }
      console.log(`   Subject: ${subject}`);
      console.log(`   Thread ID: ${threadId || 'none'}`);
      
      const response = await this.gmail.users.drafts.create({
        userId: 'me',
        requestBody,
      });
      
      console.log(`✅ Gmail draft created successfully. Draft ID: ${response.data.id}`);
      
      return {
        draftId: response.data.id!,
        messageId: response.data.message?.id,
        threadId: response.data.message?.threadId,
      };
    } catch (error) {
      console.error(`❌ Error creating Gmail draft for ${to}:`, error);
      throw error;
    }
  }

  /**
   * Fetch a Gmail draft message and decode its content
   */
  async getDraft(draftId: string): Promise<GmailDraftData | null> {
    await this.refreshTokenIfNeeded();

    const cacheKey = getDraftCacheKey(this.userId, draftId);
    const now = Date.now();
    const cached = draftCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      // Refresh LRU order
      draftCache.delete(cacheKey);
      draftCache.set(cacheKey, cached);
      return cached.data;
    }
    if (cached) {
      draftCache.delete(cacheKey);
    }

    try {
      const response = await this.gmail.users.drafts.get({
        userId: 'me',
        id: draftId,
        format: 'full',
      });

      const message = response.data?.message as GmailMessage | undefined;
      if (!message) {
        return null;
      }

      const parsed = await this.parseEmailMessage(message);
      if (!parsed) {
        return null;
      }

      const data: GmailDraftData = {
        draftId,
        messageId: message.id,
        threadId: message.threadId,
        subject: parsed.subject,
        body: parsed.body,
        to: parsed.to,
        cc: parsed.cc,
        snippet: parsed.snippet,
        inReplyTo: parsed.inReplyTo,
        references: parsed.references,
      };

      draftCache.set(cacheKey, {
        data,
        expiresAt: now + DRAFT_CACHE_TTL_MS,
      });

      if (draftCache.size > DRAFT_CACHE_MAX) {
        const oldestKey = draftCache.keys().next().value;
        if (oldestKey) {
          draftCache.delete(oldestKey);
        }
      }

      return data;
    } catch (error) {
      console.warn(`⚠️ Failed to retrieve Gmail draft ${draftId}:`, error);
      return null;
    }
  }

  /**
   * Send an existing Gmail draft
   */
  async sendDraft(draftId: string): Promise<{ id: string; threadId?: string }> {
    await this.refreshTokenIfNeeded();

    try {
      console.log(`📤 Sending Gmail draft: ${draftId}`);
      
      const response = await this.gmail.users.drafts.send({
        userId: 'me',
        requestBody: {
          id: draftId,
        },
      });

      evictDraftCacheEntry(this.userId, draftId)
      
      console.log(`✅ Draft sent successfully. Message ID: ${response.data.id}`);
      
      return {
        id: response.data.id,
        threadId: response.data.threadId,
      };
    } catch (error) {
      console.error(`❌ Error sending Gmail draft ${draftId}:`, error);
      throw error;
    }
  }

  async deleteDraft(draftId: string): Promise<void> {
    await this.refreshTokenIfNeeded();

    try {
      console.log(`🗑️ Deleting Gmail draft: ${draftId}`);

      await this.gmail.users.drafts.delete({
        userId: 'me',
        id: draftId,
      });

      evictDraftCacheEntry(this.userId, draftId)
      console.log(`✅ Draft deleted successfully: ${draftId}`);
    } catch (error) {
      evictDraftCacheEntry(this.userId, draftId)
      console.error(`❌ Error deleting Gmail draft ${draftId}:`, error);
      throw error;
    }
  }

  /**
   * Update an existing Gmail draft (optional - can be implemented later if needed)
   */
  async updateDraft(draftId: string, params: {
    to: string;
    cc?: string[];
    subject: string;
    body: string;
    inReplyTo?: string;
    references?: string;
    threadId?: string;
  }): Promise<{ draftId: string; messageId?: string; threadId?: string }> {
    await this.refreshTokenIfNeeded();

    const { to, cc, subject, body, inReplyTo, references, threadId } = params;

    const rawMessage = this.buildRawReplyMessage({ to, cc, subject, body, inReplyTo, references });
    
    const encodedMessage = Buffer.from(rawMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const requestBody: { id: string; message: { raw: string; threadId?: string } } = {
      id: draftId,
      message: {
        raw: encodedMessage,
      },
    };
    
    if (threadId) {
      requestBody.message.threadId = threadId;
    }

    try {
      console.log(`✏️ Updating Gmail draft: ${draftId}`);
      
      const response = await this.gmail.users.drafts.update({
        userId: 'me',
        id: draftId,
        requestBody,
      });

      evictDraftCacheEntry(this.userId, draftId)
      
      console.log(`✅ Draft updated successfully. Draft ID: ${response.data.id}`);
      
      return {
        draftId: response.data.id!,
        messageId: response.data.message?.id,
        threadId: response.data.message?.threadId,
      };
    } catch (error) {
      console.error(`❌ Error updating Gmail draft ${draftId}:`, error);
      throw error;
    }
  }

  private async fetchMessageAttachmentData(messageId: string, attachmentId: string): Promise<string | null> {
    try {
      const response = await this.gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: attachmentId,
      })

      return typeof response.data?.data === 'string' ? response.data.data : null
    } catch (error) {
      logger.warn('[GmailService] failed to fetch textual attachment while parsing email body', {
        messageId,
        attachmentId,
        error,
      })
      return null
    }
  }

  private async parseEmailMessage(message: GmailMessage): Promise<EmailData | null> {
    try {
      const headers = message.payload.headers
      const getHeader = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || ''

      // Extract email addresses
      const parseEmailAddresses = (addressString: string): string[] => {
        if (!addressString) return []
        return addressString.split(',').map(addr => {
          const match = addr.match(/<([^>]+)>/)
          return match ? match[1].trim() : addr.trim()
        }).filter(addr => addr.includes('@'))
      }

      // Extract Gmail categories from label IDs
      const extractGmailCategories = (labelIds?: string[]): ('PROMOTIONS'|'SOCIAL'|'UPDATES'|'FORUMS'|'PERSONAL')[] => {
        if (!labelIds) return []
        const categories: ('PROMOTIONS'|'SOCIAL'|'UPDATES'|'FORUMS'|'PERSONAL')[] = []
        
        if (labelIds.includes('CATEGORY_PROMOTIONS')) categories.push('PROMOTIONS')
        if (labelIds.includes('CATEGORY_SOCIAL')) categories.push('SOCIAL')
        if (labelIds.includes('CATEGORY_UPDATES')) categories.push('UPDATES')
        if (labelIds.includes('CATEGORY_FORUMS')) categories.push('FORUMS')
        if (labelIds.includes('CATEGORY_PERSONAL')) categories.push('PERSONAL')
        
        return categories
      }

      const from = getHeader('From')
      const to = parseEmailAddresses(getHeader('To'))
      const cc = parseEmailAddresses(getHeader('Cc'))
      const subject = getHeader('Subject')
      const dateHeader = getHeader('Date')
      const inlineBody = extractGmailPayloadBodyText(message.payload)
      const body =
        inlineBody ||
        await extractGmailPayloadBodyTextWithAttachments(
          message.payload,
          async ({ attachmentId }) => this.fetchMessageAttachmentData(message.id, attachmentId),
        )
      
      // Determine if email is sent or received
      const isSent = message.labelIds?.includes('SENT') || false
      const isDraft = message.labelIds?.includes('DRAFT') || false
      const hasAttachments = this.detectAttachments(message.payload)

      return {
        messageId: message.id,
        gmailMessageId: message.id,
        gmailThreadId: message.threadId,
        rfc2822MessageId: getHeader('Message-ID'),
        references: getHeader('References'),
        inReplyTo: getHeader('In-Reply-To'),
        from,
        to,
        cc,
        subject,
        body: truncateGmailExtractedBody(body),
        snippet: message.snippet || '',
        isSent,
        isDraft,
        date: dateHeader ? new Date(dateHeader) : new Date(),
        hasAttachments,
        labelIds: message.labelIds,
        gmailCategories: extractGmailCategories(message.labelIds)
      }
    } catch (error) {
      console.error('Error parsing email message:', error)
      return null
    }
  }

  private detectAttachments(payload: GmailMessage['payload']): boolean {
    const parts = payload.parts;
    if (!parts) return false;
    return parts.some((part) => {
      if (part.filename && part.filename.length > 0) return true;
      if (part.body?.attachmentId) return true;
      if (part.parts) {
        return part.parts.some(
          (sub) =>
            (sub.filename && sub.filename.length > 0) ||
            !!sub.body?.attachmentId,
        );
      }
      return false;
    });
  }

  /**
   * Set credentials for batch sorting worker
   */
  setCredentials(credentials: any): void {
    this.auth.setCredentials(credentials);
  }

  /**
   * Get a single email message by its Gmail message ID
   */
  async getMessage(messageId: string): Promise<EmailData | null> {
    try {
      console.log(`Fetching single message: ${messageId}`);
      
      await this.refreshTokenIfNeeded();
      
      const messageResponse = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full'
      });

      return await this.parseEmailMessage(messageResponse.data);
    } catch (error) {
      console.error(`Error fetching message ${messageId}:`, error);
      return null;
    }
  }

  /**
   * Search emails using Gmail query syntax
   */
  async searchEmails(query: string, maxResults: number = 50): Promise<EmailData[]> {
    try {
      console.log(`Searching emails with query: "${query}" (max: ${maxResults})`);
      
      await this.refreshTokenIfNeeded();
      
      // Get list of message IDs matching the query
      const listResponse = await this.gmail.users.messages.list({
        userId: 'me',
        maxResults,
        q: query
      });

      if (!listResponse.data.messages) {
        console.log('No messages found for query');
        return [];
      }

      console.log(`Found ${listResponse.data.messages.length} messages matching query`);

      // Fetch details for each message and parse them to EmailData
      const emails: EmailData[] = [];
      const batchSize = 10;
      
      for (let i = 0; i < listResponse.data.messages.length; i += batchSize) {
        const batch = listResponse.data.messages.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (message: { id: string }) => {
          try {
            const messageResponse = await this.gmail.users.messages.get({
              userId: 'me',
              id: message.id,
              format: 'full'
            });

            return await this.parseEmailMessage(messageResponse.data);
          } catch (error) {
            console.error(`Error fetching message ${message.id}:`, error);
            return null;
          }
        });

        const batchResults = await Promise.all(batchPromises);
        emails.push(...batchResults.filter((email): email is EmailData => email !== null));

        // Small delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      console.log(`Successfully fetched ${emails.length} email details`);
      return emails;
    } catch (error) {
      console.error('Error searching emails:', error);
      throw error;
    }
  }

  /**
   * Search threads with pagination support and return full thread conversations.
   * Uses threads.list to find matching threads, then fetchFullThread to get all messages.
   *
   * @param query - Gmail search query (supports keywords, from:, to:, newer_than:, etc.)
   * @param options - Pagination options (maxResults per page, pageToken)
   * @returns Threads plus nextPageToken for subsequent pages
   */
  async searchThreadsPaged(
    query: string,
    options: { maxResults?: number; pageToken?: string } = {},
  ): Promise<{ threads: Array<{ threadId: string; emails: EmailData[] }>; nextPageToken?: string }> {
    try {
      const maxResults = options.maxResults ?? 20;
      console.log(`Searching threads (paged) with query: "${query}" (max: ${maxResults})`);

      await this.refreshTokenIfNeeded();

      const listResponse = await this.withBackoff(
        `threads.list:${query}:${options.pageToken ?? 'first-page'}`,
        async () =>
          this.gmail.users.threads.list({
            userId: 'me',
            maxResults,
            q: query,
            pageToken: options.pageToken,
          }),
        5,
        { swallowPermissionError: false },
      );

      const nextPageToken = listResponse.data.nextPageToken ?? undefined;
      const threadList = listResponse.data.threads ?? [];

      if (threadList.length === 0) {
        console.log('No threads found for query');
        return { threads: [], nextPageToken };
      }

      console.log(`Found ${threadList.length} threads matching query`);

      const threads: Array<{ threadId: string; emails: EmailData[] }> = [];
      const batchSize = 5;

      for (let i = 0; i < threadList.length; i += batchSize) {
        const batch = threadList.slice(i, i + batchSize);

        const batchPromises = batch.map(async (thread: { id: string }) => {
          try {
            const emails = await this.fetchFullThread(thread.id);

            if (!emails || emails.length === 0) {
              return null;
            }

            return {
              threadId: thread.id,
              emails,
            };
          } catch (error) {
            console.error(`Error fetching thread ${thread.id}:`, error);
            return null;
          }
        });

        const batchResults = await Promise.all(batchPromises);
        threads.push(
          ...batchResults.filter(
            (thread): thread is { threadId: string; emails: EmailData[] } => thread !== null,
          ),
        );

        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      const totalEmails = threads.reduce((sum, t) => sum + t.emails.length, 0);
      console.log(`Successfully fetched ${threads.length} threads with ${totalEmails} total emails`);
      return { threads, nextPageToken };
    } catch (error) {
      console.error('Error searching threads (paged):', error);
      throw error;
    }
  }

  /**
   * Search threads using Gmail query syntax and return complete thread conversations.
   * Uses threads.list to find matching threads, then fetchFullThread to get all messages.
   *
   * @param query - Gmail search query (supports keywords, from:, to:, newer_than:, etc.)
   * @param maxResults - Maximum number of threads to return (default: 20)
   * @returns Array of thread objects, each containing all messages in chronological order
   */
  async searchThreads(
    query: string,
    maxResults: number = 20
  ): Promise<Array<{ threadId: string; emails: EmailData[] }>> {
    try {
      console.log(`Searching threads with query: "${query}" (max: ${maxResults})`);

      await this.refreshTokenIfNeeded();

      // Get list of thread IDs matching the query
      const listResponse = await this.gmail.users.threads.list({
        userId: 'me',
        maxResults,
        q: query
      });

      if (!listResponse.data.threads) {
        console.log('No threads found for query');
        return [];
      }

      console.log(`Found ${listResponse.data.threads.length} threads matching query`);

      // Fetch full thread details for each thread ID
      const threads: Array<{ threadId: string; emails: EmailData[] }> = [];
      const batchSize = 5; // Smaller batch size since we're fetching full threads

      for (let i = 0; i < listResponse.data.threads.length; i += batchSize) {
        const batch = listResponse.data.threads.slice(i, i + batchSize);

        const batchPromises = batch.map(async (thread: { id: string }) => {
          try {
            const emails = await this.fetchFullThread(thread.id);

            if (!emails || emails.length === 0) {
              return null;
            }

            return {
              threadId: thread.id,
              emails
            };
          } catch (error) {
            console.error(`Error fetching thread ${thread.id}:`, error);
            return null;
          }
        });

        const batchResults = await Promise.all(batchPromises);
        threads.push(...batchResults.filter((thread): thread is { threadId: string; emails: EmailData[] } => thread !== null));

        // Small delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 150));
      }

      const totalEmails = threads.reduce((sum, t) => sum + t.emails.length, 0);
      console.log(`Successfully fetched ${threads.length} threads with ${totalEmails} total emails`);
      return threads;
    } catch (error) {
      console.error('Error searching threads:', error);
      throw error;
    }
  }

  /**
   * Add a label to an email
   */
  async addLabelToEmail(messageId: string, labelId: string): Promise<void> {
    await this.withBackoff(`addLabel:${labelId}:${messageId}`, async () => {
      await this.refreshTokenIfNeeded();
      await this.gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: { addLabelIds: [labelId] }
      });
      console.log(`Added label ${labelId} to message ${messageId}`);
    });
  }

  /**
   * Remove a label from an email
   */
  async removeLabelFromEmail(messageId: string, labelId: string): Promise<void> {
    await this.withBackoff(`removeLabel:${labelId}:${messageId}`, async () => {
      await this.refreshTokenIfNeeded();
      await this.gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: { removeLabelIds: [labelId] }
      });
      console.log(`Removed label ${labelId} from message ${messageId}`);
    });
  }

  /**
   * Modify labels on an email in a single request
   */
  async modifyLabelsOnEmail(messageId: string, addLabelIds: string[] = [], removeLabelIds: string[] = []): Promise<void> {
    await this.withBackoff(`modifyLabels:${messageId}`, async () => {
      await this.refreshTokenIfNeeded();
      await this.gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
          addLabelIds: addLabelIds && addLabelIds.length > 0 ? addLabelIds : undefined,
          removeLabelIds: removeLabelIds && removeLabelIds.length > 0 ? removeLabelIds : undefined
        }
      });
      console.log(`Modified labels on message ${messageId}: +${addLabelIds?.length || 0} / -${removeLabelIds?.length || 0}`);
    });
  }

  /**
   * Generic backoff for Gmail 429/5xx and network errors, with jitter.
   */
  private async withBackoff<T>(
    label: string,
    fn: () => Promise<T>,
    maxRetries: number = 5,
    options?: { swallowPermissionError?: boolean },
  ): Promise<T> {
    const swallowPermissionError = options?.swallowPermissionError ?? true;
    let attempt = 0;
    let lastErr: any = null;
    while (attempt <= maxRetries) {
      try {
        return await fn();
      } catch (error: any) {
        // Insufficient permission: don't retry
        if (error?.status === 403 && String(error?.message || '').includes('Insufficient Permission')) {
          if (!swallowPermissionError) {
            throw error;
          }
          console.warn(`[GMAIL] Permission error for ${label}. Skipping.`);
          // @ts-expect-error intentionally returning undefined on permission error to skip gracefully
          return; // do not throw
        }
        // Retry on 429/5xx
        const status = error?.status || error?.code;
        const isRetryable = status === 429 || (status >= 500 && status < 600);
        if (!isRetryable || attempt === maxRetries) {
          console.error(`[GMAIL] Failed ${label} after ${attempt} retries:`, error);
          throw error;
        }
        const base = 500 * Math.pow(2, attempt); // 500ms, 1s, 2s, 4s, 8s...
        const jitter = Math.floor(Math.random() * 200);
        const delay = base + jitter;
        console.warn(`[GMAIL] ${label} retry ${attempt + 1}/${maxRetries} in ${delay}ms (status ${status})`);
        await new Promise(r => setTimeout(r, delay));
        attempt++;
        lastErr = error;
      }
    }
    throw lastErr;
  }

  /**
   * Create a Gmail label
   */
  async createLabel(name: string, labelListVisibility: string = 'labelShow', messageListVisibility: string = 'show', backgroundColor?: string, textColor?: string): Promise<string> {
    try {
      await this.refreshTokenIfNeeded();
      
      const requestBody: any = {
        name,
        labelListVisibility,
        messageListVisibility
      };

      // Add color object if provided (Gmail API expects a color object)
      if (backgroundColor) {
        requestBody.color = {
          backgroundColor: backgroundColor,
          textColor: textColor || '#ffffff'
        };
      }
      
      const response = await this.gmail.users.labels.create({
        userId: 'me',
        requestBody
      });
      
      console.log(`Created Gmail label "${name}" with ID: ${response.data.id}`);
      return response.data.id;
    } catch (error) {
      console.error(`Error creating Gmail label "${name}":`, error);
      throw error;
    }
  }

  /**
   * Get all Gmail labels
   */
  async getLabels(): Promise<Array<{ 
    id: string; 
    name: string; 
    type?: string;
    backgroundColor?: string;
    textColor?: string;
  }>> {
    try {
      await this.refreshTokenIfNeeded();
      
      const response = await this.gmail.users.labels.list({
        userId: 'me'
      });
      
      const labels = response.data.labels || [];
      
      // Map the response to extract color information properly according to Gmail API docs
      const mappedLabels = labels.map((label: any) => {
        // Gmail API returns color as an object with backgroundColor and textColor
        let backgroundColor: string | undefined;
        let textColor: string | undefined;
        
        if (label.color && typeof label.color === 'object') {
          backgroundColor = label.color.backgroundColor;
          textColor = label.color.textColor;
        }
        
        // If no color is set, provide a default color based on the label name
        if (!backgroundColor) {
          // Generate a consistent color based on label name hash
          const hash = label.name.split('').reduce((a: number, b: string) => {
            a = ((a << 5) - a + b.charCodeAt(0)) & 0xffffffff;
            return a;
          }, 0);
          
          // Use predefined Gmail-like colors
          const defaultColors = [
            '#4285f4', // Gmail Blue
            '#ea4335', // Gmail Red  
            '#fbbc04', // Gmail Yellow
            '#34a853', // Gmail Green
            '#ff6d01', // Gmail Orange
            '#46bdc6', // Gmail Teal
            '#7b1fa2', // Gmail Purple
            '#f06292', // Gmail Pink
            '#795548', // Gmail Brown
            '#607d8b'  // Gmail Blue Grey
          ];
          
          backgroundColor = defaultColors[Math.abs(hash) % defaultColors.length];
          textColor = '#ffffff'; // White text for contrast
        }
        
        logger.debug(`Gmail API label "${label.name}":`, {
          id: label.id,
          type: label.type,
          color: label.color,
          backgroundColor: backgroundColor,
          textColor: textColor
        });
        
        return {
          id: label.id,
          name: label.name,
          type: label.type,
          backgroundColor: backgroundColor,
          textColor: textColor
        };
      });
      
      return mappedLabels;
    } catch (error) {
      console.error('Error fetching Gmail labels:', error);
      throw error;
    }
  }

  /**
   * Update a Gmail label
   */
  async updateLabel(labelId: string, updates: { name?: string; labelListVisibility?: string; messageListVisibility?: string; backgroundColor?: string; textColor?: string }): Promise<void> {
    try {
      await this.refreshTokenIfNeeded();
      
      // Convert color properties to Gmail API format
      const requestBody: any = { ...updates };
      
      if (updates.backgroundColor || updates.textColor) {
        requestBody.color = {
          backgroundColor: updates.backgroundColor,
          textColor: updates.textColor || '#ffffff'
        };
        // Remove the individual color properties as they're now in the color object
        delete requestBody.backgroundColor;
        delete requestBody.textColor;
      }
      
      console.log(`Updating Gmail label ${labelId} with:`, requestBody);
      
      await this.gmail.users.labels.update({
        userId: 'me',
        id: labelId,
        requestBody
      });
      
      console.log(`Successfully updated Gmail label ${labelId}`);
    } catch (error) {
      console.error(`Error updating Gmail label ${labelId}:`, error);
      console.error('Error details:', (error as any).response?.data || (error as Error).message);
      throw error;
    }
  }

  /**
   * Delete a Gmail label
   */
  async deleteLabel(labelId: string): Promise<void> {
    try {
      await this.refreshTokenIfNeeded();
      
      await this.gmail.users.labels.delete({
        userId: 'me',
        id: labelId
      });
      
      console.log(`Deleted Gmail label ${labelId}`);
    } catch (error) {
      console.error(`Error deleting Gmail label ${labelId}:`, error);
      throw error;
    }
  }

  /**
   * Get the latest SENT message timestamp (internalDate) in a Gmail thread.
   * Returns null if none found or on safe errors.
   */
  async getLatestSentInThread(threadId: string): Promise<{ messageId: string; internalDate: number } | null> {
    try {
      await this.refreshTokenIfNeeded()
      const resp = await this.gmail.users.threads.get({
        userId: 'me',
        id: threadId,
        // Reduce payload: we only need ids, internalDate, and labelIds
        format: 'minimal',
        fields: 'id,messages(id,internalDate,labelIds)'
      })

      const messages = (resp.data?.messages || []) as Array<{ id: string; internalDate?: string; labelIds?: string[] }>
      let latest: { messageId: string; internalDate: number } | null = null
      for (const m of messages) {
        const hasSent = (m.labelIds || []).includes('SENT')
        if (!hasSent) continue
        const ts = m.internalDate ? Number(m.internalDate) : NaN
        if (!Number.isFinite(ts)) continue
        if (!latest || ts > latest.internalDate) {
          latest = { messageId: m.id, internalDate: ts }
        }
      }
      return latest
    } catch (err: any) {
      if (err?.code === 404 || err?.status === 404) {
        console.warn(`Thread ${threadId} not found (404) while checking latest SENT`)
        return null
      }
      console.error('Error fetching thread for latest SENT:', err)
      return null
    }
  }

  /**
   * Find a message by RFC822 Message-ID and return its Gmail thread ID.
   */
  async getThreadIdByRfc822MessageId(rfc822MessageId: string): Promise<string | null> {
    try {
      await this.refreshTokenIfNeeded()
      const quoted = rfc822MessageId.includes(' ') ? `"${rfc822MessageId}"` : rfc822MessageId
      const resp = await this.gmail.users.messages.list({
        userId: 'me',
        q: `rfc822msgid:${quoted}`,
        maxResults: 1,
      })
      const msg = resp.data?.messages?.[0]
      if (!msg) return null
      const full = await this.gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'minimal' })
      return full.data?.threadId || null
    } catch (err) {
      console.warn('Error resolving thread by RFC822 Message-ID:', err)
      return null
    }
  }

  /**
   * Fetch unreplied received emails for user profile generation.
   * Returns received emails that:
   * - Are in INBOX
   * - Do NOT have a SENT reply in the same thread
   * - Exclude PROMOTIONAL category
   * - Include SOCIAL and UPDATES categories
   *
   * @param maxResults - Maximum emails to fetch (default: 300)
   * @returns Array of EmailData objects sorted by date (newest first)
   */
  async fetchUnrepliedReceivedEmails(maxResults: number = 300): Promise<EmailData[]> {
    try {
      logger.info(`[GmailService] Fetching up to ${maxResults} unreplied received emails...`)

      await this.refreshTokenIfNeeded()

      // Build query:
      // - in:inbox: only inbox emails
      // - -in:sent: exclude sent emails themselves
      // - -category:promotions: exclude promotional emails
      // - is:unread OR is:read: include both (we'll filter by reply status later)
      const query = 'in:inbox -in:sent -category:promotions'

      const listResponse = await this.gmail.users.messages.list({
        userId: 'me',
        maxResults: maxResults * 2, // Fetch more since we'll filter out replied threads
        q: query
      })

      if (!listResponse.data.messages) {
        logger.info('[GmailService] No unreplied received messages found')
        return []
      }

      logger.info(`[GmailService] Found ${listResponse.data.messages.length} candidate messages, filtering by reply status...`)

      // Fetch full details for each message and check thread for replies
      const emails: EmailData[] = []
      const batchSize = 10
      const seenThreadIds = new Set<string>()

      for (let i = 0; i < listResponse.data.messages.length && emails.length < maxResults; i += batchSize) {
        const batch = listResponse.data.messages.slice(i, i + batchSize)

        const batchPromises = batch.map(async (message: { id: string }) => {
          try {
            const messageResponse = await this.gmail.users.messages.get({
              userId: 'me',
              id: message.id,
              format: 'full'
            })

            const email = await this.parseEmailMessage(messageResponse.data)
            if (!email || email.isSent) {
              return null
            }

            // Skip if we've already seen this thread
            if (email.gmailThreadId && seenThreadIds.has(email.gmailThreadId)) {
              return null
            }

            // Check if thread has a SENT reply
            if (email.gmailThreadId) {
              const hasReply = await this.threadHasSentReply(email.gmailThreadId)
              if (hasReply) {
                return null
              }
              seenThreadIds.add(email.gmailThreadId)
            }

            return email
          } catch (error) {
            logger.error(`[GmailService] Error fetching message ${message.id}:`, error)
            return null
          }
        })

        const batchResults = await Promise.all(batchPromises)
        const validEmails = batchResults.filter((email): email is EmailData => email !== null)
        emails.push(...validEmails)

        // Small delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 100))

        // Log progress
        logger.debug(`[GmailService] Progress: ${emails.length}/${maxResults} unreplied emails collected`)
      }

      // Sort by date (newest first)
      emails.sort((a, b) => b.date.getTime() - a.date.getTime())

      // Trim to maxResults
      const finalEmails = emails.slice(0, maxResults)

      logger.info(`[GmailService] Successfully fetched ${finalEmails.length} unreplied received emails`)
      return finalEmails
    } catch (error) {
      logger.error('[GmailService] Error fetching unreplied received emails:', error)
      throw error
    }
  }

  /**
   * Check if a thread has any SENT replies
   * @param threadId - Gmail thread ID
   * @returns true if thread contains at least one SENT message
   */
  private async threadHasSentReply(threadId: string): Promise<boolean> {
    try {
      const resp = await this.gmail.users.threads.get({
        userId: 'me',
        id: threadId,
        format: 'minimal',
        fields: 'messages(labelIds)'
      })

      const messages = (resp.data?.messages || []) as Array<{ labelIds?: string[] }>
      return messages.some(m => (m.labelIds || []).includes('SENT'))
    } catch (err: any) {
      if (err?.code === 404 || err?.status === 404) {
        return false
      }
      logger.warn(`[GmailService] Error checking thread ${threadId} for replies:`, err)
      return false
    }
  }

  /**
   * Fetch all messages in a thread using the Gmail Threads API
   * Per SUPERMEMORY.md specification:
   * 1. Use threads.get to get message IDs and metadata
   * 2. Fetch full message data for each message ID
   *
   * @param threadId - Gmail thread ID
   * @returns Array of EmailData objects in chronological order, or null on error
   */
  async fetchFullThread(threadId: string): Promise<EmailData[] | null> {
    try {
      await this.refreshTokenIfNeeded()

      // Step 1: Get thread metadata with message IDs
      const threadResponse = await this.withBackoff(
        `threads.get:${threadId}`,
        async () =>
          this.gmail.users.threads.get({
            userId: 'me',
            id: threadId,
            format: 'minimal',
            fields: 'id,messages(id,internalDate)'
          }),
        5,
        { swallowPermissionError: false },
      )

      const messages = threadResponse.data?.messages
      if (!messages || messages.length === 0) {
        logger.debug(`Thread ${threadId} exists but has no messages`)
        return []
      }

      logger.debug(`Thread ${threadId} has ${messages.length} messages, fetching full data...`)

      // Step 2: Fetch full message data for each message
      const emails: EmailData[] = []
      const batchSize = 10

      for (let i = 0; i < messages.length; i += batchSize) {
        const batch = messages.slice(i, i + batchSize)

        const batchPromises = batch.map(async (message: { id: string; internalDate?: string }) => {
          try {
            const messageResponse = await this.withBackoff(
              `messages.get:${message.id}`,
              async () =>
                this.gmail.users.messages.get({
                  userId: 'me',
                  id: message.id,
                  format: 'full'
                }),
              5,
              { swallowPermissionError: false },
            )

            return await this.parseEmailMessage(messageResponse.data)
          } catch (error) {
            logger.error(`Error fetching message ${message.id} in thread ${threadId}:`, error)
            return null
          }
        })

        const batchResults = await Promise.all(batchPromises)
        const validEmails = batchResults.filter((email): email is EmailData => email !== null)
        emails.push(...validEmails)

        // Rate limiting between batches
        if (i + batchSize < messages.length) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }

      // Sort chronologically by date
      emails.sort((a, b) => a.date.getTime() - b.date.getTime())

      logger.debug(`Successfully fetched ${emails.length}/${messages.length} messages from thread ${threadId}`)
      return emails

    } catch (err: any) {
      if (err?.code === 404 || err?.status === 404) {
        logger.warn(`Thread ${threadId} not found (404)`)
        return null
      }
      logger.error(`Error fetching full thread ${threadId}:`, err)
      throw err // Re-throw non-404 errors for proper error handling upstream
    }
  }
}
