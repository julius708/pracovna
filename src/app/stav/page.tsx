import { redirect } from 'next/navigation';
import { loadStatus } from '@/app/_lib/admin';
import { getViewer } from '@/app/_lib/viewer';
import { AdminShell } from '@/ui/AdminShell';
import { StatusPanel } from '@/ui/StatusPanel';

export const dynamic = 'force-dynamic';

export default async function StatusPage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  if (viewer.role !== 'admin') redirect('/');
  const view = await loadStatus();
  return (
    <AdminShell viewer={viewer}>
      <StatusPanel view={view} />
    </AdminShell>
  );
}
