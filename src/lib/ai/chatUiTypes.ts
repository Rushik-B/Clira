import type { UIMessage } from 'ai';
import type { ProgressUpdateEvent } from '@/lib/ai/progressTypes';

export type AIChatUIMessage = UIMessage<Record<string, unknown>, { progress: ProgressUpdateEvent }>;
