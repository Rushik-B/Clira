import type { UIMessage } from '@ai-sdk/react';
import type { AIChatUIMessage } from '@/lib/ai/chatUiTypes';

export type AIChatRole = 'USER' | 'ASSISTANT' | 'SYSTEM';

export type AIChatMessage = {
  id: string;
  content: string;
  role: AIChatRole;
  createdAt: string;
};

// File attachment type for UI (non-functional upload, planned for later)
export type FileAttachment = {
  id: string;
  name: string;
  size: number;
  type: string;
  file: File;
};

// Convert database message format to AI SDK UIMessage format
export function toUIMessage(msg: AIChatMessage): AIChatUIMessage {
  return {
    id: msg.id,
    role: msg.role === 'USER' ? 'user' : msg.role === 'SYSTEM' ? 'system' : 'assistant',
    parts: [{ type: 'text', text: msg.content }],
  };
}

// Convert AI SDK UIMessage to our format (for display consistency)
export function fromUIMessage(msg: UIMessage): AIChatMessage {
  const textPart = msg.parts.find((p) => p.type === 'text');
  const content = textPart && 'text' in textPart ? textPart.text : '';

  return {
    id: msg.id,
    content,
    role: msg.role === 'user' ? 'USER' : msg.role === 'system' ? 'SYSTEM' : 'ASSISTANT',
    createdAt: new Date().toISOString(),
  };
}

// Extract text content from UIMessage parts
export function getMessageText(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
}
