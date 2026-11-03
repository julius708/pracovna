'use client';
import { useEffect, useState } from 'react';
import { HUB } from '@/lib/base';

/** LIVE-IN Guru v Práčovni: postavička dole vpravo, po kliknutí okno s chatom z hlavnej appky (rovnaké prihlásenie). */
export function GuruDock() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <>
      <button type="button" className={`guru-dock${open ? ' on' : ''}`} onClick={() => { setOpen((o) => !o); setLoaded(true); }} aria-expanded={open} aria-controls="guru-panel" aria-label={open ? 'Zavrieť Guru' : 'Opýtať sa Guru'}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${HUB}/guru-v3.png`} alt="" />
        <span>{open ? 'Zavrieť' : 'Opýtať sa Guru'}</span>
      </button>
      <div id="guru-panel" className={`guru-panel${open ? ' open' : ''}`} role="dialog" aria-label="LIVE-IN Guru" aria-hidden={!open}>
        <div className="guru-panel-head">
          <b>🧠 LIVE-IN Guru</b>
          <small>byty, rezervácie, Práčovňa, postupy</small>
          <button type="button" onClick={() => setOpen(false)} aria-label="Zavrieť">×</button>
        </div>
        {loaded && <iframe src={`${HUB}/guru?embed=1`} title="LIVE-IN Guru" allow="microphone" />}
      </div>
    </>
  );
}
