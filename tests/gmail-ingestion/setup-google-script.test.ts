import { afterEach, describe, expect, test } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.resolve(process.cwd(), 'scripts/setup-google.sh');
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createMockGcloudDir(): Promise<{ binDir: string; logPath: string }> {
  const binDir = await mkdtemp(path.join(tmpdir(), 'clira-gcloud-mock-'));
  tempDirs.push(binDir);
  const logPath = path.join(binDir, 'gcloud.log');
  const scriptPath = path.join(binDir, 'gcloud');

  const mockScript = `#!/usr/bin/env bash
set -euo pipefail
echo "$@" >> "${logPath}"
if [[ "$1" == "projects" && "$2" == "describe" ]]; then
  echo "123456789"
fi
exit 0
`;

  await writeFile(scriptPath, mockScript, 'utf-8');
  await execFileAsync('chmod', ['+x', scriptPath]);
  return { binDir, logPath };
}

async function runSetupGoogle(args: string[], pathPrefix: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('bash', [SCRIPT_PATH, ...args], {
    env: {
      ...process.env,
      PATH: `${pathPrefix}:${process.env.PATH}`,
    },
  });
}

describe('scripts/setup-google.sh', () => {
  test('--mode pull works without --domain and prints pull env block', async () => {
    const { binDir, logPath } = await createMockGcloudDir();

    const { stdout } = await runSetupGoogle(
      [
        '--project-id',
        'test-project',
        '--mode',
        'pull',
        '--subscription',
        'my-pull-sub',
        '--key-out',
        './tmp-key.json',
      ],
      binDir,
    );

    expect(stdout).toContain('GMAIL_INGESTION_MODE=pull');
    expect(stdout).toContain(
      'GMAIL_PUBSUB_PULL_SUBSCRIPTION=projects/test-project/subscriptions/my-pull-sub',
    );
    expect(stdout).toContain('Pull mode configured:');

    const gcloudCalls = await readFile(logPath, 'utf-8');
    expect(gcloudCalls).toContain('pubsub subscriptions create my-pull-sub');
    expect(gcloudCalls).toContain('pubsub topics create my-pull-sub-dlq');
  });

  test('--mode push requires --domain', async () => {
    const { binDir } = await createMockGcloudDir();

    await expect(
      runSetupGoogle(
        ['--project-id', 'test-project', '--mode', 'push', '--subscription', 'my-push-sub'],
        binDir,
      ),
    ).rejects.toSatisfy((error: { stdout?: string; stderr?: string }) => {
      const combined = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
      return combined.includes('--domain is required when --mode push');
    });
  });

  test('--mode push prints push env block and webhook endpoint', async () => {
    const { binDir, logPath } = await createMockGcloudDir();

    const { stdout } = await runSetupGoogle(
      [
        '--project-id',
        'test-project',
        '--mode',
        'push',
        '--domain',
        'example.com',
        '--subscription',
        'my-push-sub',
      ],
      binDir,
    );

    expect(stdout).toContain('GMAIL_INGESTION_MODE=push');
    expect(stdout).toContain(
      'GMAIL_PUBSUB_PULL_SUBSCRIPTION=projects/test-project/subscriptions/my-push-sub',
    );
    expect(stdout).toContain('https://example.com/api/gmail-push/webhook');

    const gcloudCalls = await readFile(logPath, 'utf-8');
    expect(gcloudCalls).toContain('pubsub subscriptions create my-push-sub');
    expect(gcloudCalls).toContain('--push-endpoint https://example.com/api/gmail-push/webhook');
  });
});
