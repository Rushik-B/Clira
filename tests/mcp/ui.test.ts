import { describe, expect, test } from 'vitest';
import {
  buildConnectionSnapshotVersion,
  parseEnvironmentVariables,
  parseTransportHeaders,
  reconcileSyncingConnectionIds,
} from '@/lib/services/mcp/ui';

describe('MCP UI helpers', () => {
  test('parseTransportHeaders returns headers for non-empty unique entries', () => {
    expect(
      parseTransportHeaders([
        { id: '1', name: 'X-Workspace', value: 'production' },
        { id: '2', name: 'X-Region', value: 'ca-west-1' },
      ]),
    ).toEqual({
      headers: {
        'X-Workspace': 'production',
        'X-Region': 'ca-west-1',
      },
    });
  });

  test('parseTransportHeaders rejects duplicate names case-insensitively', () => {
    expect(
      parseTransportHeaders([
        { id: '1', name: 'X-Workspace', value: 'production' },
        { id: '2', name: 'x-workspace', value: 'staging' },
      ]),
    ).toEqual({
      error: 'Transport header "x-workspace" is duplicated.',
    });
  });

  test('parseEnvironmentVariables rejects malformed lines', () => {
    expect(parseEnvironmentVariables('VALID_KEY=value\nBROKEN_LINE')).toEqual({
      error: 'Invalid environment variable "BROKEN_LINE". Use KEY=VALUE.',
    });
  });

  test('reconcileSyncingConnectionIds clears syncs once connection timestamps advance', () => {
    const requestStartedAt = Date.parse('2026-03-15T10:00:00.000Z');

    const remaining = reconcileSyncingConnectionIds(
      new Set(['conn-1', 'conn-2']),
      [
        {
          id: 'conn-1',
          updatedAt: '2026-03-15T10:00:02.000Z',
          lastSyncedAt: '2026-03-15T10:00:02.000Z',
        },
        {
          id: 'conn-2',
          updatedAt: '2026-03-15T09:59:00.000Z',
          lastSyncedAt: null,
        },
      ],
      new Map([
        ['conn-1', requestStartedAt],
        ['conn-2', requestStartedAt],
      ]),
    );

    expect(remaining).toEqual(new Set(['conn-2']));
  });

  test('buildConnectionSnapshotVersion changes when sync-relevant fields change', () => {
    const base = buildConnectionSnapshotVersion({
      id: 'conn-1',
      status: 'synced',
      toolCount: 3,
      lastSyncedAt: '2026-03-15T10:00:00.000Z',
      updatedAt: '2026-03-15T10:00:00.000Z',
      degradedReason: null,
    });

    const next = buildConnectionSnapshotVersion({
      id: 'conn-1',
      status: 'degraded',
      toolCount: 3,
      lastSyncedAt: '2026-03-15T10:00:00.000Z',
      updatedAt: '2026-03-15T10:00:05.000Z',
      degradedReason: 'Connection failed',
    });

    expect(next).not.toBe(base);
  });
});
