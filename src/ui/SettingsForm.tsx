'use client';

import { useState, useTransition } from 'react';
import type { SettingsView } from '@/app/_lib/admin';
import { saveSettingsAction, setProfileAction } from '@/app/_lib/admin-actions';
import type { BedGroup, Counts, ItemDef, PackingSettings } from '@/core/packing';
import { sk } from '@/core/i18n/sk';

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

export function SettingsForm({ view }: { view: SettingsView }) {
  const [s, setS] = useState<PackingSettings>(view.linen);
  const [duvets, setDuvets] = useState<Record<string, string>>(view.duvetTypes);
  const [checklist, setChecklist] = useState(view.linen.checklist.join('\n'));
  const [linenVersion, setLinenVersion] = useState(view.linenVersion);
  const [duvetVersion, setDuvetVersion] = useState(view.duvetVersion);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

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
      const r1 = await saveSettingsAction('linen_table', linen, linenVersion);
      if (!r1.ok) {
        setMsg(r1.conflict ? 'Nastavenie medzitým zmenil niekto iný, načítaj znova.' : r1.error === 'unauthorized' ? sk.toasts.adminOnly : sk.toasts.saveFailed);
        return;
      }
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(duvets)) if (v === 'male' || v === 'velke') clean[k] = v;
      const r2 = await saveSettingsAction('duvet_types', clean, duvetVersion);
      if (!r2.ok) {
        setMsg(r2.conflict ? 'Nastavenie medzitým zmenil niekto iný, načítaj znova.' : sk.toasts.saveFailed);
        return;
      }
      setLinenVersion(r1.version ?? linenVersion + 1);
      setDuvetVersion(r2.version ?? duvetVersion + 1);
      setMsg(`${sk.toasts.saved} · prepočítané: ${(r1.recomputed ?? 0) + (r2.recomputed ?? 0)} balíčkov`);
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
      <p>Veľké = 1 veľký paplón na manželskú posteľ / gauč. Malé = 2 malé. Jednolôžko má vždy 1 malý paplón, 1 vankúš a malú plachtu. Ak je typ alebo presný počet zapísaný v Guesty, platí Guesty.</p>
      <div className="dvlist">
        {view.listings
          .filter((l) => l.inScope)
          .map((l) => (
            <label className="dvrow" key={l.id}>
              <span>
                {l.name}
                {l.guestyDuvets && <small> (Guesty: {l.guestyDuvets === 'exact' ? 'presný počet' : l.guestyDuvets === 'male' ? 'malé' : 'veľké'})</small>}
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
            {view.profiles.map((p) => (
              <tr key={p.id}>
                <td>{p.display_name}</td>
                <td>
                  <select
                    defaultValue={p.role}
                    aria-label={`Rola – ${p.display_name}`}
                    onChange={(e) => start(async () => setMsg((await setProfileAction(p.id, e.target.value as 'staff' | 'admin', null)).ok ? 'Používateľ upravený' : sk.toasts.saveFailed))}
                  >
                    <option value="staff">personál</option>
                    <option value="admin">správca</option>
                  </select>
                </td>
                <td>
                  <input
                    type="checkbox"
                    defaultChecked={p.active}
                    aria-label={`Aktívny – ${p.display_name}`}
                    onChange={(e) => start(async () => setMsg((await setProfileAction(p.id, null, e.target.checked)).ok ? 'Používateľ upravený' : sk.toasts.saveFailed))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 8 }}>Nových používateľov pridáva správca v Supabase (Authentication → Add user).</p>

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
        <div className="note" role="status" style={{ marginTop: 12 }}>
          {msg}
        </div>
      )}
      <div className="actions">
        <button className="btn primary" type="button" onClick={save} disabled={pending}>
          {sk.buttons.saveSettings}
        </button>
      </div>
    </section>
  );
}
