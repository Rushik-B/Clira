import { EmailSimulatorPage } from '@/components/pages/dev/EmailSimulatorPage';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { redirect } from 'next/navigation';

export default async function EmailSimulator() {
  if (process.env.NODE_ENV !== 'development') {
    redirect('/');
  }

  const session = await getServerSession(authOptions);
  if (!session?.userId) {
    redirect('/signin');
  }

  return <EmailSimulatorPage />;
}
