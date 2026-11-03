// Čisté pomocné funkcie Guru widgetu (bez DOM), aby sa dali testovať v Node.

/** Pozícia úst na obrázku postavy (percentá obrázka), rovnaká ako u Adama. Plátno 140x80. */
export const MOUTH = { left: 39.58, top: 30.6, width: 19.44, canvasW: 140, canvasH: 80 }

/** Odpoveď bez markdownu: hviezdičky, mriežky, odrážky, tabuľky a kód preč, text ostane. */
export function stripMarkdown(text) {
  let t = String(text || '')
  t = t.replace(/```[a-z]*\n?([\s\S]*?)```/g, '$1')
  t = t.replace(/`([^`]*)`/g, '$1')
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '')
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1')
  t = t.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1$2').replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1$2')
  t = t.replace(/^\s*[-*•]\s+/gm, '').replace(/^\s*\d+[.)]\s+/gm, (m) => m.trim() + ' ')
  t = t.replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, '')
  t = t.replace(/^\s*\|(.*)\|\s*$/gm, (m, row) => row.split('|').map((c) => c.trim()).filter(Boolean).join(', '))
  t = t.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)')
  t = t.replace(/^\s*>\s?/gm, '')
  t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return t
}

/** Otvorenie [0..1] a šírka [-1..1] úst pre hlásku na pozícii i. Vokály otvárajú, m/b/p zatvárajú. */
const VOW = { a: [0.95, 0.2], 'á': [0.95, 0.2], 'ä': [0.8, 0.3], e: [0.6, 0.7], 'é': [0.55, 0.7], i: [0.32, 1], 'í': [0.3, 1], y: [0.32, 1], 'ý': [0.3, 1], o: [0.75, -0.9], 'ó': [0.75, -0.9], 'ô': [0.7, -0.8], u: [0.45, -1], 'ú': [0.45, -1] }
function isLetter(c) { return c.toLowerCase() !== c.toUpperCase() }
export function visemeFor(chars, i) {
  const c = String(chars[i] || '').toLowerCase()
  if (VOW[c]) return VOW[c]
  if (c === 'm' || c === 'b' || c === 'p') return [0, 0]
  if (c === 'f' || c === 'v') return [0.1, 0.4]
  if (!isLetter(c)) return [0.02, 0]
  for (let k = 1; k <= 3 && i + k < chars.length; k++) { const n = VOW[String(chars[i + k]).toLowerCase()]; if (n) return [Math.max(0.18, n[0] * 0.45), n[1] * 0.6] }
  return [0.2, 0.2]
}

/** Časová os z ElevenLabs alignment → {c: znaky, s: začiatky, e: konce}. Vráti null, ak chýba. */
export function timelineFrom(alignment) {
  const al = alignment
  if (!al || !Array.isArray(al.characters) || !Array.isArray(al.character_start_times_seconds)) return null
  return { c: al.characters, s: al.character_start_times_seconds, e: al.character_end_times_seconds || al.character_start_times_seconds }
}

/** Ústa v čase t (sekundy prehrávania): {o, w, i} kde i je index aktuálneho znaku (-1 pred začiatkom). */
export function visAt(TL, t) {
  const s = TL.s
  let lo = 0, hi = s.length - 1, idx = -1
  while (lo <= hi) { const m = (lo + hi) >> 1; if (s[m] <= t) { idx = m; lo = m + 1 } else hi = m - 1 }
  if (idx < 0 || t > TL.e[idx] + 0.12) return { o: 0, w: 0, i: idx }
  const v = visemeFor(TL.c, idx)
  return { o: v[0], w: v[1], i: idx }
}

/** Udrží postavičku v okne: right/bottom v px podľa rozmerov okna a postavy. */
export function clampPos(r, b, win, el) {
  const cw = el.w || 130, ch = el.h || 200
  return {
    r: Math.max(-cw * 0.35, Math.min(win.w - cw * 0.65, r)),
    b: Math.max(-ch * 0.3, Math.min(win.h - 150, b)),
  }
}

/** Text pre hlas: skratka firmy sa číta „Livin“, dlhé odpovede sa krátia na prvé vety do limitu. */
export function speechText(text, limit = 700) {
  let t = stripMarkdown(text).replace(/LIVE-IN/g, 'Livin').replace(/\s+/g, ' ').trim()
  if (t.length <= limit) return t
  const cut = t.slice(0, limit)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  return (end > limit * 0.5 ? cut.slice(0, end + 1) : cut).trim()
}
