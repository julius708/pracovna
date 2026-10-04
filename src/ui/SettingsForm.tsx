'use client';

import { useRef, useState, useTransition } from 'react';
import type { SettingsView } from '@/app/_lib/admin';
import { saveSettingsAction, setProfileAction } from '@/app/_lib/admin-actions';
import type { BedGroup, Counts, ItemDef, PackingSettings } from '@/core/packing';
import { pluralBalicek, sk } from '@/core/i18n/sk';

const GROUPS: { key: BedGroup; label: string }[] = [
  { key: 'dvoj', label: 'Manželská' },
  { key: 'jedno', label: 'Jednolôžko' },
  { key: 'gauc', label: 'Gauč' },
];
const COLS: { key: string; label: string }[] = [
  ...GROUPS.map((g) => ({ key: `bed:${g.key}`, label: g.label })),
  { key: 'perGuest', label: 'Na hosťa' },
  { key: 'perBathroom', label: 'Na kúpeľňu' },
  { key: 'perApartment', label: 'Na byt' },
];

function cell(s: PackingSettings, col: string, item: string): number {
  const [a, b] = col.split(':');
  const o: Counts | undefined = b ? s.beds[b as BedGroup] : (s[a as 'perGuest' | 'perBathroom' | 'perApartment'] as Counts);
  return o?.[item] ?? 0;
}

