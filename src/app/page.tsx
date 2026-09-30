import { redirect } from 'next/navigation';
import { sk } from '@/core/i18n/sk';
import { Board } from '@/ui/Board';
import { logoutAction } from './_lib/actions';
import { loadBoard } from './_lib/board';
import { getViewer } from './_lib/viewer';

export const dynamic = 'force-dynamic';

export default async function BoardPage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  if (!viewer.active) {
    return (
      <div className="wrap">
        <div className="login-card">
          <strong>{sk.login.deactivated}</strong>
          <form action={logoutAction} style={{ marginTop: 12 }}>
            <button className="btn ghost" type="submit">
              {sk.buttons.logout}
            </button>
          </form>
        </div>
      </div>
    );
  }
  const data = await loadBoard(viewer);
  return <Board initial={data} viewer={viewer} />;
}
