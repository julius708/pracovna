'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addBoardNoteAction, addBoardReplyAction, addEarlyArrivalAction, addEarlyDepartureAction, checkAction, editBoardNoteAction, noteAction, packAction, removeBoardNoteAction, removeEarlyArrivalAction, removeEarlyDepartureAction, unpackAction, type ActionResult } from '@/app/_lib/actions';
import type { BoardData, BoardNote, BoardPackage, EarlyArrival, EarlyDeparture } from '@/app/_lib/board';
import type { Viewer } from '@/app/_lib/viewer';
import { formatDM } from '@/core/packing';
import { dayLabel, dayWord, packedOf, sk } from '@/core/i18n/sk';
import { useRouter } from 'next/navigation';
import { newActionId } from './action-id';
import { isRecoveryHash } from './recovery';
import { angelikaNumbers, applyCleaner, arrivalFor, arrivalNotices, boardNotices, cleanerOptions, counts, dayJobs, FILTER_KEYS, noteNotices, departureFor, sortArrivals, sortDepartures, summaryLines, searchPackages, visibleJobs, type Filter } from './board-model';
import { EarlyArrivals } from './EarlyArrivals';
import { EarlyDepartures } from './EarlyDepartures';
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
  const [search, setSearch] = useState('');
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
  const prevArrivals = useRef(initial.arrivals);
  const [noteBusy, setNoteBusy] = useState(false);
  const [arrivalBusy, setArrivalBusy] = useState(false);
  const [departureBusy, setDepartureBusy] = useState(false);
  /** Early arrivals this device removed itself: no "odstránený" notice for them. */
  const ownArrivalIds = useRef(new Set<string>());
  const ownChanges = useRef(new Map<string, number>());
  const noticeSeq = useRef(0);
  const router = useRouter();
  const dates = data.dates;

  // notices about changes made elsewhere: other devices' packs/undos and Guesty updates (spec: everyone sees the same board)
  useEffect(() => {
    const prev = prevPackages.current;
    const prevN = prevNotes.current;
    const prevA = prevArrivals.current;
    prevPackages.current = data.packages;
    prevNotes.current = data.notes;
    prevArrivals.current = data.arrivals;
    if (prev === data.packages && prevN === data.notes && prevA === data.arrivals) return;
    const cutoff = Date.now() - OWN_CHANGE_MS;
    for (const [id, at] of ownChanges.current) if (at < cutoff) ownChanges.current.delete(id);
    const texts = [
      ...(prev === data.packages ? [] : boardNotices(prev, data.packages, viewer.name, new Set(ownChanges.current.keys()), (d) => dayWord(dates.indexOf(d as (typeof dates)[number]), d))),
      ...(prevN === data.notes ? [] : noteNotices(prevN, data.notes, viewer.name, (d) => `${dayWord(dates.indexOf(d as (typeof dates)[number]), d)} ${formatDM(d)}`)),
      ...(prevA === data.arrivals ? [] : arrivalNotices(prevA, data.arrivals, viewer.name, ownArrivalIds.current, dates, (d) => `${dayWord(dates.indexOf(d as (typeof dates)[number]), d)} ${formatDM(d)}`)),
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
  }, [data.packages, data.notes, data.arrivals, dates, viewer.name]);

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
  const list = useMemo(() => searchPackages(visibleJobs(jobs, filter, keep), search), [jobs, filter, keep, search]);
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
    const temp: BoardNote = { id: `temp-${newActionId()}`, text, date, author: viewer.id, author_name: viewer.name, created_at: new Date().toISOString(), edited_at: null, parent_id: null };
    setNoteBusy(true);
    setData((d) => ({ ...d, notes: [temp, ...d.notes] }));
    let res: ActionResult;
    try {
      res = await track(() => addBoardNoteAction(text, date, newActionId()));
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

  /** A reply under a note (on the note's day); true when it was saved. */
  const addReply = async (parent: BoardNote, text: string): Promise<boolean> => {
    const temp: BoardNote = { id: `temp-${newActionId()}`, text, date: parent.date, author: viewer.id, author_name: viewer.name, created_at: new Date().toISOString(), edited_at: null, parent_id: parent.id };
    setNoteBusy(true);
    setData((d) => ({ ...d, notes: [temp, ...d.notes] }));
    let res: ActionResult;
    try {
      res = await track(() => addBoardReplyAction(parent.id, text, newActionId()));
    } catch {
      res = { ok: false, error: 'failed' };
    }
    setNoteBusy(false);
    if (res.ok) {
      if (res.id) setData((d) => ({ ...d, notes: d.notes.map((n) => (n.id === temp.id ? { ...n, id: res.id as string } : n)) }));
      void refresh();
      return true;
    }
    setData((d) => ({ ...d, notes: d.notes.filter((n) => n.id !== temp.id) }));
    showToast(res.error === 'unauthorized' ? sk.toasts.noPermission : res.status === 'removed' ? sk.noticeBoard.replyParentGone : sk.noticeBoard.replyNotSaved);
    return false;
  };

  /** Records an early arrival for the selected day; true when it was saved (the form then clears). */
  const addArrival = async (listingId: string, arrival: string, note: string): Promise<boolean> => {
    const name = data.listings.find((l) => l.id === listingId)?.name ?? listingId;
    const temp: EarlyArrival = { id: `temp-${newActionId()}`, listing_id: listingId, listing_name: name, date, arrival, note, author: viewer.id, author_name: viewer.name, created_at: new Date().toISOString() };
    setArrivalBusy(true);
    setData((d) => ({ ...d, arrivals: sortArrivals([...d.arrivals, temp]) }));
    let res: ActionResult;
    try {
      res = await track(() => addEarlyArrivalAction(listingId, date, arrival, note, newActionId()));
    } catch {
      res = { ok: false, error: 'failed' };
    }
    setArrivalBusy(false);
    if (res.ok) {
      if (res.id) setData((d) => ({ ...d, arrivals: d.arrivals.map((a) => (a.id === temp.id ? { ...a, id: res.id as string } : a)) }));
      void refresh();
      return true;
    }
    setData((d) => ({ ...d, arrivals: d.arrivals.filter((a) => a.id !== temp.id) }));
    const t = sk.earlyArrivals;
    const why: Record<string, string> = { bad_time: t.badTime, bad_listing: t.badListing, bad_date: t.badDate, duplicate: t.duplicate };
    showToast(res.error === 'unauthorized' ? sk.toasts.noPermission : (res.status && why[res.status]) || t.notSaved);
    return false;
  };

  const removeArrival = async (a: EarlyArrival) => {
    const before = data.arrivals;
    ownArrivalIds.current.add(a.id);
    setArrivalBusy(true);
    setData((d) => ({ ...d, arrivals: d.arrivals.filter((x) => x.id !== a.id) }));
    let res: ActionResult;
    try {
      res = await track(() => removeEarlyArrivalAction(a.id, newActionId()));
    } catch {
      res = { ok: false, error: 'failed' };
    }
    setArrivalBusy(false);
    if (res.ok) {
      void refresh();
    } else {
      ownArrivalIds.current.delete(a.id);
      setData((d) => ({ ...d, arrivals: before }));
      showToast(res.status === 'not_author' ? sk.earlyArrivals.notAuthor : res.error === 'unauthorized' ? sk.toasts.noPermission : sk.earlyArrivals.notRemoved);
    }
  };

  /** Records an early departure for the selected day; true when it was saved (the form then clears). */
  const addDeparture = async (listingId: string, departure: string, note: string): Promise<boolean> => {
    const name = data.listings.find((l) => l.id === listingId)?.name ?? listingId;
    const temp: EarlyDeparture = { id: `temp-${newActionId()}`, listing_id: listingId, listing_name: name, date, departure, note, author: viewer.id, author_name: viewer.name, created_at: new Date().toISOString() };
    setDepartureBusy(true);
    setData((d) => ({ ...d, departures: sortDepartures([...d.departures, temp]) }));
    let res: ActionResult;
    try {
      res = await track(() => addEarlyDepartureAction(listingId, date, departure, note, newActionId()));
    } catch {
      res = { ok: false, error: 'failed' };
    }
    setDepartureBusy(false);
    if (res.ok) {
      if (res.id) setData((d) => ({ ...d, departures: d.departures.map((x) => (x.id === temp.id ? { ...x, id: res.id as string } : x)) }));
      void refresh();
      return true;
    }
    setData((d) => ({ ...d, departures: d.departures.filter((x) => x.id !== temp.id) }));
    const t = sk.earlyDepartures;
    const why: Record<string, string> = { bad_time: t.badTime, bad_listing: t.badListing, bad_date: t.badDate, duplicate: t.duplicate };
    showToast(res.error === 'unauthorized' ? sk.toasts.noPermission : (res.status && why[res.status]) || t.notSaved);
    return false;
  };

  const removeDeparture = async (x: EarlyDeparture) => {
    const before = data.departures;
    setDepartureBusy(true);
    setData((d) => ({ ...d, departures: d.departures.filter((y) => y.id !== x.id) }));
    let res: ActionResult;
    try {
      res = await track(() => removeEarlyDepartureAction(x.id, newActionId()));
    } catch {
      res = { ok: false, error: 'failed' };
    }
    setDepartureBusy(false);
    if (res.ok) {
      void refresh();
    } else {
      setData((d) => ({ ...d, departures: before }));
      showToast(res.status === 'not_author' ? sk.earlyDepartures.notAuthor : res.error === 'unauthorized' ? sk.toasts.noPermission : sk.earlyDepartures.notRemoved);
    }
  };

  const editNote = async (note: BoardNote, text: string) => {
    const before = data.notes;
    setNoteBusy(true);
    setData((d) => ({ ...d, notes: d.notes.map((n) => (n.id === note.id ? { ...n, text, edited_at: new Date().toISOString() } : n)) }));
    let res: ActionResult;
    try {
      res = await track(() => editBoardNoteAction(note.id, text, newActionId()));
    } catch {
      res = { ok: false, error: 'failed' };
    }
    setNoteBusy(false);
    if (res.ok) {
      void refresh();
    } else {
      setData((d) => ({ ...d, notes: before }));
      showToast(res.status === 'not_author' ? sk.noticeBoard.notAuthorEdit : res.error === 'unauthorized' ? sk.toasts.noPermission : sk.noticeBoard.notEdited);
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

  // seven day tabs: keep the chosen one in view on narrow screens (the row scrolls sideways)
  useEffect(() => {
    document.querySelector('.day[aria-pressed="true"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [sel]);

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
    <div className="wrap li-laundry-board">
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
                <div className="n">
                  {data.arrivals.some((a) => a.date === d) && (
                    <span className="day-arrival" title={sk.earlyArrivals.title}>
                      ⏰<span className="sr-only"> {sk.earlyArrivals.title}</span>
                    </span>
                  )}
                  {hasData ? packedOf(dc.packed, dc.total) : sk.noDataDash}
                </div>
                <div className="bar">
                  <i style={{ width: `${pct}%` }} />
                </div>
              </button>
            );
          })}
        </nav>
      </header>

      <section className="li-day-overview" aria-label="Prehľad vybraného dňa">
        <div className="li-day-heading"><div><span className="li-eyebrow">VYBRANÝ DEŇ · {formatDM(date)}</span><h2>{dayWord(sel, date)} v práčovni</h2></div><a href="#jobs">Prejsť na balíky ↓</a></div>
        <div className="li-day-stats">
          <div><span>Balíkov spolu</span><strong>{hasData ? c.total : '—'}</strong></div>
          <div className="li-todo-stat"><span>Zostáva zabaliť</span><strong>{hasData ? c.todo : '—'}</strong></div>
          <div><span>Už zabalené</span><strong>{hasData ? c.packed : '—'}</strong></div>
          <div><span>Rýchle výmeny na balenie</span><strong>{hasData ? numbers.rush : '—'}</strong></div>
        </div>
        {hasData && c.total > 0 && <div className="li-day-progress"><progress value={c.packed} max={c.total} aria-label="Priebeh balenia"/><span>{Math.round(c.packed / c.total * 100)} % hotovo</span></div>}
        {effectiveCleaner && <p className="li-selection-note">Prehľad je filtrovaný podľa vybranej upratovacej služby.</p>}
      </section>
      <section className="contact" aria-label={sk.contact.title}>
        <span className="contact-title">
          <span aria-hidden="true">📞</span> {sk.contact.title}
        </span>
        {sk.contact.phones.map((p) => (
          <a key={p} className="contact-phone" href={`tel:${p.replace(/\s+/g, '')}`}>
            {p}
          </a>
        ))}
      </section>

      <div className="li-shift-info">
      <NoticeBoard
        notes={data.notes.filter((n) => n.date === date)}
        dayTitle={`${dayWord(sel, date)} ${formatDM(date)}`}
        viewer={viewer}
        now={now}
        busy={noteBusy}
        onAdd={(t) => void addNote(t)}
        onReply={addReply}
        onEdit={(n, t) => void editNote(n, t)}
        onRemove={(n) => void removeNote(n)}
      />

      {/* the day's departures above its arrivals: the departure comes first on a turnover day (Martina, 2026-10-22) */}
      <div className="early-grid">
        <EarlyDepartures
          departures={data.departures.filter((x) => x.date === date)}
          listings={data.listings}
          dayTitle={`${dayWord(sel, date)} ${formatDM(date)}`}
          viewer={viewer}
          now={now}
          busy={departureBusy}
          onAdd={addDeparture}
          onRemove={(x) => void removeDeparture(x)}
        />
        <EarlyArrivals
          arrivals={data.arrivals.filter((a) => a.date === date)}
          listings={data.listings}
          dayTitle={`${dayWord(sel, date)} ${formatDM(date)}`}
          viewer={viewer}
          now={now}
          busy={arrivalBusy}
          onAdd={addArrival}
          onRemove={(a) => void removeArrival(a)}
        />
      </div>

      </div>
      <Summary dayWord={dayWord(sel, date)} hasData={hasData} numbers={numbers} lines={lines} hasJobs={jobs.length > 0} />

      <section className="li-package-controls" aria-label="Výber balíkov">
      <div className="li-package-heading"><div><span className="li-eyebrow">PRACOVNÝ ZOZNAM</span><h2>Balíky na {formatDM(date)}</h2></div><div className="li-package-search"><label className="sr-only" htmlFor="package-search">Hľadať byt podľa názvu</label><input id="package-search" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Hľadať byt…" autoComplete="off"/>{search && <button type="button" onClick={() => setSearch('')}>Zrušiť hľadanie</button>}</div></div>
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

      <p className="li-results-count" role="status">Zobrazené balíky: {list.length}{search.trim() ? ` · hľadanie „${search.trim()}“` : ''}</p>
      </section>
      <main className="jobs" id="jobs">
        {list.map((p) => (
          <PackageCard
            key={p.id}
            p={p}
            cleaner={data.cleaners[p.listing_id] ?? null}
            arrival={arrivalFor(data.arrivals, p)}
            departure={departureFor(data.departures, p)}
            noCapsules={data.noCapsules.includes(p.listing_id)}
            viewer={viewer}
            busy={busy.has(p.id)}
            cheer={cheer?.id === p.id ? cheer.msg : null}
            handlers={handlers}
          />
        ))}
      </main>

      {jobs.length > 0 && list.length === 0 && (
        <div className="state" id="state">
          {!search.trim() && filter === 'todo' && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img className="av2" src={AV} alt="" />
          )}
          <strong>{search.trim() ? 'Pre tento názov sme nenašli balík.' : filter === 'todo' ? sk.empty.allPacked : sk.empty.nothing}</strong>
          {search.trim() ? 'Skús kratší názov alebo zruš hľadanie. Denné súčty zostávajú nezmenené.' : filter === 'todo' ? sk.empty.allPackedHint : sk.empty.nothingHint}
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
