'use client'
// LIVE-IN Guru ako živý asistent na každej stránke (rovnaký typ widgetu ako Adam na webe):
// malá postavička dole, po kliknutí čitateľné okno, dá sa presúvať a zbaliť. Hlas ElevenLabs
// s pohybom úst podľa hlások; keď hlas nie je nastavený, číta prehliadač. Žiadne skákanie.
import { useEffect, useRef, useState } from 'react'
import { MOUTH, stripMarkdown, visAt, timelineFrom, clampPos } from '@/lib/guru-widget-core'

// Otázky a pozdrav podľa appky, v ktorej Guru práve je (rovnaký widget vo všetkých appkách, iný obsah).
const APP_GURU = {
  home: { hello: 'Ahoj, som LIVE-IN Guru. Opýtaj sa ma na byty, rezervácie alebo postupy.', chips: ['Čo dnes potrebuje moju pozornosť?', 'Koľko máme dnes príchodov a odchodov?', 'Aký je kód od dverí na byte…', 'Ako riešime neskorý check-in?', 'Napíš hosťovi odpoveď na sťažnosť na hluk'] },
  pracovna: { hello: 'Ahoj, som Guru. V Práčovni ti poradím s taškami, prádlom a kto čo balil.', chips: ['Koľko tašiek sa dnes balí a na koľko osôb?', 'Ktoré byty majú zajtra odchod aj príchod v jeden deň?', 'Ako sa počíta prádlo pre byt s deťmi?', 'Čo dať do tašky navyše pri dlhšom pobyte?', 'Kto včera balil tašky a bolo niečo zrušené?'] },
  ring: { hello: 'Ahoj, som Guru. Pomôžem s odkazmi pre hostí a vstupmi do budov.', chips: ['Ako vytvorím odkaz pre hosťa a čo mu napísať?', 'Ktoré budovy majú Ring offline?', 'Hosť nevie otvoriť dvere – čo skontrolovať?', 'Ako dlho platí odkaz a ako ho zruším?', 'Napíš hosťovi správu k vstupu do budovy'] },
  cs: { hello: 'Ahoj, som Guru. Pomôžem so zmenou, hosťami a odpoveďami.', chips: ['Čo dnes potrebuje moju pozornosť?', 'Koľko máme dnes príchodov a odchodov?', 'Ktoré byty sú dnes voľné?', 'Napíš hosťovi odpoveď na sťažnosť na hluk', 'Ako riešime neskorý check-in?'] },
  kb: { hello: 'Ahoj, som Guru. Nájdem ti SOP, mapu problémov alebo odpoveď pre hosťa.', chips: ['Nájdi SOP k odovzdaniu bytu', 'Čo robiť, keď hosť nahlási poruchu kúrenia?', 'Aká je odpoveď na otázku o city tax?', 'Ktoré SOP čakajú na kontrolu?', 'Zhrň mapu problémov pre stratené kľúče'] },
  onboarding: { hello: 'Ahoj, som Guru. Pomôžem so zaradením nového bytu od zmluvy po prvého hosťa.', chips: ['Čo všetko treba pred spustením nového bytu?', 'Ktoré byty v zaraďovaní meškajú?', 'Čo napísať do listingu pre byt s parkovaním?', 'Ako nastaviť byt v Guesty a PriceLabs?', 'Checklist pre fotenie bytu'] },
  economy: { hello: 'Ahoj, som Guru. Pomôžem s číslami a výkonom bytov.', chips: ['Ktoré byty mali minulý mesiac najvyšší výnos?', 'Aká je obsadenosť v Bratislave a v Košiciach?', 'Koľko sme zarobili cez Booking a Airbnb?', 'Ktoré byty majú slabý výkon a prečo?', 'Zhrň mesiac pre vedenie'] },
  testy: { hello: 'Ahoj, som Guru. Opýtaj sa, čo znamená tvoj výsledok alebo ako spolupracovať s kolegom.', chips: ['Čo znamená môj DISC výsledok v práci?', 'Ako komunikovať s kolegom, ktorý má vysokú Dominanciu?', 'Ktorý test mám vyplniť ako ďalší?', 'Čo dnes potrebuje moju pozornosť?'] },
}
const GREETING = 'Ahoj, som LIVE-IN Guru. Opýtaj sa na byty, rezervácie, kódy, postupy alebo čokoľvek iné. Môžeš aj hovoriť.'
const ERR = 'Prepáč, teraz sa mi nepodarilo odpovedať. Skús to o chvíľu znova.'
// Skutočné snímky úst z postavy (vygenerované z guru-v3.png), prelínajú sa podľa hlások. Región v % obrázka.
const VIS = ['e', 'ah', 'oh', 'ee']
const VIS_BOX = { left: 30.5, top: 28.5, width: 39 }
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='

