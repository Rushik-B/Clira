import { afterEach, describe, expect, test } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.resolve(process.cwd(), 'docker/postgres-init/01-create-clira-app-user.sh');
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createMockPsqlDir(): Promise<{ binDir: string; argsPath: string; stdinPath: string }> {
  const binDir = await mkdtemp(path.join(tmpdir(), 'clira-psql-mock-'));
  tempDirs.push(binDir);

  const argsPath = path.join(binDir, 'psql-args.log');
  const stdinPath = path.join(binDir, 'psql-stdin.sql');
  const scriptPath = path.join(binDir, 'psql');

  const mockScript = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" > "${argsPath}"
cat > "${stdinPath}"
`;

  await writeFile(scriptPath, mockScript, 'utf-8');
  await execFileAsync('chmod', ['+x', scriptPath]);

  return { binDir, argsPath, stdinPath };
}

describe('docker postgres init script', () => {
  test('passes role parameters via psql variables instead of shell-expanded SQL', async () => {
    const { binDir, argsPath, stdinPath } = await createMockPsqlDir();

    await execFileAsync('sh', [SCRIPT_PATH], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        CLIRA_DB_APP_USER: `O'Malley "admin"`,
        CLIRA_DB_APP_PASSWORD: `pa'ss"word`,
        POSTGRES_DB: `clira"prod`,
        POSTGRES_USER: 'postgres',
      },
    });

    const args = await readFile(argsPath, 'utf-8');
    const sql = await readFile(stdinPath, 'utf-8');

    expect(args).toContain(`--set=app_user=O'Malley "admin"`);
    expect(args).toContain(`--set=app_password=pa'ss"word`);
    expect(args).toContain(`--set=db_name=clira"prod`);

    expect(sql).toContain('DO $$');
    expect(sql).toContain('$$;');
    expect(sql).not.toContain(String.raw`\$\$`);
    expect(sql).toContain(`rolname = :'app_user'`);
    expect(sql).toContain(`format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password')`);
    expect(sql).toContain('GRANT CONNECT ON DATABASE :"db_name" TO :"app_user";');
    expect(sql).not.toContain(`O'Malley "admin"`);
    expect(sql).not.toContain(`pa'ss"word`);
    expect(sql).not.toContain(`clira"prod`);
  });
});
