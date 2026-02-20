import { logger } from '../logger';

// Simple keyed concurrency limiter. Each key has its own queue and max concurrency.

type Task<T> = () => Promise<T>;

class ConcurrencyQueue {
  private running = 0;
  private readonly queue: Array<{
    task: Task<any>;
    resolve: (v: any) => void;
    reject: (e: any) => void;
  }> = [];

  constructor(private readonly maxConcurrency: number) {}

  enqueue<T>(task: Task<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.pump();
    });
  }

  private pump() {
    while (this.running < this.maxConcurrency && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) return;
      this.running++;
      item
        .task()
        .then((v) => item.resolve(v))
        .catch((e) => item.reject(e))
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }
}

const queues = new Map<string, ConcurrencyQueue>();

function getQueue(key: string, maxConcurrency: number) {
  const existing = queues.get(key);
  if (existing) return existing;
  const created = new ConcurrencyQueue(maxConcurrency);
  queues.set(key, created);
  return created;
}

export type ConcurrencyOptions = {
  key?: string; // route or operation key, e.g. 'reply', 'scanner'
  maxConcurrency?: number; // per-key limit; default from env
};

export async function withConcurrency<T>(
  task: Task<T>,
  { key = 'default', maxConcurrency = defaultLimitForKey(key) }: ConcurrencyOptions = {},
): Promise<T> {
  const queue = getQueue(key, maxConcurrency);
  logger.debug(`[concurrency] enqueue key=${key}`);
  return queue.enqueue(task);
}

function defaultLimitForKey(key: string): number {
  const env = process.env.AI_CONCURRENCY?.trim();
  if (env && !Number.isNaN(Number(env))) return Math.max(1, Number(env));
  // Apply a slightly higher limit for flash-tier operations
  if (/scanner|final|folders|mapping|flash/i.test(key)) return 4;
  return 2;
}


