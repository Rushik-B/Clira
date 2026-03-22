import {
  getGoogleThinkingProviderOptions,
  getModel,
  type ModelKey,
} from './models';

export type ModelRole =
  | 'planner'
  | 'stylist'
  | 'router'
  | 'executive'
  | 'calendarSearch'
  | 'emailRetrieval'
  | 'folderGeneration';

const ROLE_MODEL_MAP: Record<ModelRole, ModelKey> = {
  planner: 'flash',
  stylist: 'pro',
  router: 'replyRouter',
  executive: 'execAgent',
  calendarSearch: 'calendarSearch',
  emailRetrieval: 'emailRetrieval',
  folderGeneration: 'folderGeneration',
};

export function getLanguageModel(role: ModelRole) {
  return getModel(ROLE_MODEL_MAP[role]);
}

export function getLanguageModelThinkingOptions(
  role: ModelRole,
  config: {
    thinkingBudget?: number;
    thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high';
  },
) {
  return getGoogleThinkingProviderOptions(ROLE_MODEL_MAP[role], config);
}
