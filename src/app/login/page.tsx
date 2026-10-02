import { redirect } from 'next/navigation';
import { devLoginAllowed, getViewer } from '@/app/_lib/viewer';
import { LoginForm } from '@/ui/LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await getViewer();
  if (viewer) redirect('/');
  const sp = await searchParams;
  return <LoginForm devAllowed={devLoginAllowed()} notice={sp.chyba === 'link' ? 'link' : null} />;
}
