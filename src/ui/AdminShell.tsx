import type { ReactNode } from 'react';
import type { Viewer } from '@/app/_lib/viewer';
import { Header } from './Header';

/** Header + content container for the admin pages. */
export function AdminShell({ viewer, children }: { viewer: Viewer; children: ReactNode }) {
  return (
    <div className="wrap">
      <header className="top">
        <Header viewer={viewer} lastOkSyncAt={null} now={new Date()} connected={true} />
      </header>
      {children}
    </div>
  );
}
