'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/sidebar/button';
import { cn } from '@/lib/utils';

export type WebChatMessage = {
  id: string;
  content: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  createdAt: string;
};

export type WebChatDraft = {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
};

interface WebChatTestInterfaceProps {
  initialMessages: WebChatMessage[];
  initialDraft: WebChatDraft | null;
  initialConversationId: string | null;
}

type DraftAction = 'send' | 'save';

type StatusState =
  | { type: 'success'; message: string }
  | { type: 'error'; message: string }
  | null;

export const WebChatTestInterface: React.FC<WebChatTestInterfaceProps> = ({
  initialMessages,
  initialDraft,
  initialConversationId,
}) => {
  const [messages, setMessages] = useState<WebChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState<WebChatDraft | null>(initialDraft);
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isDraftAction, setIsDraftAction] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [status, setStatus] = useState<StatusState>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const canSendMessage = input.trim().length > 0 && !isSending;
  const hasDraft = !!draft;
  const canRunDraftAction = hasDraft && !!conversationId && !isDraftAction;

  const formattedDraft = useMemo(() => {
    if (!draft) return null;

    return {
      to: draft.to.join(', ') || '—',
      cc: draft.cc.length > 0 ? draft.cc.join(', ') : '—',
      subject: draft.subject || '—',
      body: draft.body || '—',
    };
  }, [draft]);

  const appendSystemMessage = (content: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `system-${Date.now()}`,
        content,
        role: 'SYSTEM',
        createdAt: new Date().toISOString(),
      },
    ]);
  };

  const handleSendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || isSending) return;

    setIsSending(true);
    setStatus(null);
    setInput('');

    const optimisticMessage: WebChatMessage = {
      id: `user-${Date.now()}`,
      content: trimmed,
      role: 'USER',
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimisticMessage]);

    try {
      const response = await fetch('/api/whatsapp/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        const message = data?.error || 'Failed to send message.';
        setStatus({ type: 'error', message });
        appendSystemMessage(message);
        return;
      }

      if (data.response) {
        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            content: data.response,
            role: 'ASSISTANT',
            createdAt: new Date().toISOString(),
          },
        ]);
      }

      if (Object.prototype.hasOwnProperty.call(data, 'draft')) {
        setDraft(data.draft ?? null);
      }

      if (typeof data.conversationId === 'string') {
        setConversationId(data.conversationId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send message.';
      setStatus({ type: 'error', message });
      appendSystemMessage(message);
    } finally {
      setIsSending(false);
    }
  };

  const handleDraftAction = async (action: DraftAction) => {
    if (!conversationId || !draft || isDraftAction) return;

    setIsDraftAction(true);
    setStatus(null);

    try {
      const response = await fetch('/api/whatsapp/send-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, action }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        const message = data?.error || `Failed to ${action} draft.`;
        setStatus({ type: 'error', message });
        appendSystemMessage(message);
        return;
      }

      const successMessage =
        typeof data.message === 'string'
          ? data.message
          : action === 'send'
            ? 'Email sent successfully.'
            : 'Draft saved to Gmail.';

      setStatus({ type: 'success', message: successMessage });
      appendSystemMessage(successMessage);
      setDraft(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to ${action} draft.`;
      setStatus({ type: 'error', message });
      appendSystemMessage(message);
    } finally {
      setIsDraftAction(false);
    }
  };

  const handleClearConversation = async () => {
    if (isClearing) return;
    setIsClearing(true);
    setStatus(null);

    try {
      const response = await fetch('/api/whatsapp/chat', { method: 'DELETE' });
      const data = await response.json();

      if (!response.ok || !data.success) {
        const message = data?.error || 'Failed to clear conversation.';
        setStatus({ type: 'error', message });
        appendSystemMessage(message);
        return;
      }

      setMessages([]);
      setDraft(null);
      setStatus({ type: 'success', message: 'Conversation cleared.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to clear conversation.';
      setStatus({ type: 'error', message });
      appendSystemMessage(message);
    } finally {
      setIsClearing(false);
    }
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSendMessage();
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10">
        <header className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-emerald-300/70">
            WhatsApp Executive Agent
          </p>
          <h1 className="text-3xl font-semibold text-slate-50">Web Chat Test Console</h1>
          <p className="text-sm text-slate-400">
            Send messages to Clira and inspect drafts before they hit Gmail. This view mirrors the WhatsApp
            flow without Meta webhooks.
          </p>
        </header>

        {status && (
          <div
            className={cn(
              'rounded-xl border px-4 py-3 text-sm',
              status.type === 'success'
                ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
                : 'border-rose-400/40 bg-rose-500/10 text-rose-200',
            )}
          >
            {status.message}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="flex min-h-[560px] flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/70">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-200">Conversation</h2>
                <p className="text-xs text-slate-500">User + assistant exchange</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleClearConversation}
                disabled={isClearing || messages.length === 0}
              >
                {isClearing ? 'Clearing…' : 'Clear'}
              </Button>
            </div>

            <div
              ref={scrollRef}
              className="flex-1 space-y-4 overflow-y-auto px-5 py-4"
            >
              {messages.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/30 px-4 py-6 text-center text-sm text-slate-500">
                  No messages yet. Send a prompt to start the conversation.
                </div>
              ) : (
                messages.map((message) => {
                  const isUser = message.role === 'USER';
                  const isSystem = message.role === 'SYSTEM';

                  return (
                    <div
                      key={message.id}
                      className={cn(
                        'flex',
                        isSystem ? 'justify-center' : isUser ? 'justify-end' : 'justify-start',
                      )}
                    >
                      <div
                        className={cn(
                          'max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm',
                          isSystem
                            ? 'border border-amber-500/30 bg-amber-500/10 text-amber-100'
                            : isUser
                              ? 'bg-emerald-500 text-emerald-950'
                              : 'bg-slate-900 text-slate-100',
                        )}
                      >
                        <p className="whitespace-pre-wrap">{message.content}</p>
                        <p
                          className={cn(
                            'mt-2 text-[11px] uppercase tracking-[0.2em]',
                            isSystem
                              ? 'text-amber-200/70'
                              : isUser
                                ? 'text-emerald-900/70'
                                : 'text-slate-400',
                          )}
                        >
                          {message.role}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="border-t border-slate-800 px-5 py-4">
              <div className="flex flex-col gap-3">
                <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2">
                  <textarea
                    className="min-h-[84px] w-full resize-none bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
                    placeholder="Ask Clira to draft, refine, or summarize…"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={handleInputKeyDown}
                    disabled={isSending}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                  <span>Press Enter to send · Shift + Enter for a new line</span>
                  <Button type="button" onClick={handleSendMessage} disabled={!canSendMessage}>
                    {isSending ? 'Sending…' : 'Send'}
                  </Button>
                </div>
              </div>
            </div>
          </section>

          <aside className="flex flex-col gap-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-200">Current Draft</h3>
                  <p className="text-xs text-slate-500">Latest draft captured by the agent</p>
                </div>
                <span
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-medium',
                    hasDraft
                      ? 'bg-emerald-500/15 text-emerald-200'
                      : 'bg-slate-800 text-slate-400',
                  )}
                >
                  {hasDraft ? 'Ready' : 'Empty'}
                </span>
              </div>

              {formattedDraft ? (
                <div className="space-y-3 text-sm text-slate-200">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">To</p>
                    <p className="mt-1 text-slate-200">{formattedDraft.to}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">CC</p>
                    <p className="mt-1 text-slate-200">{formattedDraft.cc}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Subject</p>
                    <p className="mt-1 text-slate-200">{formattedDraft.subject}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Body</p>
                    <p className="mt-1 whitespace-pre-wrap text-slate-200">{formattedDraft.body}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500">
                  No draft yet. Ask Clira to draft an email to populate this panel.
                </p>
              )}

              <div className="mt-6 flex flex-col gap-2">
                <Button
                  type="button"
                  onClick={() => handleDraftAction('send')}
                  disabled={!canRunDraftAction}
                >
                  {isDraftAction ? 'Working…' : 'Send Email'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleDraftAction('save')}
                  disabled={!canRunDraftAction}
                >
                  Save to Gmail Drafts
                </Button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5 text-xs text-slate-500">
              <p className="font-semibold text-slate-400">Quick commands</p>
              <p className="mt-2">send · save · cancel · clear · help</p>
              <p className="mt-3">
                This panel uses the same processor as WhatsApp, so commands here map to the same logic.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};
