/**
 * Web Chat API Endpoint
 *
 * Provides streaming POST endpoint for the AI chat interface using AI SDK.
 * Uses the Executive Agent for processing, then streams the response back.
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
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from 'ai';
import { authOptions } from '@/lib/auth/auth';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { processWebChatMessage } from '@/lib/services/whatsapp/messageProcessor';
import { getConversationManager } from '@/lib/services/whatsapp';
import type { AIChatUIMessage } from '@/lib/ai/chatUiTypes';

// Allow streaming responses up to 60 seconds (Executive Agent may take time)
export const maxDuration = 60;

// ─────────────────────────────────────────────────────────────────────────────
// POST: Send a message (streaming response)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handles chat messages from the web interface with streaming response.
 *
 * Request body (AI SDK format):
 * {
 *   messages: UIMessage[]  // Full conversation history from useChat
 * }
 *
 * Response: Streaming UI message stream (AI SDK format)
 */
export async function POST(request: NextRequest): Promise<Response> {
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

    // Parse request body (AI SDK sends messages array)
    const body = await request.json();
    const { messages } = body as { messages: UIMessage[] };

    // Get the last user message
    const lastUserMessage = messages?.filter((m) => m.role === 'user').pop();
    const userMessageText = lastUserMessage?.parts
      ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('') ?? '';

    if (!userMessageText.trim()) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 },
      );
    }

    logger.info(`[Web Chat] Processing message: userId=${userId.slice(0, 8)}...`);

    // Create streaming response using AI SDK's createUIMessageStream
    const stream = createUIMessageStream<AIChatUIMessage>({
      execute: async ({ writer }) => {
        try {
          // Process the message using the Executive Agent
          const requestId = crypto.randomUUID();
          const result = await processWebChatMessage(userId, user.email, userMessageText.trim(), {
            requestId,
            onProgress: (event) => {
              writer.write({
                type: 'data-progress',
                data: event,
                transient: true,
              });
            },
          });

          if (!result.success || !result.response) {
            // Write error as text
            const errorId = `error-${Date.now()}`;
            writer.write({ type: 'text-start', id: errorId });
            writer.write({
              type: 'text-delta',
              id: errorId,
              delta: result.response || 'Something went wrong. Please try again.',
            });
            writer.write({ type: 'text-end', id: errorId });
            return;
          }

          // Stream the response in chunks for a nice streaming effect
          const responseText = result.response.trim();
          const textId = `text-${Date.now()}`;

          writer.write({ type: 'text-start', id: textId });

          // Stream in small chunks for smooth appearance
          const chunkSize = 4;
          for (let i = 0; i < responseText.length; i += chunkSize) {
            const chunk = responseText.slice(i, i + chunkSize);
            writer.write({ type: 'text-delta', id: textId, delta: chunk });
            // Tiny delay for streaming effect
            await new Promise((resolve) => setTimeout(resolve, 8));
          }

          writer.write({ type: 'text-end', id: textId });
        } catch (error) {
          logger.error('[Web Chat] Error in stream execution:', error);
          const errorId = `error-${Date.now()}`;
          writer.write({ type: 'text-start', id: errorId });
          writer.write({
            type: 'text-delta',
            id: errorId,
            delta: 'Something went wrong. Please try again.',
          });
          writer.write({ type: 'text-end', id: errorId });
        }
      },
      onError: (error) => {
        logger.error('[Web Chat] Stream error:', error);
        return error instanceof Error ? error.message : 'Stream error';
      },
    });

    return createUIMessageStreamResponse({ stream });
  } catch (error) {
    logger.error('[Web Chat] Error processing message:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process message',
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
    const conversation = await conversationManager.getConversationByWaId(userId, 'web-test');

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
    logger.error('[Web Chat] Error fetching conversation:', error);

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
    const conversation = await conversationManager.getConversationByWaId(userId, 'web-test');

    if (conversation) {
      await conversationManager.clearConversation(conversation.id);
    }

    return NextResponse.json({
      success: true,
      message: 'Conversation cleared',
    });
  } catch (error) {
    logger.error('[Web Chat] Error clearing conversation:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to clear conversation',
      },
      { status: 500 },
    );
  }
}
