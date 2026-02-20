import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { getConversationManager } from '@/lib/services/whatsapp';
import { AIChatShell } from './AIChatShell';
import type { AIChatMessage } from './types';

export const AIChatBootstrap = async () => {
  const session = await getServerSession(authOptions);

  if (!session?.userId) {
    return null;
  }

  let initialMessages: AIChatMessage[] = [];

  try {
    const conversationManager = getConversationManager();
    const conversation = await conversationManager.getOrCreateConversation(session.userId, 'web-test');
    const messages = await conversationManager.getRecentMessages(conversation.id, 50);

    initialMessages = messages.map((message) => ({
      id: message.id,
      content: message.content,
      role: message.role,
      createdAt: message.createdAt.toISOString(),
    }));
  } catch {
    // DB unreachable, migrations not applied, or Prisma client stale: show empty chat
  }

  return (
    <AIChatShell
      initialMessages={initialMessages}
    />
  );
};
