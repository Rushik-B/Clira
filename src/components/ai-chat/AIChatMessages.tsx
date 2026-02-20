'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UIMessage } from '@ai-sdk/react';
import { Copy, RefreshCw, Check, Sparkles } from 'lucide-react';
import { Shimmer } from '@/components/ui/shimmer';
import { MemoizedMarkdown } from '@/components/ui/markdown';
import { cn } from '@/lib/utils';
import { getMessageText } from './types';

type ChatStatus = 'submitted' | 'streaming' | 'ready' | 'error';

interface AIChatMessagesProps {
  messages: UIMessage[];
  isOpen: boolean;
  status: ChatStatus;
  onRegenerate: () => void;
}

// Message action button component
const MessageActionButton: React.FC<{
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  isActive?: boolean;
}> = ({ onClick, icon, label, isActive }) => (
  <button
    onClick={onClick}
    className={cn(
      'flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-all duration-150 cursor-pointer',
      isActive
        ? 'bg-emerald-500/20 text-emerald-300'
        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/80',
    )}
    title={label}
  >
    {icon}
    <span className="hidden sm:inline">{label}</span>
  </button>
);

export const AIChatMessages: React.FC<AIChatMessagesProps> = ({
  messages,
  isOpen,
  status,
  onRegenerate,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const isStreaming = status === 'streaming';
  const isSubmitted = status === 'submitted';

  // Handle copy to clipboard
  const handleCopy = useCallback(async (messageId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(messageId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }, []);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (!isOpen) return;
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isOpen, status]);

  // Find the last assistant message for showing actions
  const lastAssistantMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        return messages[i].id;
      }
    }
    return null;
  }, [messages]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 min-h-0 space-y-4 overflow-y-auto px-5 py-4"
    >
      {messages.length === 0 ? (
        // Enhanced empty state
        <div className="flex flex-col items-center justify-center h-full py-8">
          <div className="rounded-2xl border border-dashed border-white/10 bg-black/30 px-6 py-8 text-center max-w-sm">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
              <Sparkles className="h-5 w-5" />
            </div>
            <h3 className="text-lg text-slate-100 font-semibold mb-2">
              How can I help you?
            </h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Ask Clira to draft emails, search your calendar, summarize threads, or help you stay on top of your inbox.
            </p>
          </div>
        </div>
      ) : (
        <>
          {messages.map((message, index) => {
            const isUser = message.role === 'user';
            const isSystem = message.role === 'system';
            const isAssistant = message.role === 'assistant';
            const messageText = getMessageText(message);
            const isLastAssistant = message.id === lastAssistantMessageId;
            const isCurrentlyStreaming = isStreaming && isLastAssistant;

            return (
              <div key={message.id} className="group">
                <div
                  className={cn(
                    'flex',
                    isSystem ? 'justify-center' : isUser ? 'justify-end' : 'justify-start',
                  )}
                >
                  <div
                    className={cn(
                      'max-w-[82%] rounded-2xl px-4 py-3 leading-relaxed shadow-sm',
                      isSystem
                        ? 'border border-amber-500/30 bg-amber-500/10 text-amber-100 text-sm font-medium'
                        : isUser
                          ? 'bg-emerald-500 text-emerald-950 text-base font-medium'
                          : 'bg-slate-900 text-slate-100 text-base',
                    )}
                  >
                    {isCurrentlyStreaming && !messageText ? (
                      <p className="whitespace-pre-wrap">
                        <Shimmer as="span" className="text-base font-medium" duration={2.8} spread={2.8}>
                          Thinking...
                        </Shimmer>
                      </p>
                    ) : isAssistant ? (
                      <div className="relative">
                        <MemoizedMarkdown content={messageText} id={message.id} />
                        {isCurrentlyStreaming && (
                          <span className="inline-block w-1.5 h-4 ml-0.5 bg-emerald-400 animate-pulse rounded-sm align-middle" />
                        )}
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap">{messageText}</p>
                    )}
                  </div>
                </div>

                {/* Message actions for assistant messages */}
                {isAssistant && messageText && !isCurrentlyStreaming && (
                  <div
                    className={cn(
                      'flex items-center gap-1 mt-2 transition-opacity duration-150',
                      isLastAssistant
                        ? 'opacity-100'
                        : 'opacity-0 group-hover:opacity-100',
                    )}
                  >
                    <MessageActionButton
                      onClick={() => handleCopy(message.id, messageText)}
                      icon={
                        copiedId === message.id ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )
                      }
                      label={copiedId === message.id ? 'Copied!' : 'Copy'}
                      isActive={copiedId === message.id}
                    />
                    {isLastAssistant && (
                      <MessageActionButton
                        onClick={onRegenerate}
                        icon={<RefreshCw className="h-3.5 w-3.5" />}
                        label="Regenerate"
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Show thinking indicator when submitted but no streaming yet */}
          {isSubmitted && (
            <div className="flex justify-start">
              <div className="max-w-[82%] rounded-2xl px-4 py-3 leading-relaxed shadow-sm bg-slate-900 text-slate-100 text-base">
                <Shimmer as="span" className="text-base font-medium" duration={2.8} spread={2.8}>
                  Thinking...
                </Shimmer>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
