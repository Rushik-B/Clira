import { describe, expect, test } from 'vitest';
import { detectMessagingCommand } from '@/lib/services/messaging-orchestration';

describe('detectMessagingCommand', () => {
  test('matches known command variants case-insensitively', () => {
    expect(detectMessagingCommand('  SEND THE EMAIL  ')).toBe('send');
    expect(detectMessagingCommand('save as draft')).toBe('save');
    expect(detectMessagingCommand('Start Over')).toBe('clear');
    expect(detectMessagingCommand('never mind')).toBe('cancel');
    expect(detectMessagingCommand('/HELP')).toBe('help');
  });

  test('returns null for non-command text', () => {
    expect(detectMessagingCommand('draft a follow-up to Alex')).toBeNull();
  });
});
