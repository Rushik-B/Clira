import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth/auth';
import { queueEvents, type QueueEvent } from '@/lib/events/queueEvents';

export const dynamic = 'force-dynamic';

// SSE formatter
function sseFormat(event: string | undefined, data: unknown) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return `${event ? `event: ${event}\n` : ''}data: ${payload}\n\n`;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.userId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const labelFilter = searchParams.get('labelId') || undefined;

  let cleanup: (() => void) | undefined;

  // Create a ReadableStream for SSE
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Hint client retry interval and send a ready message
      controller.enqueue(new TextEncoder().encode(`retry: 8000\n\n`));
      controller.enqueue(new TextEncoder().encode(sseFormat('ready', { ok: true })));

      // Periodic heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(sseFormat('ping', { t: Date.now() })));
        } catch {
          clearInterval(heartbeat);
        }
      }, 25000);

      const onEvent = (evt: QueueEvent) => {
        // Filter by user
        if ('userId' in evt && evt.userId !== session.userId) return;
        // Filter by label if provided
        if (labelFilter) {
          const evtLabel = 'labelId' in evt ? evt.labelId : undefined;
          if (!evtLabel || evtLabel !== labelFilter) return;
        }

        const name = evt.type;
        try {
          controller.enqueue(new TextEncoder().encode(sseFormat(name, evt)));
        } catch {
          // Stream likely closed; detach listener to avoid bubbling errors into emitter
          queueEvents.off('queue-event', onEvent);
        }
      };

      // Attach listener
      queueEvents.on('queue-event', onEvent);

      // Cleanup on close
      const close = () => {
        clearInterval(heartbeat);
        queueEvents.off('queue-event', onEvent);
        try { controller.close(); } catch {}
      };
      cleanup = close;

      // When the client disconnects
      // The ReadableStreamDefaultController in web streams may expose a signal in some runtimes
      // Safely attempt to subscribe if present
      (controller as unknown as { signal?: AbortSignal }).signal?.addEventListener?.('abort', close);
      try {
        // Prefer listening to request abort to ensure cleanup when client disconnects
        (request as unknown as { signal?: AbortSignal }).signal?.addEventListener?.('abort', close);
      } catch {}

      // Fallback: attempt to detect close after errors
      // No-op here; Next runtime will GC the stream when the request ends
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
