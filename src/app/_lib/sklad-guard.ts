import 'server-only';
import { redirect } from 'next/navigation';
import { getViewer } from './viewer';

/** Sklad screens: every active user may open "Pohyby" (to write an issue); everything else is for the správca. */
export async function sklad(opts: { admin?: boolean } = { admin: true }) {
  const viewer = await getViewer();
  if (!viewer || !viewer.active) redirect('/login');
  if (opts.admin !== false && viewer.role !== 'admin') redirect('/sklad/pohyby');
  return viewer;
}

export const qp = (sp: Record<string, string | string[] | undefined>, k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
