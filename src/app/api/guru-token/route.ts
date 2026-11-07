import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/db/server';

export const dynamic = 'force-dynamic';

/**
 * Krátkodobý prístupový token prihláseného človeka pre LIVE-IN Guru (hlavná appka ho overí ako Bearer).
 * Guru widget tak funguje aj na pracovna.live-in.international, kde cookie hlavnej appky nie je.
 */
export async function GET() {
  const db = await createServerSupabase();
  if (!db) return NextResponse.json({ ok: false }, { status: 503 });
  const { data: userData } = await db.auth.getUser();
  if (!userData?.user) return NextResponse.json({ ok: false }, { status: 401 });
  const { data } = await db.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, token, exp: data.session?.expires_at ?? null }, { headers: { 'cache-control': 'no-store' } });
}
