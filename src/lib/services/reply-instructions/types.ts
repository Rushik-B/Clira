import { z } from 'zod';

export const replyInstructionTargetSchema = z.enum(['planner', 'style']);
export type ReplyInstructionTarget = z.infer<typeof replyInstructionTargetSchema>;

export const replyInstructionScopeSchema = z.enum(['global', 'sender']);
export type ReplyInstructionScope = z.infer<typeof replyInstructionScopeSchema>;

export const replyInstructionRuleKeySchema = z.enum([
  'tone',
  'formality',
  'brevity',
  'ending',
  'signoff',
  'greeting',
  'voice',
  'punctuation',
  'style_constraint',
  'general_style',
  'calendar_disclosure',
  'cc_policy',
  'clarification_policy',
  'commitment_policy',
  'scheduling_policy',
  'content_focus',
  'content_avoidance',
  'ask_vs_assume',
  'planner_constraint',
  'general_planner',
]);
export type ReplyInstructionRuleKey = z.infer<typeof replyInstructionRuleKeySchema>;

export const replyInstructionRuleSchema = z.object({
  key: replyInstructionRuleKeySchema,
  title: z.string().min(1).max(120),
  instruction: z.string().min(1).max(280),
  rationale: z.string().min(1).max(240).optional(),
  sourceInstruction: z.string().min(1).max(500),
  updatedAt: z.string().min(1),
});
export type ReplyInstructionRule = z.infer<typeof replyInstructionRuleSchema>;

export const replyInstructionDocMetadataSchema = z.object({
  version: z.literal(1),
  summary: z.string().min(1).max(400),
  senderDisplayName: z.string().min(1).max(200).optional(),
  relationLabel: z.string().min(1).max(120).optional(),
  resolvedFrom: z.string().min(1).max(200).optional(),
  rules: z.array(replyInstructionRuleSchema),
});
export type ReplyInstructionDocMetadata = z.infer<typeof replyInstructionDocMetadataSchema>;

export type ReplyInstructionDocRecord = {
  id: string;
  userId: string;
  target: ReplyInstructionTarget;
  scope: ReplyInstructionScope;
  scopeKey: string | null;
  content: string;
  version: number;
  isActive: boolean;
  metadata: ReplyInstructionDocMetadata;
  createdAt: Date;
  updatedAt: Date;
};

export type SaveReplyInstructionDocInput = {
  userId: string;
  target: ReplyInstructionTarget;
  scope: ReplyInstructionScope;
  scopeKey?: string | null;
  content: string;
  metadata: ReplyInstructionDocMetadata;
};
