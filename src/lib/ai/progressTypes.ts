export const progressUpdateKinds = ['ack', 'deep_search', 'long_task', 'clarification'] as const;

export type ProgressUpdateKind = (typeof progressUpdateKinds)[number];

export type ProgressUpdateChannel = 'whatsapp' | 'twilio' | 'telegram' | 'web';

export type ProgressUpdateEvent = {
  id: string;
  text: string;
  kind: ProgressUpdateKind;
  sequence: number;
  requestId: string;
  channel: ProgressUpdateChannel;
};
