import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth/auth';
import { getConversationManager } from '@/lib/services/whatsapp';
import {
  WebChatTestInterface,
  type WebChatMessage,
  type WebChatDraft,
} from '@/components/chat/WebChatTestInterface';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function WhatsAppChatTestPage() {
  if (process.env.NODE_ENV !== 'development') {
    redirect('/');
  }

  const session = await getServerSession(authOptions);

  if (!session?.userId) {
    redirect('/signin');
  }

  let initialMessages: WebChatMessage[] = [];
  let initialConversationId: string | null = null;

  try {
    const conversationManager = getConversationManager();
    const conversation = await conversationManager.getOrCreateConversation(session.userId, 'web-test');
    initialConversationId = conversation.id;
    const messages = await conversationManager.getRecentMessages(conversation.id, 50);

    initialMessages = messages.map((message) => ({
      id: message.id,
      content: message.content,
      role: message.role,
      createdAt: message.createdAt.toISOString(),
    }));
  } catch {
    // DB unreachable or Prisma client stale: show empty chat
  }

  return (
    <WebChatTestInterface
      initialMessages={initialMessages}
      initialDraft={null}
      initialConversationId={initialConversationId}
    />
  );
}
