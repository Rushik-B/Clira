import { EventEmitter } from 'events';

// Typed queue events used for real-time UI updates via SSE
export type QueueStartEvent = {
  type: 'start';
  userId: string;
  emailId: string;
  messageId: string;
  subject: string;
  from: string;
  snippet?: string;
  receivedAt?: string;
  // Optional label scoping for label-specific queues
  labelId?: string; // internal label id (our DB)
  labelName?: string;
  labelColor?: string;
  gmailLabelId?: string; // Gmail's label id to help reconcile
};

export type QueueReadyEvent = {
  type: 'ready';
  userId: string;
  emailId: string;
  messageId: string;
  labelId?: string;
};

export type QueueFailEvent = {
  type: 'fail';
  userId: string;
  emailId: string;
  messageId: string;
  reason?: string;
  labelId?: string;
};

export type QueueEvent = QueueStartEvent | QueueReadyEvent | QueueFailEvent | { type: 'ping' };

type QueueGlobal = {
  __queueEvents?: EventEmitter;
};

// Create a singleton EventEmitter across hot reloads / Next.js dev server
const globalWithQueue = globalThis as QueueGlobal;

if (!globalWithQueue.__queueEvents) {
  globalWithQueue.__queueEvents = new EventEmitter();
  // Increase max listeners since multiple pages/tabs can connect
  globalWithQueue.__queueEvents.setMaxListeners(100);
}

export const queueEvents: EventEmitter = globalWithQueue.__queueEvents as EventEmitter;

// Helper to safely emit events
export function emitQueueEvent(evt: QueueEvent) {
  try {
    queueEvents.emit('queue-event', evt);
  } catch (e) {
    // Prevent one broken listener from crashing producers
    console.warn('[queueEvents] emit error:', e);
  }
}
