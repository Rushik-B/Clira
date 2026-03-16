'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type FileUIPart } from 'ai';
import { MODAL_SURFACE_CLASS } from '@/components/ui/queue-page/queueModalStyles';
import { cn } from '@/lib/utils';
import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion';
import type { AIChatUIMessage } from '@/lib/ai/chatUiTypes';
import { AIChatHeader } from './AIChatHeader';
import { AIChatInput } from './AIChatInput';
import { AIChatMessages } from './AIChatMessages';
import type { AIChatMessage, FileAttachment } from './types';
import { toUIMessage } from './types';

interface AIChatPopupProps {
  isOpen: boolean;
  isFullscreen: boolean;
  onClose: () => void;
  onToggleFullscreen: () => void;
  initialMessages: AIChatMessage[];
  onClearRequest?: () => void;
}

export const AIChatPopup: React.FC<AIChatPopupProps> = ({
  isOpen,
  isFullscreen,
  onClose,
  onToggleFullscreen,
  initialMessages,
  onClearRequest,
}) => {
  const [isClearing, setIsClearing] = useState(false);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);

  const initialUIMessages = useMemo<AIChatUIMessage[]>(
    () => initialMessages.map(toUIMessage),
    [initialMessages],
  );

  const suggestions = useMemo(
    () => [
      'Summarize my unread emails and surface anything urgent.',
      'Draft a polite reply to the latest email I received.',
      'List action items from my inbox that need replies today.',
      'Find threads waiting on my response for > 3 days.',
      'Turn my last email into a shorter, clearer version.',
      'Help me write a follow-up that gets a response.',
    ],
    [],
  );

  // Use AI SDK's useChat hook for state management and streaming
  // chatKey changes to force remount when clearing conversation
  const {
    messages,
    sendMessage,
    setMessages,
    status,
  } = useChat<AIChatUIMessage>({
    messages: initialUIMessages,
    transport: new DefaultChatTransport({
      api: '/api/whatsapp/chat',
    }),
    onData: (dataPart) => {
      if (dataPart.type !== 'data-progress') return;
      const progress = dataPart.data;
      setMessages((prev) => {
        if (prev.some((msg) => msg.id === progress.id)) {
          return prev;
        }

        return [
          ...prev,
          {
            id: progress.id,
            role: 'assistant',
            metadata: {
              type: 'progress',
              kind: progress.kind,
              requestId: progress.requestId,
              sequence: progress.sequence,
              channel: progress.channel,
            },
            parts: [{ type: 'text', text: progress.text }],
          },
        ];
      });
    },
  });

  const isSending = status === 'streaming' || status === 'submitted';

  const handleSendMessage = useCallback(async () => {
    if ((input.trim().length === 0 && attachments.length === 0) || isSending) {
      return;
    }

    try {
      const fileParts: FileUIPart[] = await Promise.all(
        attachments.map(async (attachment) => ({
          type: 'file' as const,
          filename: attachment.name,
          mediaType: attachment.type || 'application/octet-stream',
          url: await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              if (typeof reader.result === 'string') {
                resolve(reader.result);
                return;
              }

              reject(new Error('web_chat_attachment_read_failed'));
            };
            reader.onerror = () =>
              reject(reader.error ?? new Error('web_chat_attachment_read_failed'));
            reader.readAsDataURL(attachment.file);
          }),
        })),
      );

      await sendMessage({
        parts: [
          ...(input.trim()
            ? [{ type: 'text' as const, text: input.trim() }]
            : []),
          ...fileParts,
        ],
      });
      setInput('');
      setAttachments([]);
    } catch (error) {
      console.error('Failed to send message with attachments', error);
    }
  }, [attachments, input, isSending, sendMessage]);

  const handleSuggestionClick = useCallback(
    (suggestion: string) => {
      if (isSending) return;
      sendMessage({ text: suggestion });
      setInput('');
    },
    [isSending, sendMessage],
  );

  const handleClearConversation = useCallback(async () => {
    if (isClearing) return;
    setIsClearing(true);

    try {
      const response = await fetch('/api/whatsapp/chat', { method: 'DELETE' });
      const data: { success?: boolean; error?: string } = await response.json();

      if (!response.ok || !data.success) {
        console.error('Failed to clear conversation:', data?.error);
        return;
      }

      // Trigger parent to remount component with new key
      // This clears all messages from useChat state
      onClearRequest?.();
    } catch (error) {
      console.error('Failed to clear conversation:', error);
    } finally {
      setIsClearing(false);
    }
  }, [isClearing, onClearRequest]);

  // Handle regenerate (resend last user message)
  const handleRegenerate = useCallback(() => {
    if (isSending) return;
    // Find the last user message and resend it
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMessage) {
      const textPart = lastUserMessage.parts.find((p) => p.type === 'text');
      if (textPart && 'text' in textPart) {
        sendMessage({ text: textPart.text });
      }
    }
  }, [isSending, messages, sendMessage]);

  const shouldShowSuggestions = !isSending && input.trim().length === 0 && messages.length === 0;

  return (
    <div
      className={cn(
        'fixed inset-0 z-[80] transition-opacity duration-200 ease-out',
        isOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
      )}
      aria-hidden={!isOpen}
    >
      <div
        className={cn(
          'absolute inset-0 bg-black/60 cursor-pointer transition-all duration-200 ease-out',
          // Mobile browsers (esp. iOS Safari) often render foreground text "soft"
          // when large `backdrop-filter` layers are present on the chat surface.
          // Keep the *background* blur (this overlay) on mobile, but disable blur on the chat surface.
          isOpen ? 'backdrop-blur-sm sm:backdrop-blur-md' : 'backdrop-blur-none',
        )}
        onClick={onClose}
        style={{
          transitionProperty: 'opacity, backdrop-filter',
          willChange: 'opacity, backdrop-filter',
        }}
      />
      <div
        className={cn(
          'absolute flex flex-col origin-bottom-right transition-[width,height,right,bottom,left,top,opacity,transform] duration-200 ease-out',
          isOpen ? 'scale-100 opacity-100' : 'scale-[0.98] opacity-0',
          isFullscreen
            ? 'bottom-0 right-0 left-0 top-16 h-[calc(100dvh-4rem)] min-h-[calc(100svh-4rem)] w-full sm:left-auto sm:top-auto sm:h-full sm:min-h-0 sm:top-0'
            : 'left-1/2 top-1/2 h-[90vh] w-[90vw] -translate-x-1/2 -translate-y-1/2 sm:left-auto sm:top-auto sm:translate-x-0 sm:translate-y-0 sm:bottom-4 sm:right-4 sm:h-[600px] sm:w-[600px] sm:max-h-[85vh]',
        )}
        style={{
          willChange: 'transform, opacity, width, height, right, bottom, left, top',
        }}
      >
        <div className="relative flex h-full flex-col">
          <div className={cn(
            // Slightly reduced blur on mobile to avoid a "hazy" look.
            'absolute -inset-6 bg-gradient-to-br from-emerald-500/10 via-transparent to-sky-500/10 blur-xl sm:blur-2xl transition-[border-radius] duration-200 ease-out',
            isFullscreen ? 'rounded-none' : 'rounded-[28px]'
          )} />
          <div
            className={cn(
              'relative flex h-full flex-col overflow-hidden transition-[border-radius] duration-200 ease-out',
              MODAL_SURFACE_CLASS,
              // Override the shared modal surface blur: disable on mobile, keep on sm+.
              'backdrop-blur-none sm:backdrop-blur-2xl',
              isFullscreen && '!rounded-none',
            )}
            role="dialog"
            aria-modal="true"
            aria-label="AI assistant chat"
          >
            <AIChatHeader
              isFullscreen={isFullscreen}
              isClearing={isClearing}
              hasMessages={messages.length > 0}
              onClose={onClose}
              onClear={handleClearConversation}
              onToggleFullscreen={onToggleFullscreen}
            />
            <AIChatMessages
              messages={messages}
              isOpen={isOpen}
              status={status}
              onRegenerate={handleRegenerate}
            />
            {shouldShowSuggestions && (
              <div className="px-5 pb-2">
                <Suggestions aria-label="Suggested prompts">
                  {suggestions.map((suggestion) => (
                    <Suggestion
                      key={suggestion}
                      suggestion={suggestion}
                      onClick={handleSuggestionClick}
                      disabled={isSending}
                    />
                  ))}
                </Suggestions>
              </div>
            )}
            <AIChatInput
              value={input}
              isSending={isSending}
              attachments={attachments}
              onChange={setInput}
              onAttachmentsChange={setAttachments}
              onSend={handleSendMessage}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
