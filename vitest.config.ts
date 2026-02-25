import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: '@/', replacement: path.join(repoRoot, 'src') + '/' }],
  },
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'tests/integration/**'],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/app/**',
        'src/components/**',
        'src/styles/**',
        'src/prompts/**',
      ],
    },
  },
});
