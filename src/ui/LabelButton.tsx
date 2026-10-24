'use client';

import { useState } from 'react';
import { sk } from '@/core/i18n/sk';
import { hasBluetooth, LabelPrintError, printLabel } from './labelPrinter';

/** "🖨️ Štítok" on a flat's card: prints the flat's name on the X6 label printer (Martina, 2026-10-24). */
export function LabelButton({ name, alias }: { name: string; alias: string | null }) {
  const [state, setState] = useState<{ text: string; error: boolean; detail?: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onPrint() {
    if (!hasBluetooth()) {
      setState({ text: sk.label.noBluetooth, error: true });
      return;
    }
    setBusy(true);
    setState(null);
    try {
      await printLabel(name, alias, () => setState({ text: sk.label.printing, error: false }));
      setState({ text: sk.label.done, error: false });
    } catch (e) {
      const code = e instanceof LabelPrintError ? e.code : 'failed';
      const detail = e instanceof LabelPrintError ? e.detail : String(e);
      setState({ text: sk.label[code], error: code !== 'cancelled' && code !== 'showAll', detail });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn ghost" type="button" disabled={busy} onClick={onPrint}>
        {sk.label.button}
      </button>
      {state && (
        <div className={state.error ? 'warnTxt' : undefined} style={{ flexBasis: '100%', fontSize: 14 }} role="status">
          {state.text}
          {state.detail && <div style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 400, marginTop: 2 }}>{state.detail}</div>}
        </div>
      )}
    </>
  );
}
