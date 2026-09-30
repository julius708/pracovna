import { redirect } from 'next/navigation';
import { devLoginAllowed, getViewer } from '@/app/_lib/viewer';
import { LoginForm } from '@/ui/LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const viewer = await getViewer();
  if (viewer) redirect('/');
  return <LoginForm devAllowed={devLoginAllowed()} />;
}
