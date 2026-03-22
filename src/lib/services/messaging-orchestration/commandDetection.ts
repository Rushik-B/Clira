export type MessagingCommand = 'send' | 'save' | 'clear' | 'cancel' | 'help' | null;

const COMMAND_VARIANTS: Record<Exclude<MessagingCommand, null>, readonly string[]> = {
  send: ['send', 'send it', 'send now', 'yes send', 'yes, send', 'yes send it', 'send email', 'send the email'],
  save: ['save', 'save it', 'save draft', 'save as draft', 'save to drafts'],
  clear: ['clear', 'reset', 'start over', 'new conversation', 'clear conversation'],
  cancel: ['cancel', 'cancel draft', 'discard', 'discard draft', 'nevermind', 'never mind'],
  help: ['help', '/help', 'commands', 'what can you do', 'what can you do?'],
};

const COMMAND_LOOKUP = new Map<string, Exclude<MessagingCommand, null>>(
  Object.entries(COMMAND_VARIANTS).flatMap(([command, variants]) =>
    variants.map((variant) => [variant, command as Exclude<MessagingCommand, null>]),
  ),
);

export function detectMessagingCommand(text: string): MessagingCommand {
  const normalized = text.toLowerCase().trim();
  return COMMAND_LOOKUP.get(normalized) ?? null;
}
