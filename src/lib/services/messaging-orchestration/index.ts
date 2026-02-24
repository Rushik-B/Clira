export {
  getMessagingOrchestrator,
  MessagingOrchestrator,
} from './orchestrator';

export {
  buildConversationKey,
  OrchestrationStateError,
  readBurstState,
  updateBurstState,
  writeBurstState,
} from './stateStore';

export {
  classifyMessageRelevance,
} from './relevanceClassifier';

export {
  buildOrchestrationMessageMetadata,
  buildRunContextPromptFragment,
  emitOrchestratorEvent,
} from './observability';

export {
  buildConversationKeyFromAdapter,
  ensureAdapterChannel,
  isDuplicateInboundFromAdapter,
} from './channelAdapters';

export type {
  BurstState,
  ChannelAdapter,
  FinalizeResult,
  OrchestrationDecision,
  OrchestrationChannel,
  PrepareRunParams,
  RelevanceClassification,
  RelevanceDecision,
  RunContext,
} from './types';

export {
  EA_DROP_POLICY,
  EA_FOLLOWUP_CONFIDENCE_MAX,
  EA_LONG_TASK_PROGRESS_MS,
  EA_MICRO_BUFFER_MS,
  EA_QUEUE_CAP,
  EA_STATE_TTL_SECONDS,
  EA_STEER_WINDOW_MS,
  EA_SUPERSEDE_CONFIDENCE_MIN,
} from './types';