export function SettingsForm({ view, meId }: { view: SettingsView; meId: string }) {
  const [s, setS] = useState<PackingSettings>(view.linen);
  const [duvets, setDuvets] = useState<Record<string, string>>(view.duvetTypes);
  const [checklist, setChecklist] = useState(view.linen.checklist.join('\n'));
  const [linenVersion, setLinenVersion] = useState(view.linenVersion);
  const [duvetVersion, setDuvetVersion] = useState(view.duvetVersion);
  const [profiles, setProfiles] = useState(view.profiles);
  /** Problems stay on screen until the next attempt; confirmations show as a toast and disappear. */
  const [msg, setMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pending, start] = useTransition();

  const showToast = (text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  };

  const setCell = (col: string, item: string, raw: string) => {
    const n = Math.max(0, Math.min(20, parseInt(raw, 10) || 0));
    setS((cur) => {
      const next: PackingSettings = { ...cur, beds: { ...cur.beds }, perGuest: { ...cur.perGuest }, perBathroom: { ...cur.perBathroom }, perApartment: { ...cur.perApartment } };
      const [a, b] = col.split(':');
      const target: Counts = b ? { ...next.beds[b as BedGroup] } : { ...(next[a as 'perGuest' | 'perBathroom' | 'perApartment'] as Counts) };
      if (n) target[item] = n;
      else delete target[item];
      if (b) next.beds[b as BedGroup] = target;
      else (next as unknown as Record<string, Counts>)[a] = target;
      return next;
    });
  };
  const setItem = (key: string, field: 'label' | 'size', value: string) =>
    setS((cur) => ({ ...cur, items: cur.items.map((it: ItemDef) => (it.key === key ? { ...it, [field]: value } : it)) }));

  const save = () =>
    start(async () => {
      setMsg(null);
      const linen: PackingSettings = { ...s, checklist: checklist.split('\n').map((x) => x.trim()).filter(Boolean) };
      try {
        const r1 = await saveSettingsAction('linen_table', linen, linenVersion);
        if (!r1.ok) {
          setMsg(r1.conflict ? sk.admin.conflict : r1.error === 'unauthorized' ? sk.toasts.adminOnly : sk.toasts.saveFailed);
          return;
        }
        setLinenVersion(r1.version ?? linenVersion + 1);
        const clean: Record<string, string> = {};
        for (const [k, v] of Object.entries(duvets)) if (v === 'male' || v === 'velke') clean[k] = v;
        const r2 = await saveSettingsAction('duvet_types', clean, duvetVersion);
        if (!r2.ok) {
          setMsg(r2.conflict ? sk.admin.conflict : sk.toasts.saveFailed);
          return;
        }
        setDuvetVersion(r2.version ?? duvetVersion + 1);
        if (r1.recomputeFailed || r2.recomputeFailed) {
          setMsg(sk.toasts.savedRecomputeFailed);
          return;
        }
        const n = (r1.recomputed ?? 0) + (r2.recomputed ?? 0);
        showToast(`${sk.toasts.saved} · prepočítané ${n} ${pluralBalicek(n)}`);
      } catch {
        setMsg(sk.toasts.saveFailed);
      }
    });

  /** Controlled inputs: the row changes only after the server confirmed, so a refused change snaps back. */
  const changeProfile = (id: string, role: 'staff' | 'admin' | null, active: boolean | null) =>
    start(async () => {
      setMsg(null);
      try {
        const r = await setProfileAction(id, role, active);
        if (r.ok) {
          setProfiles((list) => list.map((p) => (p.id === id ? { ...p, role: role ?? p.role, active: active ?? p.active } : p)));
          showToast(sk.admin.userUpdated);
          return;
        }
        setMsg(r.error === 'self' ? sk.admin.selfChange : r.error === 'unauthorized' ? sk.toasts.adminOnly : sk.toasts.saveFailed);
      } catch {
        setMsg(sk.toasts.saveFailed);
      }
    });

  return (
    <section className="sheet">
      <h2>Nastavenie balíčkov</h2>
      <p>
        Koľko kusov patrí na jednu posteľ, osobu a kúpeľňu. Manželská posteľ aj rozkladací gauč sú pre 2 osoby, jednolôžko pre 1. Byt s malými paplónmi dostane namiesto 1 veľkého 2 malé na každú manželskú posteľ a gauč. Keď je v deň check-outu aj check-in, balí sa presne na počet hostí z rezervácie. Keď sa voľné noci do ďalšieho príchodu nedajú predať (minimálny pobyt), balí sa na hostí ďalšej rezervácie. Inak sa byt pripraví na maximálnu kapacitu z Guesty (vrátane rozkladacieho gauča, ak ho kapacita vyžaduje). Toaletný papier má pevné pravidlo: 1 osoba = 2 kusy, inak 1 na osobu.
      </p>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Položka · rozmer</th>
              {COLS.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.items.map((it) => (
              <tr key={it.key}>
                <td>
                  <input className="lbl" value={it.label} aria-label="Názov" onChange={(e) => setItem(it.key, 'label', e.target.value)} />{' '}
                  <input className="lbl" style={{ width: 90 }} value={it.size ?? ''} aria-label="Rozmer" onChange={(e) => setItem(it.key, 'size', e.target.value)} />
                </td>
                {COLS.map((c) => (
                  <td key={c.key}>
                    {it.key === 'toaletak' ? (
                      c.key === 'perApartment' ? (
                        <span title="max(2, osoby)">max(2, osôb)</span>
                      ) : (
                        '–'
                      )
                    ) : (
                      <input
                        type="number"
                        min={0}
                        max={20}
                        inputMode="numeric"
                        value={cell(s, c.key, it.key) || ''}
                        aria-label={`${it.label} – ${c.label}`}
                        onChange={(e) => setCell(c.key, it.key, e.target.value)}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Paplóny podľa bytu</h3>
      <p>Veľké = 1 veľký paplón na manželskú posteľ / gauč. Malé = 2 malé. Jednolôžko má vždy 1 malý paplón, 1 vankúš a malú plachtu. Ak je v Guesty zapísaný typ, platí Guesty. Ak je v Guesty zapísaný počet, je to plná sada bytu: každý hosť dostane 1 paplón (najprv veľké), nikdy viac, než má byt. Vankúše a plachty idú k paplónom: k veľkému 2 vankúše a 1 plachta, k malému 1 vankúš a 1 malá plachta.</p>
      <div className="dvlist">
        {view.listings
          .filter((l) => l.inScope)
          .map((l) => (
            <label className="dvrow" key={l.id}>
              <span>
                {l.name}
                {l.guestyDuvets && <small> (Guesty: {l.guestyDuvets === 'exact' ? 'plná sada' : l.guestyDuvets === 'male' ? 'malé' : 'veľké'})</small>}
              </span>
              <select value={duvets[l.id] ?? ''} onChange={(e) => setDuvets((d) => ({ ...d, [l.id]: e.target.value }))} aria-label={`Paplóny – ${l.name}`}>
                <option value="">—</option>
                <option value="velke">Veľké</option>
                <option value="male">Malé</option>
              </select>
            </label>
          ))}
      </div>

      <h3>Checklist na každý byt</h3>
      <p>Jedna položka na riadok. Zobrazí sa pri každom byte na odškrtnutie. Položky navyše pre konkrétny byt sa píšu do Guesty (riadok „Navyše: …“).</p>
      <textarea aria-label="Checklist" value={checklist} onChange={(e) => setChecklist(e.target.value)} />

      <h3>Používatelia</h3>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Meno</th>
              <th>Rola</th>
              <th>Aktívny</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => {
              const mine = p.id === meId;
              return (
                <tr key={p.id}>
                  <td>
                    {p.display_name}
                    {mine && <small style={{ color: 'var(--muted)' }}> ({sk.admin.ownAccount})</small>}
                  </td>
                  <td>
                    <select
                      value={p.role}
                      disabled={mine || pending}
                      title={mine ? sk.admin.selfChange : undefined}
                      aria-label={`Rola – ${p.display_name}`}
                      onChange={(e) => changeProfile(p.id, e.target.value as 'staff' | 'admin', null)}
                    >
                      <option value="staff">personál</option>
                      <option value="admin">správca</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={p.active}
                      disabled={mine || pending}
                      title={mine ? sk.admin.selfChange : undefined}
                      aria-label={`Aktívny – ${p.display_name}`}
                      onChange={(e) => changeProfile(p.id, null, e.target.checked)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 8 }}>Nových používateľov pridáva správca v Supabase (Authentication → Add user). Vlastný účet si správca nemôže deaktivovať ani odobrať rolu.</p>

      <h3>Vylúčené byty</h3>
      <div className="dvlist">
        {view.listings
          .filter((l) => !l.inScope)
          .map((l) => (
            <div className="dvrow" key={l.id}>
              <span>{l.name}</span>
              <small>{l.reason}</small>
            </div>
          ))}
      </div>

      {msg && (
        <div className="note" role="alert" style={{ marginTop: 12 }}>
          {msg}
        </div>
      )}
      <div className="actions">
        <button className="btn primary" type="button" onClick={save} disabled={pending}>
          {sk.buttons.saveSettings}
        </button>
      </div>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </section>
  );
}
