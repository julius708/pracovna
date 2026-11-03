'use client'
import { useEffect, useRef, useState } from 'react'

const HUB = 'https://app.live-in.international'
// Rovnaký zoznam ako dlaždice na domove hlavnej appky (lib/modules.js). Roly podľa app_users.
const APPS = [
  { id: 'home', icon: '🏠', title: 'Domov', desc: 'Prehľad dňa, nástenka, čísla.', url: 'https://app.live-in.international/', roles: ['*'] },
  { id: 'ring', icon: '🔑', title: 'Vstupy hostí', desc: 'Časovo obmedzené odkazy na otvorenie vchodov (Ring) a automatika z Guesty.', url: 'https://app.live-in.international/ring', roles: ['admin', 'operations', 'customer_service', 'assistant'] },
  { id: 'cs', icon: '🎧', title: 'Zákaznícky servis', desc: 'Prehľad zmeny, návrhy odpovedí hosťom, požiadavky a platby.', url: 'https://app.live-in.international/cs', roles: ['admin', 'customer_service', 'assistant'] },
  { id: 'pracovna', icon: '🧼', title: 'Práčovňa', desc: 'Práčovňa a žehliareň: ako to funguje a koľko prádla treba.', url: 'https://app.live-in.international/pracovna', roles: ['*'] },
  { id: 'onboarding', icon: '🏠', title: 'Zaradenie bytov', desc: 'Od zmluvy po prvého hosťa: checklist, Asana, údaje pre listing.', url: 'https://app.live-in.international/zaradenie', roles: ['admin', 'onboarding', 'operations'] },
  { id: 'economy', icon: '💶', title: 'Ekonomika', desc: 'Financie a čísla firmy. Len pre vedenie (adminov).', url: 'https://app.live-in.international/ekonomika/', roles: ['admin'] },
  { id: 'kb', icon: '📚', title: 'Znalostná báza a SOP', desc: 'Postupy, pravidlá a vzory odpovedí pre celý tím.', url: 'https://app.live-in.international/kb', roles: ['*'] },
  { id: 'volne', icon: '🏨', title: 'Voľné apartmány', desc: 'Náš rezervačný portál: čo je voľné, ceny a fotky. Keď hosť hľadá iný termín alebo byt s parkovaním.', url: 'https://booking.live-in.international/en/properties', roles: ['*'] },
  { id: 'ideas', icon: '💡', title: 'Nápady na obsah', desc: 'Zapíš situáciu z dňa za pár sekúnd. Marketing z nej spraví krátke video.', url: 'https://app.live-in.international/napady', roles: ['*'] },
  { id: 'testy', icon: '🧭', title: 'Testy osobnosti', desc: 'DISC, Big Five, 16 typov, tímové roly, pracovný štýl a hodnoty. Spoznaj svoj štýl a kolegov.', url: 'https://app.live-in.international/testy', roles: ['*'] },
  { id: 'guru', icon: '🧠', title: 'LIVE-IN Guru', desc: 'Opýtaj sa na byty, rezervácie, Práčovňu a nástenku. Odpovedá podľa tvojich oprávnení.', url: 'https://app.live-in.international/guru', roles: ['*'] },
  { id: 'admin', icon: '⚙️', title: 'Správa appky', desc: 'Ľudia, ich roly a adresy modulov.', url: 'https://app.live-in.international/admin/users', roles: ['admin'] },
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
