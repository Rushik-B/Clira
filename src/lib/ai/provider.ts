import { models } from './models';

export type ModelRole =
  | 'planner'
  | 'stylist'
  | 'router'
  | 'executive'
  | 'calendarSearch'
  | 'emailRetrieval'
  | 'folderGeneration';

/**
 * v1 provider facade.
 * Current implementation returns Gemini-backed models from models.ts.
 */
export function getLanguageModel(role: ModelRole) {
  switch (role) {
    case 'planner':
      return models.flash();
    case 'stylist':
      return models.flash();
    case 'router':
      return models.replyRouter();
    case 'executive':
      return models.execAgent();
    case 'calendarSearch':
      return models.calendarSearch();
    case 'emailRetrieval':
      return models.emailRetrieval();
    case 'folderGeneration':
      return models.folderGeneration();
    default: {
      const _never: never = role;
      return _never;
    }
  }
}
