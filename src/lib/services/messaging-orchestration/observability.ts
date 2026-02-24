import { logger } from '@/lib/logger';
import type {
  RelevanceDecision,
  RunContext,
} from './types';

type OrchestratorEventName =
  | 'orchestrator.burst.started'
  | 'orchestrator.run.superseded'
  | 'orchestrator.classifier.decision'
  | 'orchestrator.queue.overflow_summary'
  | 'orchestrator.steer.enqueued'
  | 'orchestrator.steer.applied'
  | 'orchestrator.steer.blocked_commit_boundary'
  | 'orchestrator.run.phase.changed'
  | 'orchestrator.final.sent';

type EventPayload = Record<string, unknown>;

export function emitOrchestratorEvent(
  event: OrchestratorEventName,
  payload: EventPayload,
): void {
  logger.info('[messagingOrchestration] event', {
    event,
    counter: 1,
    ...payload,
  });
}

export function buildOrchestrationMessageMetadata(
  runContext: Pick<RunContext, 'burstId' | 'runId' | 'classifierDecision' | 'droppedSummary'>,
  baseMetadata?: Record<string, unknown> | null,
): Record<string, unknown> {
  const metadata = baseMetadata ? { ...baseMetadata } : {};
  metadata.burstId = runContext.burstId;
  metadata.runId = runContext.runId;
  metadata.superseded = false;
  metadata.classifierDecision = runContext.classifierDecision;
  metadata.queueOverflowSummary =
    runContext.droppedSummary.length > 0
      ? {
          droppedCount: runContext.droppedSummary.length,
          droppedMessages: runContext.droppedSummary,
        }
      : null;
  return metadata;
}

export function buildRunContextPromptFragment(params: {
  classifierDecision: RelevanceDecision | null | undefined;
  droppedSummary: string[] | null | undefined;
}): string {
  const droppedSummary = (params.droppedSummary ?? [])
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const classifierDecision = params.classifierDecision ?? null;

  const lines = [
    '## Burst Runtime Context',
    `Latest classifier decision: ${classifierDecision ?? 'none'}`,
  ];

  if (droppedSummary.length === 0) {
    lines.push('Queue overflow: none');
    return lines.join('\n');
  }

  lines.push(`Queue overflow: dropped ${droppedSummary.length} earlier messages in this burst.`);
  lines.push('Dropped summary:');
  for (const entry of droppedSummary) {
    lines.push(`- ${entry}`);
  }
  return lines.join('\n');
}
