'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { checkAction, noteAction, packAction, unpackAction, type ActionResult } from '@/app/_lib/actions';
import type { BoardData, BoardPackage } from '@/app/_lib/board';
import type { Viewer } from '@/app/_lib/viewer';
import { formatDM } from '@/core/packing';
import { dayLabel, dayWord, packedOf, sk } from '@/core/i18n/sk';
import { angelikaNumbers, applyCleaner, cleanerOptions, counts, dayJobs, FILTER_KEYS, summaryLines, visibleJobs, type Filter } from './board-model';
import { Header } from './Header';
import { PackageCard, type CardHandlers } from './PackageCard';
import { Summary } from './Summary';
import { useLiveBoard } from './useLiveBoard';

const AV = '/assets/angelika.jpg';
const CHEER_MS = 3500;

function readStored(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode: ignore
  }
}

export function Board({ initial, viewer }: { initial: BoardData; viewer: Viewer }) {
  const { data, setData, refresh, connected } = useLiveBoard(initial);
  const [sel, setSel] = useState(0);
  const [filter, setFilter] = useState<Filter>('todo');
  const [cleaner, setCleaner] = useState('');
  const [keep, setKeep] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [cheer, setCheer] = useState<{ id: string; msg: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const cheerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // restore the per-device filter after hydration (the server always renders "Na balenie")
    const restore = setTimeout(() => {
      const f = readStored('pr-filter');
      if (f === 'todo' || f === 'packed' || f === 'all') setFilter(f);
      setCleaner(readStored('pr-cleaner'));
    }, 0);
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => {
      clearTimeout(restore);
      clearInterval(t);
    };
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const date = data.dates[sel];
  const allJobs = useMemo(() => dayJobs(data.packages, date), [data.packages, date]);
  const cleaners = useMemo(() => cleanerOptions(allJobs, data.cleaners, sk.cleaners), [allJobs, data.cleaners]);
  // a remembered company that has no card today falls back to "all" without changing the stored choice
  const effectiveCleaner = cleaner && cleaner !== '_none' && !cleaners.some((c) => c.key === cleaner) ? '' : cleaner;
  const jobs = useMemo(() => applyCleaner(allJobs, data.cleaners, effectiveCleaner), [allJobs, data.cleaners, effectiveCleaner]);
  const c = counts(jobs);
  const numbers = angelikaNumbers(jobs);
  const lines = useMemo(
    () => summaryLines(jobs, { generic: sk.capsuleGeneric, typed: (t) => `Kapsule ${t}`, unsure: sk.capsuleUnsure, missing: sk.capsuleMissing }),
    [jobs],
  );
  const list = useMemo(() => visibleJobs(jobs, filter, keep), [jobs, filter, keep]);
  const hasData = data.status.lastOkSyncAt !== null || data.packages.length > 0;

  const patch = (id: string, fn: (p: BoardPackage) => BoardPackage) =>
    setData((d) => ({ ...d, packages: d.packages.map((p) => (p.id === id ? fn(p) : p)) }));
  const setBusyFor = (id: string, on: boolean) =>
    setBusy((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  const handleResult = (res: ActionResult, revert: () => void, onOk?: () => void) => {
    if (res.ok) {
      onOk?.();
      void refresh();
      return;
    }
    revert();
    if (res.already_packed) showToast(`Už zabalil(a) ${res.packed_by_name ?? '—'}.`);
    else if (res.error === 'unauthorized') showToast(sk.toasts.noPermission);
    else showToast(sk.toasts.notSaved);
    void refresh();
  };

  const handlers: CardHandlers = {
    onPack: async (p) => {
      const before = p;
      const t = new Date().toISOString();
      setBusyFor(p.id, true);
      patch(p.id, (x) => ({ ...x, status: 'packed', packed_by_name: viewer.name, packed_at: t, packed_hash: x.computed_hash }));
      setKeep((k) => new Set(k).add(p.id));
      let res: ActionResult;
      try {
        res = await packAction(p.id, crypto.randomUUID());
      } catch {
        res = { ok: false, error: 'failed' };
      }
      setBusyFor(p.id, false);
      handleResult(
        res,
        () => patch(p.id, () => before),
        () => {
          setCheer({ id: p.id, msg: sk.cheers[Math.floor(Math.random() * sk.cheers.length)] });
          if (cheerTimer.current) clearTimeout(cheerTimer.current);
          cheerTimer.current = setTimeout(() => setCheer(null), CHEER_MS);
        },
      );
    },
    onUndo: async (p) => {
      const before = p;
      setBusyFor(p.id, true);
      patch(p.id, (x) => ({ ...x, status: 'todo', packed_by_name: null, packed_at: null, packed_hash: null }));
      setKeep((k) => new Set(k).add(p.id));
      let res: ActionResult;
      try {
        res = await unpackAction(p.id, crypto.randomUUID());
      } catch {
        res = { ok: false, error: 'failed' };
      }
      setBusyFor(p.id, false);
      handleResult(res, () => patch(p.id, () => before));
    },
    onNote: async (p, text) => {
      const before = p;
      const clean = text.trim();
      patch(p.id, (x) => ({ ...x, note: clean, note_by_name: clean ? viewer.name : null, note_at: clean ? new Date().toISOString() : null }));
      let res: ActionResult;
      try {
        res = await noteAction(p.id, clean, crypto.randomUUID());
      } catch {
        res = { ok: false, error: 'failed' };
      }
      if (res.ok) {
        showToast(sk.toasts.noteSaved);
        void refresh();
      } else {
        patch(p.id, () => before);
        showToast(res.error === 'unauthorized' ? sk.toasts.noPermission : sk.toasts.noteNotSaved);
      }
    },
    onCheck: async (p, item, checked) => {
      const before = p;
      patch(p.id, (x) => {
        const map = { ...(x.checklist?.checked ?? {}) };
        if (checked) map[item] = true;
        else delete map[item];
        return { ...x, checklist: { items: x.checklist?.items ?? [], checked: map } };
      });
      let res: ActionResult;
      try {
        res = await checkAction(p.id, item, checked, crypto.randomUUID());
      } catch {
        res = { ok: false, error: 'failed' };
      }
      if (!res.ok) {
        patch(p.id, () => before);
        showToast(res.error === 'unauthorized' ? sk.toasts.noPermission : sk.toasts.checkNotSaved);
      }
    },
  };

  const selectDay = (i: number) => {
    setSel(i);
    setKeep(new Set());
  };
  const selectFilter = (f: Filter) => {
    setFilter(f);
    setKeep(new Set());
    store('pr-filter', f);
  };
  const selectCleaner = (k: string) => {
    setCleaner(k);
    store('pr-cleaner', k);
  };

  const filterLabels: Record<Filter, string> = { todo: sk.filters.todo, packed: sk.filters.packed, all: sk.filters.all };
  const filterCount = (f: Filter) => (f === 'all' ? jobs.length : f === 'todo' ? c.todo : c.packed);

  return (
    <div className="wrap">
      <header className="top">
        <Header viewer={viewer} lastOkSyncAt={data.status.lastOkSyncAt} now={now} connected={connected} />
        <nav className="days" id="days" aria-label="Deň">
          {data.dates.map((d, i) => {
            const dj = dayJobs(data.packages, d);
            const dc = counts(dj);
            const pct = dc.total ? Math.round((dc.packed / dc.total) * 100) : 0;
            return (
              <button key={d} type="button" className="day" aria-pressed={sel === i} onClick={() => selectDay(i)}>
                <div className="d">
                  {dayLabel(i, d)} <span style={{ fontWeight: 600, opacity: 0.6 }}>{formatDM(d)}</span>
                </div>
                <div className="n">{hasData ? packedOf(dc.packed, dc.total) : sk.noDataDash}</div>
                <div className="bar">
                  <i style={{ width: `${pct}%` }} />
                </div>
              </button>
            );
          })}
        </nav>
      </header>

      <Summary dayWord={dayWord(sel, date)} hasData={hasData} numbers={numbers} lines={lines} hasJobs={jobs.length > 0} />

      {cleaners.length > 0 && (
        <div className="filters" id="cleaners" role="toolbar" aria-label="Upratovacia služba">
          {cleaners.map((o) => (
            <button key={o.key} type="button" className="chip svc" aria-pressed={effectiveCleaner === o.key} onClick={() => selectCleaner(o.key)}>
              {o.label}
              <span className="c">{o.n}</span>
            </button>
          ))}
        </div>
      )}
      <div className="filters" id="filters" role="toolbar" aria-label="Filter">
        {FILTER_KEYS.map((f) => (
          <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => selectFilter(f)}>
            {filterLabels[f]}
            <span className="c">{filterCount(f)}</span>
          </button>
        ))}
      </div>

      <main className="jobs" id="jobs">
        {list.map((p) => (
          <PackageCard
            key={p.id}
            p={p}
            cleaner={data.cleaners[p.listing_id] ?? null}
            viewer={viewer}
            busy={busy.has(p.id)}
            cheer={cheer?.id === p.id ? cheer.msg : null}
            handlers={handlers}
          />
        ))}
      </main>

      {jobs.length > 0 && list.length === 0 && (
        <div className="state" id="state">
          {filter === 'todo' && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img className="av2" src={AV} alt="" />
          )}
          <strong>{filter === 'todo' ? sk.empty.allPacked : sk.empty.nothing}</strong>
          {filter === 'todo' ? sk.empty.allPackedHint : sk.empty.nothingHint}
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
