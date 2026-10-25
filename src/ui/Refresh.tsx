'use client';
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

const THRESHOLD = 76
const AUTO_MS = 5 * 60 * 1000

/**
 * Potiahnutie nadol obnoví dáta stránky (ako v iOS appkách) a každých 5 minút sa stránka
 * obnoví sama, keď je karta viditeľná. Obnovuje sa cez router.refresh(), bez reloadu a bez straty scrollu.
 */
export default function PullToRefresh() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [pull, setPull] = useState(0)
  const [armed, setArmed] = useState(false)
  const startY = useRef<number | null>(null)
  const active = useRef(false)

  const refresh = () => start(() => router.refresh())

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      if (window.scrollY > 2 || e.touches.length !== 1) return
      startY.current = e.touches[0].clientY; active.current = true
    }
    const onMove = (e: TouchEvent) => {
      if (!active.current || startY.current == null) return
      const dy = e.touches[0].clientY - startY.current
      if (dy <= 0 || window.scrollY > 2) { setPull(0); setArmed(false); return }
      const eased = Math.min(130, dy * 0.55)
      setPull(eased); setArmed(eased >= THRESHOLD)
      if (eased > 10 && e.cancelable) e.preventDefault()
    }
    const onEnd = () => {
      if (!active.current) return
      active.current = false; startY.current = null
      if (armed) refresh()
      setPull(0); setArmed(false)
    }
    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd); document.addEventListener('touchcancel', onEnd)
    return () => { document.removeEventListener('touchstart', onStart); document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onEnd); document.removeEventListener('touchcancel', onEnd) }
  }, [armed])

  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') refresh() }, AUTO_MS)
    const onVis = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [])

  const show = pull > 8 || pending
  return (
    <div className={`ptr${show ? ' show' : ''}${pending ? ' busy' : ''}`} style={{ transform: `translate(-50%, ${pending ? 18 : Math.max(-56, pull - 56)}px)` }} aria-live="polite" aria-hidden={!show}>
      <span className="ptr-ic" style={{ transform: `rotate(${pending ? 0 : Math.min(360, pull * 4)}deg)` }}>⟳</span>
      <span>{pending ? 'Obnovujem…' : armed ? 'Pusti na obnovenie' : 'Potiahni na obnovenie'}</span>
    </div>
  )
}

/** Tlačidlo Obnoviť pre počítač (bez dotyku). */
export function RefreshButton() {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <button type="button" className={`li-refresh${pending ? ' busy' : ''}`} onClick={() => start(() => router.refresh())} aria-label="Obnoviť dáta" title="Obnoviť dáta">
      <span aria-hidden="true">⟳</span>
    </button>
  )
}
