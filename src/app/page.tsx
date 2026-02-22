import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { CliraApp } from '@/components/CliraApp';
import { authOptions } from '@/lib/auth/auth';
import { getTextChannelsSettingsSnapshot } from '@/lib/services/textChannelsSettings';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const session = await getServerSession(authOptions);

  if (!session?.userId) {
    redirect(process.env.NEXT_PUBLIC_LANDING_PAGE_URL || '/signin');
  }

  const initialTextChannelsSettings = await getTextChannelsSettingsSnapshot(
    session.userId,
  );

  return <CliraApp initialTextChannelsSettings={initialTextChannelsSettings} />;
}
