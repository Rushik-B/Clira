// Main components
export { FolderManagementCard } from './FolderManagementCard';
export { CreateFolderModal } from './CreateFolderModal';
export { AddRuleModal } from './AddRuleModal';
export { EmailReviewInterface } from './EmailReviewInterface';
export { QuickAdjustModal } from './QuickAdjustModal';

// Types and utilities
export type {
  FolderData,
  EmailExample,
  HardRule,
  EmailPreview,
  EmailCorrection,
  ReorganizationResult,
  PageMode
} from './types';

export {
  isWellDescribed,
  getDescriptionQuality,
  getAccuracyLevel
} from './types';