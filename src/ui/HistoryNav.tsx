import Link from 'next/link';

/** Switch between the audit log and the packing history inside "História". */
export function HistoryNav({ current, admin = true }: { current: 'events' | 'packed' | 'billing'; admin?: boolean }) {
  return (
    <nav className="subnav" aria-label="História">
      {admin && (
        <Link className="btn ghost" href="/historia" aria-current={current === 'events' ? 'page' : undefined}>
          Udalosti
        </Link>
      )}
      <Link className="btn ghost" href="/historia/balenie" aria-current={current === 'packed' ? 'page' : undefined}>
        Zabalené balíčky
      </Link>
      {admin && (
        <Link className="btn ghost" href="/historia/vyuctovanie" aria-current={current === 'billing' ? 'page' : undefined}>
          Vyúčtovanie
        </Link>
      )}
    </nav>
  );
}
