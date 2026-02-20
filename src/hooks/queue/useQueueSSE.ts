"use client";

import { useEffect, useRef } from 'react';
type StartEvent = {
  type: 'start';
  userId: string;
  emailId: string;
  messageId: string;
  subject: string;
  from: string;
  snippet?: string;
  receivedAt?: string;
  labelId?: string;
  labelName?: string;
  labelColor?: string;
  gmailLabelId?: string;
};

type ReadyEvent = {
  type: 'ready';
  userId: string;
  emailId: string;
  messageId: string;
  labelId?: string;
};

type FailEvent = {
  type: 'fail';
  userId: string;
  emailId: string;
  messageId: string;
  reason?: string;
  labelId?: string;
};

export function useQueueSSE(opts: {
  labelId?: string;
  onStart: (evt: StartEvent) => void;
  onReady: (evt: ReadyEvent) => void;
  onFail: (evt: FailEvent) => void;
  enabled?: boolean;
}) {
  const { labelId, onStart, onReady, onFail, enabled = true } = opts;
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const url = labelId ? `/api/queue/stream?labelId=${encodeURIComponent(labelId)}` : '/api/queue/stream';
    const es = new EventSource(url);
    esRef.current = es;

    const parse = (data: string) => {
      try { return JSON.parse(data); } catch { return null; }
    };

    const onStartMsg = (e: MessageEvent) => {
      const payload = parse(e.data) as StartEvent | null;
      if (payload && payload.type === 'start') onStart(payload);
    };
    const onReadyMsg = (e: MessageEvent) => {
      const payload = parse(e.data) as ReadyEvent | null;
      if (payload && payload.type === 'ready') onReady(payload);
    };
    const onFailMsg = (e: MessageEvent) => {
      const payload = parse(e.data) as FailEvent | null;
      if (payload && payload.type === 'fail') onFail(payload);
    };

    es.addEventListener('start', onStartMsg);
    es.addEventListener('ready', onReadyMsg);
    es.addEventListener('fail', onFailMsg);

    // Keep-alive and debug
    es.addEventListener('ready', () => {});
    es.addEventListener('ping', () => {});

    es.onerror = () => {
      // Let browser retry with default backoff
    };

    return () => {
      es.removeEventListener('start', onStartMsg);
      es.removeEventListener('ready', onReadyMsg);
      es.removeEventListener('fail', onFailMsg);
      es.close();
      esRef.current = null;
    };
  }, [labelId, onStart, onReady, onFail, enabled]);
}
