import { describe, expect, test } from 'vitest';
import {
  formatReplyPipelineInstruction,
  type ReplyPipelineSnapshot,
} from '@/lib/ai/agents/executive-agent/replyPipelineContext';

describe('reply pipeline context', () => {
  test('guidance allows reusing an existing draft for send or edit flows', () => {
    const snapshot: ReplyPipelineSnapshot = {
      pendingDrafts: [
        {
          from: 'Ray Hasebroock <ray@linqapp.com>',
          subject: 'Linq Sandbox Access (iMessage API)',
          confidenceScore: 95,
          receivedAt: new Date('2026-03-27T23:35:00.000Z'),
        },
      ],
      processingCount: 0,
    };

    const instruction = formatReplyPipelineInstruction(snapshot);

    expect(instruction).toContain('Reuse the existing draft when the user is asking to send or edit it');
    expect(instruction).not.toContain('Direct the user to review them in the Reply Queue instead.');
  });
});
