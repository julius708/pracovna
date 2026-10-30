'use client';

import Link from 'next/link';
import UsageTracker from './UsageTracker';
import { usePathname } from 'next/navigation';
import { logoutAction } from '@/app/_lib/actions';
import type { Viewer } from '@/app/_lib/viewer';
import { formatDM, formatHM, todayInTz } from '@/core/packing';
import { sk } from '@/core/i18n/sk';
import { syncState } from './board-model';
import { PushToggle } from './PushToggle';
import PullToRefresh, { RefreshButton } from './Refresh';
import { BASE, HUB } from '@/lib/base';

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
      <PullToRefresh />
      <div className="li-masthead"><div className="li-masthead-inner">
        <a className="li-brand-link" href={HUB}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${BASE}/livein-logo.png`} alt="LIVE-IN"/><span className="li-product">Práčovňa</span>
        </a>
        <nav className="li-nav" aria-label="Práčovňa">
          {(admin ? NAV : [NAV[0]]).map(n => <Link key={n.href} href={n.href} aria-current={path === n.href || (n.href !== '/' && path.startsWith(`${n.href}/`)) ? 'page' : undefined}>{n.label}</Link>)}
        </nav>
        <div className="li-account"><a className="li-back" href={HUB}>← Späť</a><RefreshButton /><span>{viewer.name}</span><form action={logoutAction} style={{ display: 'contents' }}><button type="submit">{sk.buttons.logout}</button></form></div>
      </div></div>
      <div className="li-trail"><a href={HUB}>LIVE-IN domov</a><span>Práčovňa</span></div>
      {/* no intro frame (Martina, 2026-10-30): only the sync state and the notification switch stay, in a slim row */}
      <div className="li-tools-bar">{showSync && <SyncBadge lastOkSyncAt={lastOkSyncAt} now={now} connected={connected} />}<PushToggle /></div>
      {!viewer.dev && <UsageTracker />}
    </>
  );
}
