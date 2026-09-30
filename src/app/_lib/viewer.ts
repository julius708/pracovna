import { cookies } from 'next/headers';
import { currentProfile } from '@/db/server';
import { env, missingSupabaseEnv, type Env } from '@/env';

export interface Viewer {
  id: string;
  name: string;
  role: 'staff' | 'admin';
  active: boolean;
  /** True for the development stand-in used when no Supabase is configured. */
  dev: boolean;
}

export const DEV_ROLE_COOKIE = 'pr-dev-role';

export const DEV_VIEWERS: Record<'admin' | 'staff', Viewer> = {
  admin: { id: '00000000-0000-4000-8000-0000000000ad', name: 'Test správca', role: 'admin', active: true, dev: true },
  staff: { id: '00000000-0000-4000-8000-00000000005f', name: 'Test personál', role: 'staff', active: true, dev: true },
};

export function supabaseConfigured(e: Env = env()): boolean {
  return missingSupabaseEnv(e).length === 0;
}

/** Development login is possible only in seed mode without a database. */
export function devLoginAllowed(e: Env = env()): boolean {
  return !supabaseConfigured(e) && e.SEED_MODE && e.APP_ENV !== 'production';
}

/** The signed-in person, or null. */
export async function getViewer(): Promise<Viewer | null> {
  const e = env();
  if (supabaseConfigured(e)) {
    const p = await currentProfile();
    return p ? { id: p.id, name: p.display_name, role: p.role, active: p.active, dev: false } : null;
  }
  if (!devLoginAllowed(e)) return null;
  const role = (await cookies()).get(DEV_ROLE_COOKIE)?.value;
  return role === 'admin' || role === 'staff' ? DEV_VIEWERS[role] : null;
}
