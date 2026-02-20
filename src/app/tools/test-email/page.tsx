import { TestEmailPage } from '@/components/pages/TestEmailPage';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth/auth';

export default async function Page() {
  if (process.env.NODE_ENV !== 'development') {
    redirect('/');
  }

  const session = await getServerSession(authOptions);
  if (!session?.userId) {
    redirect('/signin');
  }

  return <TestEmailPage />;
}
