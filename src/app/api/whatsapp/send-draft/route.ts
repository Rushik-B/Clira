/**
 * Send Draft API Endpoint
 *
 * DEPRECATED: This endpoint is no longer used since currentDraft was removed.
 * Drafts are now managed entirely through conversation history.
 * Users should send "send" or "save" commands via the chat endpoint instead.
 *
 * This file is kept for backwards compatibility but returns an error.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    {
      success: false,
      error: 'This endpoint is deprecated. Please use the chat endpoint with "send" or "save" commands instead.',
    },
    { status: 410 }, // 410 Gone
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    {
      success: false,
      error: 'This endpoint is deprecated. Drafts are now managed through conversation history.',
    },
    { status: 410 }, // 410 Gone
  );
}
