import { redirect } from 'next/navigation';
import { loadSettingsView } from '@/app/_lib/admin';
import { getViewer } from '@/app/_lib/viewer';
import { AdminShell } from '@/ui/AdminShell';
import { SettingsForm } from '@/ui/SettingsForm';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  if (viewer.role !== 'admin') redirect('/');
  const view = await loadSettingsView();
  return (
    <AdminShell viewer={viewer}>
      <SettingsForm view={view} meId={viewer.id} />
    </AdminShell>
  );
}
