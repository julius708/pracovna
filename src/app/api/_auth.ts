import { currentProfile } from '@/db/server';
import type { Env } from '@/env';

/** Cron routes: Vercel sends "Authorization: Bearer <CRON_SECRET>". In seed mode without a secret, allow. */
export function isCronAuthorized(req: Request, env: Env): boolean {
  const header = req.headers.get('authorization') ?? '';
  if (env.CRON_SECRET) return header === `Bearer ${env.CRON_SECRET}`;
  return env.SEED_MODE && env.APP_ENV !== 'production';
}

/** Admin routes: an admin session, or the cron secret for operators. */
export async function isAdminAuthorized(req: Request, env: Env): Promise<boolean> {
  if (isCronAuthorized(req, env) && (env.CRON_SECRET || env.SEED_MODE)) return true;
  try {
    const profile = await currentProfile();
    return !!profile && profile.active && profile.role === 'admin';
  } catch {
    return false;
  }
}

export function unauthorized(): Response {
  return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
}
