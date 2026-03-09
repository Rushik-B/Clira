import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const allowedDirectUsage = new Set([
  path.join(repoRoot, 'src/lib/ai/callLlm.ts'),
]);

async function walk(dir: string, output: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, output);
      continue;
    }
    if (entry.isFile() && fullPath.endsWith('.ts')) {
      output.push(fullPath);
    }
  }
  return output;
}

describe('direct AI SDK usage guard', () => {
  it('keeps generateText/generateObject imports inside callLlm.ts', async () => {
    const files = await walk(path.join(repoRoot, 'src'));
    const offenders: string[] = [];

    await Promise.all(
      files.map(async (filePath) => {
        if (allowedDirectUsage.has(filePath)) return;
        const content = await fs.readFile(filePath, 'utf8');
        if (/from ['"]ai['"]/.test(content) && /\bgenerate(Text|Object)\b/.test(content)) {
          offenders.push(path.relative(repoRoot, filePath));
        }
      }),
    );

    expect(offenders).toEqual([]);
  });
});
