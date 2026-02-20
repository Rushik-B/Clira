/**
 * Web Chat API Endpoint for Twilio SMS/RCS
 *
 * Provides a simple POST endpoint for testing the Executive Agent
 * without needing Twilio SMS integration. Uses the same message processing
 * logic but bypasses Twilio-specific features (signature verification,
 * SMS message sending).
 *
 * This endpoint is useful for:
 * - Local development and testing
 * - Iterating on agent prompts and behavior
 * - Debugging conversation flows
 *
 * Authentication: Requires valid session via NextAuth
 */

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { processWebChatMessage } from '@/lib/services/twilio/messageProcessor';
import { getConversationManager } from '@/lib/services/twilio';
import type { ProgressUpdateEvent } from '@/lib/ai/progressTypes';
import { devOnlyGuard } from '@/lib/utils/devOnly';

// ─────────────────────────────────────────────────────────────────────────────
// POST: Send a message
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handles chat messages from the web interface.
 *
 * Request body:
 * {
 *   message: string  // The user's message
 * }
 *
 * Response:
 * {
 *   success: boolean
 *   response: string  // The assistant's response
 *   draft?: {         // Present if a draft was created/updated
 *     to: string[]
 *     cc: string[]
 *     subject: string
 *     body: string
 *   }
 *   conversationId?: string
 *   progress?: Array<{
 *     id: string
 *     text: string
 *     kind: 'ack' | 'deep_search' | 'long_task' | 'clarification'
 *     sequence: number
 *     requestId: string
 *     channel: 'web' | 'twilio' | 'whatsapp'
 *   }>
 * }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const devBlock = devOnlyGuard();
  if (devBlock) return NextResponse.json({ error: 'Not Found' }, { status: 404 });

  try {
    // Authenticate the request
    const session = await getServerSession(authOptions);

    if (!session?.userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 },
      );
    }

    const userId = session.userId;

    // Get user's email
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (!user?.email) {
      return NextResponse.json(
        { error: 'User email not found' },
        { status: 400 },
      );
    }

    // Parse request body
    const body = await request.json();
    const { message } = body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 },
      );
    }

    logger.info(`[Twilio Web Chat] Processing message: userId=${userId.slice(0, 8)}...`);

    // Process the message using the shared handler
    const progressEvents: ProgressUpdateEvent[] = [];
    const requestId = crypto.randomUUID();
    const result = await processWebChatMessage(userId, user.email, message.trim(), {
      requestId,
      onProgress: (event) => {
        progressEvents.push(event);
      },
    });

    // Get the conversation ID for the response
    const conversationManager = getConversationManager();
    const conversation = await conversationManager.getConversationByPhoneNumber(userId, 'web-test');

    return NextResponse.json({
      success: result.success,
      response: result.response,
      conversationId: conversation?.id,
      progress: progressEvents,
    });
  } catch (error) {
    logger.error('[Twilio Web Chat] Error processing message:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process message',
        response: "Something went wrong. Please try again.",
      },
      { status: 500 },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET: Get conversation history
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retrieves the current conversation history and draft.
 *
 * Response:
 * {
 *   success: boolean
 *   conversationId?: string
 *   messages: Array<{
 *     id: string
 *     content: string
 *     role: 'USER' | 'ASSISTANT' | 'SYSTEM'
 *     createdAt: string
 *   }>
 *   draft?: {
 *     to: string[]
 *     cc: string[]
 *     subject: string
 *     body: string
 *   }
 * }
 */
export async function GET(): Promise<NextResponse> {
  const devBlock = devOnlyGuard();
  if (devBlock) return NextResponse.json({ error: 'Not Found' }, { status: 404 });

  try {
    // Authenticate the request
    const session = await getServerSession(authOptions);

    if (!session?.userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 },
      );
    }

    const userId = session.userId;
    const conversationManager = getConversationManager();

    // Get the web-test conversation
    const conversation = await conversationManager.getConversationByPhoneNumber(userId, 'web-test');

    if (!conversation) {
      return NextResponse.json({
        success: true,
        conversationId: null,
        messages: [],
      });
    }

    // Get messages
    const messages = await conversationManager.getRecentMessages(conversation.id, 50);

    return NextResponse.json({
      success: true,
      conversationId: conversation.id,
      messages: messages.map((msg) => ({
        id: msg.id,
        content: msg.content,
        role: msg.role,
        createdAt: msg.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    logger.error('[Twilio Web Chat] Error fetching conversation:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch conversation',
      },
      { status: 500 },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE: Clear conversation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clears the current web chat conversation.
 */
export async function DELETE(): Promise<NextResponse> {
  const devBlock = devOnlyGuard();
  if (devBlock) return NextResponse.json({ error: 'Not Found' }, { status: 404 });

  try {
    // Authenticate the request
    const session = await getServerSession(authOptions);

    if (!session?.userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 },
      );
    }

    const userId = session.userId;
    const conversationManager = getConversationManager();

    // Get the web-test conversation
    const conversation = await conversationManager.getConversationByPhoneNumber(userId, 'web-test');

    if (conversation) {
      await conversationManager.clearConversation(conversation.id);
    }

    return NextResponse.json({
      success: true,
      message: 'Conversation cleared',
    });
  } catch (error) {
    logger.error('[Twilio Web Chat] Error clearing conversation:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to clear conversation',
      },
      { status: 500 },
    );
  }
}