function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v) } catch {} return null }
function sstore(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v) } catch {} return null }
function uuid() { try { return crypto.randomUUID() } catch { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16) }) } }
function b64blob(b64) { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: 'audio/mpeg' }) }

const ICON_ON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></svg>
const ICON_OFF = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M17 9l5 6M22 9l-5 6" /></svg>

const greet = () => { const h = Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Bratislava', hour: '2-digit', hour12: false })); return h < 5 ? 'Dobrú noc' : h < 10 ? 'Dobré ráno' : h < 18 ? 'Dobrý deň' : 'Dobrý večer' }

export default function GuruWidget({ name = '', app = 'home', hub = '' }) {
  const API = (hub || '').replace(/\/$/, '')
  const CFG = APP_GURU[app] || APP_GURU.home
  const CHIPS = CFG.chips, HELLO = CFG.hello
  const first = (name || '').split(' ')[0]
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState([])           // {id, role:'u'|'a', text, words?, shown?}
  const [busy, setBusy] = useState(false)
  const [muted, setMuted] = useState(false)
  const [hello, setHello] = useState(false)
  const [fact, setFact] = useState('')          // zaujímavosť dňa: Guru ju povie sám pri otvorení appky, raz za deň
  const [imgOk, setImgOk] = useState(true)
  const [q, setQ] = useState('')
  const [rec, setRec] = useState(false)
  const [pos, setPos] = useState({ r: 22, b: 14 })
  const [mobile, setMobile] = useState(false)

  const hostRef = useRef(null), figRef = useRef(null), cvRef = useRef(null), jawRef = useRef(null), nodRef = useRef(null)
  const visRefs = useRef({}), visW = useRef({ e: 0, ah: 0, oh: 0, ee: 0 })
  const [sprites, setSprites] = useState(true), msgsRef = useRef(null), inputRef = useRef(null)
  const audio = useRef(null), TL = useRef(null), speaking = useRef(false), sim = useRef(false), mouth = useRef({ o: 0, w: 0 })
  const primed = useRef(false), greeted = useRef(false), revealId = useRef(null), recRef = useRef(null), mountedRef = useRef(false)

  /* ---------- štart ---------- */
  useEffect(() => {
    mountedRef.current = true
    const m = () => window.innerWidth < 700
    setMobile(m())
    let saved = null
    try { saved = JSON.parse(store('guru-pos') || 'null') } catch {}
    const base = saved && typeof saved.r === 'number' ? saved : (m() ? { r: 8, b: 78 } : { r: 22, b: 14 })
    setPos(clampPos(base.r, base.b, { w: window.innerWidth, h: window.innerHeight }, { w: 130, h: 200 }))
    const onResize = () => { setMobile(m()); setPos((p) => clampPos(p.r, p.b, { w: window.innerWidth, h: window.innerHeight }, { w: 130, h: 200 })) }
    window.addEventListener('resize', onResize)
    const t = setTimeout(() => { if (!sstore('guru-hello')) { sstore('guru-hello', '1'); setHello(true); setTimeout(() => setHello(false), 9000) } }, 1500)
    // pri každom otvorení appky (nový príchod alebo po 30 min): Guru pozdraví menom a povie novú zaujímavosť, bez otvorenia chatu
    const factTimer = setTimeout(async () => {
      const last = Number(store('guru-fact-at') || 0)
      if (Date.now() - last < 30 * 60 * 1000) return
      store('guru-fact-at', String(Date.now()))
      try {
        const r = await fetch(`${API}/api/guru/fact`, { cache: 'no-store', credentials: 'include' }); const j = await r.json()
        if (!r.ok || !j.ok || !j.text || !mountedRef.current) { store('guru-fact-at', '0'); return }
        setHello(false); setFact(j.text)
        tellFact(j.text)
      } catch { store('guru-fact-at', '0') }
    }, 2500)
    const A = new Audio(); A.preload = 'auto'; A.playsInline = true; audio.current = A
    return () => { mountedRef.current = false; window.removeEventListener('resize', onResize); clearTimeout(t); clearTimeout(factTimer); try { A.pause() } catch {} try { speechSynthesis.cancel() } catch {} }
  }, [])

  /* ---------- ústa: kreslenie v slučke, plynulé (lerp), bez trasenia ---------- */
  const lastIdx = useRef(-1)
  useEffect(() => {
    let raf
    const loop = () => {
      const cv = cvRef.current
      if (cv) {
        const g = cv.getContext('2d')
        let tO = 0, tW = 0
        if (speaking.current) {
          if (!sim.current && TL.current && audio.current) {
            const v = visAt(TL.current, audio.current.currentTime); tO = v.o; tW = v.w
            if (v.i >= 0 && v.i !== lastIdx.current && revealId.current) { lastIdx.current = v.i; reveal(revealId.current, (v.i + 2) / TL.current.c.length) }
          } else {
            const t = performance.now() / 1000; tO = 0.25 + 0.4 * Math.abs(Math.sin(t * 11)) * (0.55 + 0.45 * Math.sin(t * 3.1))
          }
        }
        if (window.__guruForce) { tO = window.__guruForce.o; tW = window.__guruForce.w || 0 }
        // plynulé dobiehanie: otváranie rýchlejšie než zatváranie, bez trasenia
        const m = mouth.current
        m.o += (tO - m.o) * (tO > m.o ? 0.22 : 0.16)
        m.w += (tW - m.w) * 0.14
        if (sprites && visRefs.current.ah) {
          // cieľové váhy snímok: otvorenie rozhoduje o sile, šírka o tvare (oh ↔ ee)
          // výraznejšie otváranie (viditeľné aj pri malej postave), strop pri „á“ 0.85, aby to nevyzeralo ako zívanie
          const o = Math.max(0, Math.min(1, (m.o - 0.03) / 0.5)), w = m.w
          const t = { e: 0, ah: 0, oh: 0, ee: 0 }
          if (o > 0) {
            if (w < -0.35) { t.oh = Math.min(0.95, o * 1.2); t.e = (1 - o) * 0.3 }
            else if (w > 0.35) { t.ee = Math.min(0.8, o); t.e = (1 - o) * 0.4 }
            else if (o < 0.35) { t.e = Math.min(1, o * 2.6) }
            else { t.e = Math.max(0, 1.5 - o * 1.8); t.ah = Math.min(0.85, (o - 0.35) / 0.45) }
          }
          const v = visW.current
          for (const k of VIS) { v[k] += (t[k] - v[k]) * 0.45; const el = visRefs.current[k]; if (el) el.style.opacity = v[k].toFixed(3) }
          g.clearRect(0, 0, MOUTH.canvasW, MOUTH.canvasH)
          if (jawRef.current) jawRef.current.style.transform = `translateY(${(m.o * 0.5).toFixed(2)}%)`
        } else {
          drawMouth(g, m.o, m.w)
          if (jawRef.current) jawRef.current.style.transform = `translateY(${(m.o * 1.6).toFixed(2)}%)`
        }
        // živá hlava: pomalé kolísanie, pri reči o niečo výraznejšie, bez trasenia
        if (nodRef.current) {
          // hlava takmer nehybná: len nepatrné dýchanie, pri reči sa nehýbe celá postava
          const t = performance.now() / 1000
          nodRef.current.style.transform = `translateY(${(Math.sin(t * 0.8) * 0.4).toFixed(2)}px)`
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  function drawMouth(g, o, w) {
    const W = MOUTH.canvasW, H = MOUTH.canvasH
    g.clearRect(0, 0, W, H)
    if (o < 0.04) return
    // otvorenie medzi perami: začína na línii pier (y≈27 v plátne) a rastie dole spolu s bradou
    const open = Math.min(1, o), cx = W / 2, top = 26, hw = 22 + 6 * w, h = 2.5 + open * 17
    g.save()
    g.globalCompositeOperation = 'multiply'
    g.globalAlpha = Math.min(1, (o - 0.04) * 6)
    g.filter = 'blur(1.4px)'
    const cy = top + h / 2
    const gr = g.createRadialGradient(cx, cy, 1, cx, cy, hw)
    gr.addColorStop(0, 'rgba(34,12,12,1)'); gr.addColorStop(0.7, 'rgba(66,24,24,0.95)'); gr.addColorStop(1, 'rgba(120,70,60,0)')
    g.fillStyle = gr
    g.beginPath(); g.ellipse(cx, cy, hw, h / 2, 0, 0, Math.PI * 2); g.fill()
    g.restore()
    if (open > 0.45) {
      // náznak horných zubov tesne pod hornou perou, veľmi jemný
      g.save(); g.globalAlpha = (open - 0.45) * 0.45; g.filter = 'blur(0.7px)'; g.fillStyle = '#efe6dc'
      g.beginPath(); g.ellipse(cx, top + 2.2, hw * 0.42, 1.8, 0, 0, Math.PI * 2); g.fill(); g.restore()
    }
  }

  /* ---------- správy ---------- */
  function scrollEnd() { const el = msgsRef.current; if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight }) }
  const lastReveal = useRef({ id: null, n: -1 })
  function reveal(id, ratio) {
    setMsgs((old) => {
      const i = old.findIndex((m) => m.id === id && m.words)
      if (i < 0) return old
      const m = old[i], n = Math.ceil(m.words.length * Math.min(1, ratio))
      if (n === m.shown) return old
      lastReveal.current = { id, n }
      const next = old.slice(); next[i] = { ...m, shown: n }; return next
    })
  }
  function addGuru(text) {
    const id = uuid(), words = text.split(/\s+/).filter(Boolean)
    setMsgs((old) => [...old.filter((m) => !m.thinking), { id, role: 'a', text, words, shown: words.length }])
    revealId.current = id
    scrollEnd()
    return id
  }

  /* ---------- zvuk ---------- */
  function unlock() { if (primed.current) return; primed.current = true; try { const A = audio.current; A.src = SILENT; const p = A.play(); if (p && p.catch) p.catch(() => {}) } catch {} }
  function stopSpeech(showAll) {
    speaking.current = false; sim.current = false
    try { audio.current && audio.current.pause() } catch {}
    try { speechSynthesis.cancel() } catch {}
    if (showAll && revealId.current) reveal(revealId.current, 1)
  }
  function playAudio(url) {
    return new Promise((res, rej) => {
      const A = audio.current
      A.onended = () => { speaking.current = false; if (revealId.current) reveal(revealId.current, 1); res() }
      A.onerror = () => { speaking.current = false; rej(new Error('audio')) }
      A.src = url; sim.current = false
      const p = A.play()
      if (p && p.then) p.then(() => { speaking.current = true }, (e) => { speaking.current = false; rej(e) }); else speaking.current = true
    })
  }
  function speechFallback(text) {
    return new Promise((res) => {
      if (!('speechSynthesis' in window)) { if (revealId.current) reveal(revealId.current, 1); return res() }
      const u = new SpeechSynthesisUtterance(text.replace(/LIVE-IN/g, 'Livin')); u.lang = 'sk-SK'; u.rate = 1.02
      u.onboundary = (e) => { if (e.charIndex != null && revealId.current) reveal(revealId.current, e.charIndex / text.length + 0.04) }
      u.onend = u.onerror = () => { speaking.current = false; sim.current = false; if (revealId.current) reveal(revealId.current, 1); res() }
      sim.current = true; speaking.current = true; speechSynthesis.speak(u)
    })
  }
  // Zvuk bez kliknutia prehliadač nepustí: keď je prehrávanie zablokované, hlas čaká na prvé kliknutie alebo klávesu kdekoľvek na stránke.
  const pending = useRef(null)
  function armOnInteraction() {
    if (pending.current?.armed) return
    pending.current = { ...(pending.current || {}), armed: true }
    const go = () => {
      window.removeEventListener('pointerdown', go, true); window.removeEventListener('keydown', go, true)
      const p = pending.current; pending.current = null
      if (!p || !p.url || muted) return
      unlock(); TL.current = p.tl; sim.current = false
      playAudio(p.url).catch(() => {})
    }
    window.addEventListener('pointerdown', go, true); window.addEventListener('keydown', go, true)
  }
  async function speak(text, queueIfBlocked = false) {
    if (muted) { if (revealId.current) reveal(revealId.current, 1); return }
    let url = null, tl = null
    try {
      const r = await fetch(`${API}/api/guru/tts`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
      if (!r.ok) throw new Error('tts ' + r.status)
      const j = await r.json()
      if (!j.ok || !j.audio) throw new Error('tts')
      tl = timelineFrom(j.alignment); url = URL.createObjectURL(b64blob(j.audio))
    } catch { url = null }
    if (url) {
      try { TL.current = tl; await playAudio(url); return } catch (e) {
        if (queueIfBlocked) { pending.current = { url, tl }; armOnInteraction(); sim.current = true; speaking.current = true; return }
      }
    }
    TL.current = null; await speechFallback(text)
  }

  /* ---------- zaujímavosť dňa: ústa sa hýbu aj bez zvuku (prehliadač bez kliknutia zvuk nepustí) ---------- */
  const factTimer2 = useRef(null)
  function tellFact(text) {
    const secs = Math.min(20, 3 + text.split(/\s+/).length * 0.42)
    sim.current = true; speaking.current = true
    clearTimeout(factTimer2.current)
    factTimer2.current = setTimeout(() => { if (sim.current) { speaking.current = false; sim.current = false } }, secs * 1000)
    setTimeout(() => setFact((f) => (f === text ? '' : f)), Math.max(14000, secs * 1000 + 5000))
    // skutočný hlas: hneď, ak to prehliadač dovolí, inak po prvom kliknutí
    speak(`${greet()}${first ? ', ' + first : ''}. ${text}`, true)
  }

  /* ---------- chat ---------- */
  async function ask(text) {
    const question = (text || '').trim()
    if (!question || busy) return
    unlock(); stopSpeech(true)
    setBusy(true); setQ('')
    setMsgs((old) => [...old, { id: uuid(), role: 'u', text: question }, { id: 'think', role: 'a', thinking: true }])
    scrollEnd()
    let reply
    try {
      const r = await fetch(`${API}/api/guru`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, turnId: uuid(), mode: 'widget', app }), signal: AbortSignal.timeout(70000) })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'chat')
      reply = stripMarkdown(j.text || '').trim() || ERR
    } catch (e) { reply = e && e.name === 'TimeoutError' ? 'Odpoveď trvá pridlho. Skús otázku položiť znova alebo ju rozdeľ.' : e && e.message && /prihlás|uložen|nedostupn|krokov/i.test(e.message) ? e.message : ERR }
    if (!mountedRef.current) return
    addGuru(reply)
    setBusy(false)
    await speak(reply)
  }

  function openWin() {
    unlock(); setHello(false); setOpen(true); store('guru-open', '1')
    if (!greeted.current) {
      greeted.current = true
      const id = addGuru(GREETING)
      if (!sstore('guru-g')) { sstore('guru-g', '1'); speak(GREETING) } else reveal(id, 1)
    }
    if (!mobile) setTimeout(() => inputRef.current && inputRef.current.focus(), 80)
  }
  function closeWin() { stopSpeech(true); setOpen(false); store('guru-open', '0') }

  /* ---------- ťahanie malej postavy ---------- */
  const drag = useRef({ down: false, moved: 0, sx: 0, sy: 0, r0: 0, b0: 0 })
  function onDown(e) {
    if (open) return
    const d = drag.current; d.down = true; d.moved = 0; d.sx = e.clientX; d.sy = e.clientY; d.r0 = pos.r; d.b0 = pos.b
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
  }
  function onMove(e) {
    const d = drag.current; if (!d.down) return
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy
    d.moved = Math.max(d.moved, Math.abs(dx) + Math.abs(dy))
    if (d.moved > 5) setPos(clampPos(d.r0 - dx, d.b0 - dy, { w: window.innerWidth, h: window.innerHeight }, { w: 130, h: 200 }))
  }
  function onUp() {
    const d = drag.current; if (!d.down) return; d.down = false
    if (d.moved > 5) { store('guru-pos', JSON.stringify(pos)); return }
    openWin()
  }

  /* ---------- mikrofón: nahrávka → prepis na serveri (ElevenLabs), záloha rozpoznávanie v prehliadači ---------- */
  const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null
  const canRecord = typeof window !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder)
  const micOk = canRecord || !!SR
  const recorder = useRef(null), chunks = useRef([]), recTimer = useRef(null)
  function note(text) { setMsgs((old) => [...old.filter((m) => !m.thinking), { id: uuid(), role: 'a', text }]); scrollEnd() }
  async function transcribe(blob) {
    const fd = new FormData(); fd.append('audio', blob, blob.type.includes('mp4') ? 'audio.mp4' : 'audio.webm')
    const r = await fetch(`${API}/api/guru/stt`, { method: 'POST', credentials: 'include', body: fd, signal: AbortSignal.timeout(30000) })
    const j = await r.json().catch(() => ({}))
    if (r.status === 503) throw new Error('nokey')
    if (!r.ok || !j.ok) throw new Error('stt')
    return (j.text || '').trim()
  }
  function stopRecording() { try { recorder.current && recorder.current.state !== 'inactive' && recorder.current.stop() } catch {} }
  async function mic() {
    unlock()
    if (rec) { if (recorder.current) stopRecording(); else if (recRef.current) { try { recRef.current.stop() } catch {} } return }
    stopSpeech(true)
    if (canRecord) {
      let stream
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) }
      catch (e) { note(e && e.name === 'NotAllowedError' ? 'Prehliadač blokuje mikrofón. Povoľ ho v nastaveniach stránky (ikona zámku pri adrese) a skús znova.' : 'Mikrofón sa nepodarilo spustiť. Skontroluj, či ho nepoužíva iná aplikácia.'); return }
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) => window.MediaRecorder.isTypeSupported(m)) || ''
      let mr
      try { mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined) } catch { stream.getTracks().forEach((t) => t.stop()); note('Nahrávanie v tomto prehliadači nejde. Napíš otázku, prosím.'); return }
      chunks.current = []; recorder.current = mr; setRec(true); setQ('')
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.current.push(e.data) }
      mr.onstop = async () => {
        clearTimeout(recTimer.current); setRec(false); recorder.current = null
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunks.current, { type: mr.mimeType || mime || 'audio/webm' })
        if (blob.size < 800) { note('Nič som nepočul. Klikni na mikrofón, povedz otázku a klikni znova.'); return }
        setQ('Prepisujem…')
        try {
          const text = await transcribe(blob)
          setQ('')
          if (!text) { note('Nerozumel som. Skús to povedať ešte raz, bližšie k mikrofónu.'); return }
          setQ(text); ask(text)
        } catch (e) {
          setQ('')
          if (e && e.message === 'nokey') note('Prepis hlasu ešte nie je zapnutý (chýba kľúč ElevenLabs). Napíš otázku, prosím.')
          else note('Prepis hlasu teraz zlyhal. Skús znova alebo napíš otázku.')
        }
      }
      mr.start()
      recTimer.current = setTimeout(stopRecording, 20000) // najviac 20 s na jednu otázku
      return
    }
    if (!SR) return
    const r = new SR(); r.lang = 'sk-SK'; r.interimResults = false; r.maxAlternatives = 1
    recRef.current = r; setRec(true)
    let done = false
    const finish = () => { done = true; setRec(false); recRef.current = null; clearTimeout(watchdog) }
    const watchdog = setTimeout(() => { if (!done) { try { r.abort() } catch {} finish() } }, 12000)
    r.onresult = (e) => { const t = e.results[0][0].transcript; finish(); setQ(t); ask(t) }
    r.onerror = (e) => { finish(); note(e && e.error === 'not-allowed' ? 'Prehliadač blokuje mikrofón. Povoľ ho v nastaveniach stránky.' : 'Rozpoznávanie reči zlyhalo. Napíš otázku, prosím.') }
    r.onend = () => finish()
    try { r.start() } catch { finish() }
  }

  const figure = (
    <div className={'gw-fig' + (open ? ' in' : '')} ref={figRef} title={open ? undefined : 'Klikni a opýtaj sa LIVE-IN Guru · chyť a presuň'}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onClick={() => { if (open && speaking.current) stopSpeech(true) }}>
      <div className="gw-bob"><div className="gw-nod" ref={nodRef}>
        {imgOk ? <img src={`${API}/guru-v3.png`} alt="LIVE-IN Guru" draggable="false" onError={() => setImgOk(false)} /> : <div className="gw-fallback" aria-hidden="true">🧠</div>}
        {imgOk && <img className="gw-jaw" src={`${API}/guru-v3.png`} alt="" aria-hidden="true" draggable="false" ref={jawRef} />}
        {imgOk && sprites && VIS.map((k) => <img key={k} className="gw-vis" src={`${API}/guru-mouth/${k}.png`} alt="" aria-hidden="true" draggable="false" ref={(el) => { visRefs.current[k] = el }} onError={() => setSprites(false)} style={{ left: VIS_BOX.left + '%', top: VIS_BOX.top + '%', width: VIS_BOX.width + '%' }} />)}
        {imgOk && <canvas className="gw-mouth" width={MOUTH.canvasW} height={MOUTH.canvasH} ref={cvRef} style={{ left: MOUTH.left + '%', top: MOUTH.top + '%', width: MOUTH.width + '%' }} />}
      </div></div>
    </div>
  )

  return (
    <>
      {!open && (
        <div className="gw-host" ref={hostRef} style={{ right: pos.r, bottom: pos.b }}>
          <div className="gw-col">
            <button type="button" className={'gw-hello' + (fact ? ' fact show' : hello ? ' show' : '')} onClick={() => { if (fact) { const f = fact; setFact(''); speaking.current = false; sim.current = false; openWin(); setTimeout(() => addGuru(`${greet()}${first ? ', ' + first : ''}! ${f}`), 50) } else openWin() }}>{fact ? <><b>{greet()}{first ? `, ${first}` : ''} 👋</b>{fact}</> : HELLO}</button>
            {figure}
            <button type="button" className="gw-pill" onClick={openWin}>Opýtať sa LIVE-IN Guru</button>
          </div>
        </div>
      )}
      {open && (
        <div className="gw-win" role="dialog" aria-label="Chat s LIVE-IN Guru" onKeyDown={(e) => { if (e.key === 'Escape') closeWin() }}>
          <div className="gw-head">
            {figure}
            <div className="gw-ht"><b>LIVE-IN Guru</b><span>Interný asistent tímu{first ? ` · ${first}` : ''}</span></div>
            <div className="gw-hb">
              <button type="button" className="gw-ib" aria-label={muted ? 'Zapnúť hlas' : 'Vypnúť hlas'} onClick={() => { const m = !muted; setMuted(m); if (m) stopSpeech(true) }}>{muted ? ICON_OFF : ICON_ON}</button>
              <button type="button" className="gw-ib" aria-label="Zbaliť" onClick={closeWin}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 9l6 6 6-6" /></svg></button>
            </div>
          </div>
          <div className="gw-msgs" ref={msgsRef} aria-live="polite">
            {msgs.map((m) => m.thinking
              ? <div key={m.id} className="gw-m a"><span className="gw-dots"><i /><i /><i /></span></div>
              : <div key={m.id} className={'gw-m ' + m.role}>{m.words ? m.words.map((w, i) => <span key={i} className={'gw-w' + (i < (m.shown ?? m.words.length) ? '' : ' off')}>{w}{i < m.words.length - 1 ? ' ' : ''}</span>) : m.text}</div>)}
          </div>
          <div className={'gw-chips' + (msgs.length > 1 ? ' row' : '')}>
            {CHIPS.map((c) => <button key={c} type="button" className="gw-chip" disabled={busy} onClick={() => ask(c)}>{c}</button>)}
          </div>
          <form className="gw-form" autoComplete="off" onSubmit={(e) => { e.preventDefault(); ask(q) }}>
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} maxLength={4000} placeholder={rec ? 'Počúvam… klikni na mikrofón, keď dopovieš' : 'Napíš alebo povedz…'} aria-label="Tvoja otázka" />
            {micOk && <button type="button" className={'gw-ib' + (rec ? ' rec' : '')} aria-label={rec ? 'Zastaviť a odoslať' : 'Hovoriť'} title={rec ? 'Klikni, keď dopovieš' : 'Klikni a hovor, potom klikni znova'} onClick={mic}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg></button>}
            <button type="submit" className="gw-ib send" aria-label="Odoslať" disabled={busy}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></button>
          </form>
          <div className="gw-foot">Len pre tím LIVE-IN. Celá história a nastavenia: <a href={`${API}/guru`}>stránka Guru</a>.</div>
        </div>
      )}
    </>
  )
}
