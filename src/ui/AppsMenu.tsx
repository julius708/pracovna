'use client'
import { useEffect, useRef, useState } from 'react'

const HUB = 'https://app.live-in.international'
// Rovnaký zoznam ako dlaždice na domove hlavnej appky (lib/modules.js). Roly podľa app_users.
const APPS = [
  { id: 'home', icon: '🏠', title: 'Domov', desc: 'Prehľad dňa, nástenka, čísla.', url: HUB + '/', roles: ['*'] },
  { id: 'cs', icon: '🎧', title: 'Zákaznícky servis', desc: 'Prehľad zmeny, byty, voľné byty, rezervácie.', url: HUB + '/cs', roles: ['admin', 'customer_service', 'assistant'] },
  { id: 'ring', icon: '🔑', title: 'Vstupy hostí', desc: 'Odkazy na otvorenie vchodov (Ring).', url: HUB + '/ring', roles: ['admin', 'operations', 'customer_service', 'assistant'] },
  { id: 'pracovna', icon: '🧼', title: 'Práčovňa', desc: 'Tašky, prádlo a plán prania.', url: HUB + '/pracovna', roles: ['*'] },
  { id: 'onboarding', icon: '🏡', title: 'Zaradenie bytov', desc: 'Checklist, Asana, dizajn, nákup.', url: HUB + '/zaradenie', roles: ['admin', 'onboarding', 'operations'] },
  { id: 'kb', icon: '📚', title: 'Znalostná báza a SOP', desc: 'Postupy, mapy problémov, FAQ.', url: HUB + '/kb', roles: ['*'] },
  { id: 'ideas', icon: '💡', title: 'Nápady na obsah', desc: 'Situácie z dňa pre krátke videá.', url: HUB + '/napady', roles: ['*'] },
  { id: 'guru', icon: '🧠', title: 'LIVE-IN Guru', desc: 'Opýtaj sa na byty, postupy, čísla.', url: HUB + '/guru', roles: ['*'] },
  { id: 'economy', icon: '💶', title: 'Ekonomika', desc: 'Výnosy a čísla firmy (vedenie).', url: HUB + '/ekonomika/', roles: ['admin'] },
  { id: 'admin', icon: '⚙️', title: 'Správa appky', desc: 'Ľudia, roly a adresy modulov.', url: HUB + '/admin/users', roles: ['admin'] },
]

/** Menu aplikácií v hlavičke: `roles` z app_users (ak nie sú známe, skryjú sa len časti pre vedenie). */
export default function AppsMenu({ current, roles }: { current: string; roles: string[] | null }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDoc); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])
  const apps = APPS.filter((a) => a.roles.includes('*') || (Array.isArray(roles) ? a.roles.some((r) => roles.includes(r)) : !(a.roles.length === 1 && a.roles[0] === 'admin')))
  return (
    <div className={`appsmenu${open ? ' open' : ''}`} ref={ref}>
      <button type="button" className="am-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="am-grid" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /><i /></span><span className="am-lb">Aplikácie</span>
      </button>
      {open && (
        <div className="am-panel" role="menu" aria-label="Aplikácie LIVE-IN">
          <div className="am-head">Tvoje aplikácie</div>
          <div className="am-list">
            {apps.map((a) => (
              <a key={a.id} href={a.url} role="menuitem" className={`am-item${current === a.id ? ' on' : ''}`} onClick={() => setOpen(false)}>
                <span className="am-ic" aria-hidden="true">{a.icon}</span>
                <span className="am-tx"><b>{a.title}</b><small>{a.desc}</small></span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
