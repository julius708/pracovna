'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logoutAction } from '@/app/_lib/actions';
import type { Viewer } from '@/app/_lib/viewer';
import { formatDM, formatHM, todayInTz } from '@/core/packing';
import { sk } from '@/core/i18n/sk';
import { syncState } from './board-model';

export function LogoMark() {
  return (
    <span className="logo" aria-label="LIVE-IN">
      <svg viewBox="0 0 30 28" aria-hidden="true">
        <path d="M4 13 V10.5 L15 3.5 L26 10.5 V24.5 H4 V21.5" fill="none" stroke="var(--brand)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="wm">{sk.brand}</span>
    </span>
  );
}

export function SyncBadge({ lastOkSyncAt, now, connected }: { lastOkSyncAt: string | null; now: Date; connected: boolean }) {
  const s = syncState(lastOkSyncAt, now);
  let text: string = sk.syncNoData;
  if (lastOkSyncAt) {
    const d = new Date(lastOkSyncAt);
    const day = todayInTz(d) === todayInTz(now) ? sk.syncToday : formatDM(todayInTz(d));
    text = `${day} ${formatHM(d)}`;
  }
  return (
    <div className={`sync${s.stale ? ' stale' : ''}`} id="sync" title={s.stale ? 'Posledná synchronizácia je staršia ako 30 minút' : undefined}>
      {sk.syncSource}
      <br />
      <b>{text}</b>
      {!connected && <span className="offline-dot" title="offline" aria-label="offline" />}
    </div>
  );
}

const NAV: { href: string; label: string }[] = [
  { href: '/', label: 'Balenie' },
  { href: '/nastavenia', label: sk.buttons.settings },
  { href: '/historia', label: 'História' },
  { href: '/stav', label: 'Stav' },
];

export function Header({
  viewer,
  lastOkSyncAt,
  now,
  connected,
  showSync = true,
}: {
  viewer: Viewer;
  lastOkSyncAt: string | null;
  now: Date;
  connected: boolean;
  showSync?: boolean;
}) {
  const path = usePathname();
  const admin = viewer.role === 'admin';
  return (
    <>
      <div className="brand">
        <h1>
          <LogoMark />
          <span className="sep" aria-hidden="true" />
          {sk.app}
        </h1>
        {showSync && <SyncBadge lastOkSyncAt={lastOkSyncAt} now={now} connected={connected} />}
      </div>
      <div className="nav" style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8, flexWrap: 'wrap', fontSize: 13 }}>
        {admin &&
          NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={path === n.href || (n.href !== '/' && path.startsWith(`${n.href}/`)) ? 'page' : undefined}>
              {n.label}
            </Link>
          ))}
        <form action={logoutAction} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
          <span style={{ color: 'var(--muted)' }}>{viewer.name}</span>
          <button type="submit" style={{ background: 'none', border: 0, padding: '0 6px', fontSize: 13, fontWeight: 600, color: 'var(--accent)', minHeight: 44 }}>
            {sk.buttons.logout}
          </button>
        </form>
      </div>
    </>
  );
}
