/**
 * Time-of-day copy for the queue dashboard.
 * Same hour bands as PageHeader (morning/afternoon/evening) plus night for variety.
 * vanity thing
 */

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

export function getTimeOfDay(): TimeOfDay {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

const SUBTITLES: Record<TimeOfDay, string> = {
  morning:
    'Let Clira handle the chaos — you just give the final word.',
  afternoon:
    'Steady sail. You\'re in command.',
  evening:
    'Wind down. Clira held the fort.',
  night:
    'Rest easy. You\'re all set till tomorrow.',
};




const EMPTY_QUEUE_TEXTS: Record<TimeOfDay, string> = {
  morning: 'Your queue is empty. Enjoy the calm...',
  afternoon: 'Your queue is empty. Clear mind, clear inbox.',
  evening: 'Your queue is empty. You\'ve earned the quiet.',
  night: 'Your queue is empty. Rest well.',
};

export function getQueueSubtitle(): string {
  return SUBTITLES[getTimeOfDay()];
}

export function getQueueEmptyText(): string {
  return EMPTY_QUEUE_TEXTS[getTimeOfDay()];
}


