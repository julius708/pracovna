'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addBoardNoteAction, checkAction, noteAction, packAction, removeBoardNoteAction, unpackAction, type ActionResult } from '@/app/_lib/actions';
import type { BoardData, BoardNote, BoardPackage } from '@/app/_lib/board';
import type { Viewer } from '@/app/_lib/viewer';
import { formatDM } from '@/core/packing';
import { dayLabel, dayWord, packedOf, sk } from '@/core/i18n/sk';
import { useRouter } from 'next/navigation';
import { newActionId } from './action-id';
import { isRecoveryHash } from './recovery';
import { angelikaNumbers, applyCleaner, boardNotices, cleanerOptions, counts, dayJobs, FILTER_KEYS, noteNotices, summaryLines, visibleJobs, type Filter } from './board-model';
import { Header } from './Header';
import { NoticeBoard } from './NoticeBoard';
import { PackageCard, type CardHandlers } from './PackageCard';
import { Summary } from './Summary';
import { useLiveBoard } from './useLiveBoard';

const AV = '/assets/angelika.jpg';
const CHEER_MS = 3500;
const NOTICE_MS = 7000;
/** How long a package this device changed itself is exempt from "someone else changed it" notices. */
const OWN_CHANGE_MS = 15_000;

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
  const { data, setData, refresh, connected, track } = useLiveBoard(initial);
  const [sel, setSel] = useState(0);
  // default "Všetko": packed cards stay in place (green, sorted after the open ones) across reloads and devices;
  // the chosen filter is remembered per device below
  const [filter, setFilter] = useState<Filter>('all');
  const [cleaner, setCleaner] = useState('');
  const [keep, setKeep] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [cheer, setCheer] = useState<{ id: string; msg: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [notices, setNotices] = useState<{ id: number; text: string }[]>([]);
  // seeded from the server's instant so the hydrated header matches the SSR markup
  const [now, setNow] = useState(() => new Date(initial.loadedAt));
  const cheerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPackages = useRef(initial.packages);
  const prevNotes = useRef(initial.notes);
  const [noteBusy, setNoteBusy] = useState(false);
  const ownChanges = useRef(new Map<string, number>());
  const noticeSeq = useRef(0);
  const router = useRouter();
  const dates = data.dates;

  // notices about changes made elsewhere: other devices' packs/undos and Guesty updates (spec: everyone sees the same board)
  useEffect(() => {
    const prev = prevPackages.current;
    const prevN = prevNotes.current;
    prevPackages.current = data.packages;
    prevNotes.current = data.notes;
    if (prev === data.packages && prevN === data.notes) return;
    const cutoff = Date.now() - OWN_CHANGE_MS;
    for (const [id, at] of ownChanges.current) if (at < cutoff) ownChanges.current.delete(id);
    const texts = [
      ...(prev === data.packages ? [] : boardNotices(prev, data.packages, viewer.name, new Set(ownChanges.current.keys()), (d) => dayLabel(dates.indexOf(d as (typeof dates)[number]), d))),
      ...(prevN === data.notes ? [] : noteNotices(prevN, data.notes, viewer.name)),
    ];
    if (texts.length === 0) return;
    const items = texts.map((text) => ({ id: ++noticeSeq.current, text }));
    const show = setTimeout(() => {
      setNotices((n) => [...n, ...items].slice(-4));
      try {
        navigator.vibrate?.(80);
      } catch {
        // not supported
      }
    }, 0);
    const hide = setTimeout(() => setNotices((n) => n.filter((x) => !items.some((i) => i.id === x.id))), NOTICE_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [data.packages, data.notes, dates, viewer.name]);

  useEffect(() => {
    // a password-recovery link opened while signed in lands here with the session in the fragment
    if (isRecoveryHash(window.location.hash)) {
      router.replace(`/nove-heslo${window.location.hash}`);
      return;
    }
    // restore the per-device filter after hydration (the server always renders "Všetko")
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
  }, [router]);

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

  const patch = (id: string, fn: (p: BoardPackage) => BoardPackage) => {
    ownChanges.current.set(id, Date.now());
    setData((d) => ({ ...d, packages: d.packages.map((p) => (p.id === id ? fn(p) : p)) }));
  };
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
        res = await track(() => packAction(p.id, newActionId()));
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
        res = await track(() => unpackAction(p.id, newActionId()));
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
        res = await track(() => noteAction(p.id, clean, newActionId()));
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
        res = await track(() => checkAction(p.id, item, checked, newActionId()));
      } catch {
        res = { ok: false, error: 'failed' };
      }
      if (!res.ok) {
        patch(p.id, () => before);
        showToast(res.error === 'unauthorized' ? sk.toasts.noPermission : sk.toasts.checkNotSaved);
      }
    },
  };

  const addNote = async (text: string) => {
    const temp: BoardNote = { id: `temp-${newActionId()}`, text, author: viewer.id, author_name: viewer.name, created_at: new Date().toISOString() };
    setNoteBusy(true);
    setData((d) => ({ ...d, notes: [temp, ...d.notes] }));
    let res: ActionResult;
    try {
      res = await track(() => addBoardNoteAction(text, newActionId()));
    } catch {
      res = { ok: false, error: 'failed' };
    }
    setNoteBusy(false);
    if (res.ok) {
      if (res.id) setData((d) => ({ ...d, notes: d.notes.map((n) => (n.id === temp.id ? { ...n, id: res.id as string } : n)) }));
      void refresh();
    } else {
      setData((d) => ({ ...d, notes: d.notes.filter((n) => n.id !== temp.id) }));
      showToast(res.error === 'unauthorized' ? sk.toasts.noPermission : sk.noticeBoard.notSaved);
    }
  };

  const removeNote = async (note: BoardNote) => {
    const before = data.notes;
    setNoteBusy(true);
    setData((d) => ({ ...d, notes: d.notes.filter((n) => n.id !== note.id) }));
    let res: ActionResult;
    try {
      res = await track(() => removeBoardNoteAction(note.id, newActionId()));
    } catch {
      res = { ok: false, error: 'failed' };
    }
    setNoteBusy(false);
    if (res.ok) {
      void refresh();
    } else {
      setData((d) => ({ ...d, notes: before }));
      showToast(res.status === 'not_author' ? sk.noticeBoard.notAuthor : res.error === 'unauthorized' ? sk.toasts.noPermission : sk.noticeBoard.notRemoved);
    }
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

      <NoticeBoard notes={data.notes} viewer={viewer} now={now} busy={noteBusy} onAdd={(t) => void addNote(t)} onRemove={(n) => void removeNote(n)} />

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

      {notices.length > 0 && (
        <div className="notices" role="status" aria-live="polite">
          {notices.map((n) => (
            <div className="notice" key={n.id}>
              {n.text}
            </div>
          ))}
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
