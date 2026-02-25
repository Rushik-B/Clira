import { afterEach, vi } from 'vitest';

// Suppress noisy info/debug logs in tests (orchestrator run-started lines, etc.).
// Only errors and warnings will print
process.env.LOG_LEVEL = 'error';

// Guard against leaked fake timers across test files.
afterEach(() => {
  if (vi.isFakeTimers()) {
    vi.useRealTimers();
  }
});
