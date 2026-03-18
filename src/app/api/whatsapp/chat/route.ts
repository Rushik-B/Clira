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
import { z } from 'zod';
import { authOptions } from '@/lib/auth/auth';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { processWebChatMessage } from '@/lib/services/whatsapp/messageProcessor';
import { getConversationManager } from '@/lib/services/whatsapp';
import type { AIChatUIMessage } from '@/lib/ai/chatUiTypes';

// Allow streaming responses up to 60 seconds (Executive Agent may take time)
export const maxDuration = 60;

const webChatMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['user', 'assistant', 'system']),
  parts: z.array(z.object({ type: z.string() }).passthrough()),
});

const webChatRequestSchema = z.object({
  messages: z.array(webChatMessageSchema).min(1),
});

function extractUserMessageText(message: z.infer<typeof webChatMessageSchema>): string {
  return message.parts
    .filter(
      (part): part is { type: 'text'; text: string } =>
        part.type === 'text' && typeof (part as { text?: unknown }).text === 'string',
    )
    .map((part) => part.text)
    .join('');
}

function extractUserMessageUploads(message: z.infer<typeof webChatMessageSchema>): Array<{
  filename?: string | null;
  mediaType?: string | null;
  url: string;
}> {
  return message.parts.flatMap((part) => {
    const record = part as Record<string, unknown>;
    if (
      part.type !== 'file' ||
      typeof record.url !== 'string'
    ) {
      return [];
    }

    return [
      {
        filename: typeof record.filename === 'string' ? record.filename : null,
        mediaType: typeof record.mediaType === 'string' ? record.mediaType : null,
        url: record.url,
      },
    ];
  });
}

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
    const body = webChatRequestSchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json(
        {
          error: 'Invalid request body',
          details: body.error.flatten(),
        },
        { status: 400 },
      );
    }

    const { messages } = body.data as { messages: UIMessage[] };

    // Get the last user message
    const lastUserMessage = messages?.filter((m) => m.role === 'user').pop();
    const userMessageText = lastUserMessage ? extractUserMessageText(lastUserMessage) : '';
    const uploads = lastUserMessage ? extractUserMessageUploads(lastUserMessage) : [];

    if (!userMessageText.trim() && uploads.length === 0) {
      return NextResponse.json(
        { error: 'Message text or at least one upload is required' },
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
            uploads,
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
