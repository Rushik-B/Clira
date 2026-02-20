/**
 * Dev UI override helpers.
 *
 * Keep all dev-only flags and detection logic isolated here so the
 * rest of the app stays clean. These are only honored in non-production
 * builds and can be toggled via NEXT_PUBLIC_* env vars.
 */

// Centralized env access so tree-shaking can drop this in prod builds
const env = {
  nodeEnv: process.env.NODE_ENV,
  forceQueueCard: process.env.NEXT_PUBLIC_DEV_FORCE_QUEUE_CARD_STATE,
  queueSandbox: process.env.NEXT_PUBLIC_DEV_QUEUE_SANDBOX,
  queueIntro: process.env.NEXT_PUBLIC_DEV_QUEUE_INTRO,
  whatsappPromo: process.env.NEXT_PUBLIC_DEV_WHATSAPP_PROMO,
};

/**
 * Returns true when the EmailQueueCard dev harness should be shown
 * instead of the normal queue. This is intended for local UI work.
 *
 * Enable by setting in .env.local:
 *   NEXT_PUBLIC_DEV_FORCE_QUEUE_CARD_STATE=generating
 */
export function isDevQueueHarnessEnabled(): boolean {
  if (env.nodeEnv === 'production') return false;
  return (env.forceQueueCard || '').toLowerCase() === 'generating';
}

/**
 * Utility for tests or conditional logic in components if needed later.
 */
export function getDevForcedQueueCardState(): 'none' | 'generating' {
  if (env.nodeEnv === 'production') return 'none';
  const v = (env.forceQueueCard || '').toLowerCase();
  return v === 'generating' ? 'generating' : 'none';
}

/**
 * Returns true when the full QueuePage sandbox should be shown instead of
 * the normal queue. Enables a complete UI flow using mock data with
 * animations, modals, and toasts – no network calls.
 *
 * Enable by setting in .env.local:
 *   NEXT_PUBLIC_DEV_QUEUE_SANDBOX=full
 */
export function isDevFullQueueSandboxEnabled(): boolean {
  if (env.nodeEnv === 'production') return false;
  const v = (env.queueSandbox || '').toLowerCase();
  return v === 'full' || v === 'true';
}

/**
 * Utility to query sandbox mode if needed elsewhere.
 */
export function getDevQueueSandboxMode(): 'none' | 'full' {
  if (env.nodeEnv === 'production') return 'none';
  return isDevFullQueueSandboxEnabled() ? 'full' : 'none';
}

export function getDevQueueIntroMode(): 'off' | 'preview' | 'force' {
  if (env.nodeEnv === 'production') return 'off';
  const v = (env.queueIntro || '').toLowerCase();
  if (v === 'force') return 'force';
  if (v === 'preview' || v === 'true' || v === '1') return 'preview';
  return 'off';
}

export function isDevQueueIntroEnabled(): boolean {
  return getDevQueueIntroMode() !== 'off';
}

/**
 * WhatsApp promo card dev mode.
 * - 'off': Normal behavior (show once after onboarding, persist dismissal)
 * - 'force': Always show on every reload (for testing UI)
 *
 * Enable by setting in .env.local:
 *   NEXT_PUBLIC_DEV_WHATSAPP_PROMO=force
 */
export function getDevWhatsAppPromoMode(): 'off' | 'force' {
  if (env.nodeEnv === 'production') return 'off';
  const v = (env.whatsappPromo || '').toLowerCase();
  if (v === 'force' || v === 'true' || v === '1') return 'force';
  return 'off';
}

export function isDevWhatsAppPromoForced(): boolean {
  return getDevWhatsAppPromoMode() === 'force';
}

