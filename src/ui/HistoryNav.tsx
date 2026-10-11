import Link from 'next/link';

/** Switch between the audit log and the packing history inside "História". */
export function HistoryNav({ current }: { current: 'events' | 'packed' }) {
  return (
    <nav className="subnav" aria-label="História">
      <Link className="btn ghost" href="/historia" aria-current={current === 'events' ? 'page' : undefined}>
        Udalosti
      </Link>
      <Link className="btn ghost" href="/historia/balenie" aria-current={current === 'packed' ? 'page' : undefined}>
        Zabalené balíčky
      </Link>
    </nav>
  );
}
