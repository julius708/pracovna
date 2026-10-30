/**
 * Every Slovak string of the app, verbatim from the prototype where one existed.
 * Pure functions only, so the texts are unit-testable.
 */
import { madeBeds } from '../packing/beds';
import { formatDM, formatHM, todayInTz, weekdayShort } from '../packing/dates';
import type { CapsuleLine, PackingResult, WarningCode, Ymd } from '../packing/types';

/* ---------- plurals ---------- */

/** 1 byt, 2–4 byty, 5+ bytov */
export function pluralByt(n: number): string {
  return n === 1 ? 'byt' : n >= 2 && n <= 4 ? 'byty' : 'bytov';
}
/** Pri 1 byte, pri 2+ bytoch */
export function pluralByte(n: number): string {
  return n === 1 ? 'byte' : 'bytoch';
}
/** na 1 osobu, na 2–4 osoby, na 5+ osôb */
export function pluralOsob(n: number): string {
  return n === 1 ? 'osobu' : n >= 2 && n <= 4 ? 'osoby' : 'osôb';
}
/** 1 voľná noc, 2–4 voľné noci, 5+ voľných nocí */
export function pluralNoci(n: number): string {
  return n === 1 ? 'voľná noc' : n >= 2 && n <= 4 ? 'voľné noci' : 'voľných nocí';
}
/** 1 balíček, 2–4 balíčky, 5+ balíčkov */
export function pluralBalicek(n: number): string {
  return n === 1 ? 'balíček' : n >= 2 && n <= 4 ? 'balíčky' : 'balíčkov';
}

/* ---------- static strings ---------- */

export const sk = {
  brand: 'LIVE-IN',
  app: 'Práčovňa',
  syncSource: 'Guesty · Bratislava',
  syncNoData: 'zatiaľ bez dát',
  syncLoading: 'načítavam…',
  syncToday: 'dnes',
  today: 'Dnes',
  tomorrow: 'Zajtra',
  noDataDash: '—',
  angelikaRole: 'Angelika · vedúca práčovne',
  angelikaAlt: 'Angelika, vedúca práčovne',
  summaryRemaining: 'Zostáva pripraviť',
  summaryWholeDay: 'celkom za deň',
  summaryToPrepare: 'Na pripravenie',
  ofTotal: 'z',
  consumablesTitle: 'Spotrebný tovar',
  remainingOf: 'zostáva · z',
  filters: { todo: 'Na balenie', packed: 'Zabalené', all: 'Všetko' },
  cleaners: { all: 'Všetky služby', none: 'Bez služby' },
  pill: { todo: 'Nezabalené', packed: 'Zabalené ✓', cancelled: 'Zrušené' },
  buttons: {
    pack: 'Zabaliť',
    packed: 'Zabalené ✓',
    undo: 'Späť',
    note: 'Poznámka',
    editNote: 'Upraviť poznámku',
    save: 'Uložiť',
    settings: 'Nastavenie',
    saveSettings: 'Uložiť nastavenie',
    close: 'Zavrieť',
    login: 'Prihlásiť sa',
    logout: 'Odhlásiť',
    exportCsv: 'Export CSV',
    syncNow: 'Synchronizovať teraz',
    registerWebhook: 'Zaregistrovať webhook',
  },
  notePlaceholder: 'napr. chýba 1 osuška',
  rushTag: 'Rýchla výmena · príchod v ten istý deň',
  noNextTag: 'Bez ďalšej rezervácie',
  privateBanner: 'Súkromné prádlo – nebaliť z našej bielizne',
  guestyNoteLabel: 'Z Guesty:',
  /** Angelika's facts about the flat (src/core/packing/flats.ts). */
  flatNoteLabel: 'Info o byte:',
  bedsLabel: 'Postele:',
  bedNotNeeded: 'netreba',
  duvetsLabel: 'Paplóny:',
  coffeeLabel: 'Kávovar:',
  checklistTitle: 'Checklist',
  changedAfterPacking: 'Zmenené po zabalení',
  minNightsUnknown: 'min. pobyt neznámy – over kalendár',
  capsuleGeneric: 'Kapsule do kávy',
  capsuleUnsure: 'druh treba upresniť',
  capsuleMissing: 'druh nezadaný v Guesty',
  /** Guesty says "Kapsule: nedávať" for the flat (Martina, 2026-10-19): in red on every card of it. */
  capsulesRefused: 'Kapsule do kávy: NEDÁVAŤ (podľa Guesty)',
  sofaNotNeeded: 'gauč netreba',
  duvetSource: { exact: 'podľa Guesty', facts: 'podľa Angeliky', male: 'malé', velke: 'veľké' },
  cheers: ['Super, ďakujem!', 'Výborne, ďalší hotový!', 'Paráda, len tak ďalej!', 'Skvelá práca!', 'Perfektné!'],
  empty: {
    allPacked: 'Všetko zabalené',
    allPackedHint: 'Na tento deň už nie je čo baliť.',
    nothing: 'Nič tu nie je',
    nothingHint: 'Skús iný filter.',
    noCheckouts: 'Na tento deň nie sú žiadne check-outy.',
    noData: 'Pre tento deň ešte nie sú dáta z Guesty.',
  },
  toasts: {
    saved: 'Nastavenie uložené',
    adminOnly: 'Nastavenie môže meniť len správca.',
    saveFailed: 'Uloženie zlyhalo, skús znova.',
    noPermission: 'Nemáš oprávnenie meniť stav.',
    notSaved: 'Neuložilo sa – skontroluj pripojenie.',
    checkNotSaved: 'Odškrtnutie sa neuložilo.',
    noteSaved: 'Poznámka uložená',
    noteNotSaved: 'Poznámka sa neuložila.',
    savedRecomputeFailed: 'Nastavenie uložené, ale prepočet balíčkov zlyhal – spusti ho na stránke Stav.',
  },
  admin: {
    userUpdated: 'Používateľ upravený',
    conflict: 'Nastavenie medzitým zmenil niekto iný, načítaj znova.',
    selfChange: 'Vlastný účet si nemôžeš deaktivovať ani odobrať rolu správcu.',
    ownAccount: 'vlastný účet',
    serverUnreachable: 'Zlyhalo: server neodpovedá, skús znova.',
  },
  login: {
    wrong: 'Nesprávny e-mail alebo heslo.',
    tooMany: 'Priveľa pokusov, skús o chvíľu.',
    deactivated: 'Účet je deaktivovaný.',
    offline: 'Bez pripojenia.',
    failed: 'Prihlásenie zlyhalo, skús znova.',
    link: 'Odkaz na zmenu hesla je neplatný alebo vypršal. Požiadaj o nový.',
    forgot: 'Zabudnuté heslo?',
    forgotHint: 'Zadaj e-mail a pošleme ti odkaz na nastavenie nového hesla.',
    sendLink: 'Poslať odkaz',
    linkSent: 'Ak účet existuje, odkaz je na ceste do e-mailu. Pozri aj spam.',
    sendFailed: 'Odkaz sa nepodarilo poslať. Napíš Júliusovi.',
    emailRequired: 'Zadaj e-mail.',
    back: 'Späť na prihlásenie',
  },
  /** Fixed contact line above the notice board, on every day (owner, 2026-10-04). */
  contact: {
    title: 'Kontakt – práčovňa Pionierska',
    phones: ['0905 323 799', '0903 821 508'],
  },
  noticeBoard: {
    title: 'Dôležité info',
    empty: 'Pre tento deň zatiaľ nič. Sem napíš, čo majú v tento deň všetci vedieť – uvidia to všetci.',
    placeholder: 'Napíš dôležitú informáciu na tento deň…',
    add: 'Pridať',
    edit: 'Upraviť',
    save: 'Uložiť',
    cancel: 'Zrušiť',
    edited: 'upravené',
    remove: 'Odstrániť',
    by: (name: string, time: string) => `${name} · ${time}`,
    notSaved: 'Info sa neuložilo. Skús znova.',
    notRemoved: 'Info sa nepodarilo odstrániť.',
    notAuthor: 'Odstrániť môže len autor alebo admin.',
    notEdited: 'Úpravu sa nepodarilo uložiť.',
    notAuthorEdit: 'Upraviť môže len autor.',
    /** Replies under a note (Martina, 2026-10-19). */
    reply: 'Odpovedať',
    replyPlaceholder: 'Napíš odpoveď…',
    send: 'Odoslať',
    replyNotSaved: 'Odpoveď sa neuložila. Skús znova.',
    replyParentGone: 'Na toto info sa už nedá odpovedať – bolo odstránené.',
  },
  /** "Skoré príchody": the red box under "Dôležité info", one per day (owner, 2026-10-11); typed in, not from Guesty (Martina, 2026-10-19). */
  earlyArrivals: {
    title: 'Skoré príchody',
    empty: 'Na tento deň nie je zapísaný skorý príchod. Keď hosť príde skôr ako o 16:00, zapíš to sem – uvidia to všetci, aj na karte bytu.',
    flat: 'Byt',
    pickFlat: 'vyber byt…',
    time: 'Príchod o',
    note: 'Poznámka (nepovinná)',
    notePlaceholder: 'napr. hosť má zaplatený skorý check-in',
    open: '＋ Zapísať skorý príchod',
    add: 'Zapísať',
    cancel: 'Zrušiť',
    remove: 'Odstrániť',
    duplicate: 'Skorý príchod pre tento byt je na tento deň už zapísaný.',
    by: (name: string, time: string) => `${name} · ${time}`,
    notSaved: 'Skorý príchod sa neuložil. Skús znova.',
    badTime: 'Zadaj čas príchodu, napr. 12:00.',
    badListing: 'Vyber byt zo zoznamu.',
    badDate: 'Skorý príchod sa dá zapísať len na najbližšie dni.',
    notRemoved: 'Skorý príchod sa nepodarilo odstrániť.',
    notAuthor: 'Odstrániť môže len autor alebo admin.',
    line: (time: string) => `⏰ Skorý príchod o ${time}`,
    cardLine: (time: string) => `⏰ Skorý príchod o ${time} – hosť môže byť v byte skôr`,
  },
  /** "🔔 Upozornenia": push notifications for early arrivals, per device (owner, 2026-10-11). */
  push: {
    off: 'Zapnúť upozornenia',
    on: 'Upozornenia zapnuté',
    offHint: 'Toto zariadenie dostane upozornenie, keď Guesty nahlási skorý príchod.',
    onHint: 'Toto zariadenie dostáva upozornenia na skoré príchody. Klepnutím ich vypneš.',
    enabledHint: 'Hotovo – skoré príchody prídu ako upozornenie.',
    blocked: 'Upozornenia zablokované',
    blockedHint: 'Upozornenia sú v prehliadači zablokované. Povoľ ich v nastaveniach stránky a skús znova.',
    iosShort: 'Upozornenia: pridaj appku na plochu',
    iosHint: 'Na iPhone fungujú upozornenia len z appky na ploche: v Safari klepni na Zdieľať → Pridať na plochu, otvor appku z plochy a zapni upozornenia.',
    failed: 'Upozornenia sa nepodarilo zapnúť. Skús znova.',
  },
  /** "Skoré odchody": the green box next to "Skoré príchody", one per day, typed in (Martina, 2026-10-22). */
  earlyDepartures: {
    title: 'Skoré odchody',
    flat: 'Byt',
    pickFlat: 'vyber byt…',
    time: 'Odchod o',
    note: 'Poznámka (nepovinná)',
    notePlaceholder: 'napr. podľa kamery už odišli',
    open: '＋ Zapísať skorý odchod',
    add: 'Zapísať',
    cancel: 'Zrušiť',
    remove: 'Odstrániť',
    duplicate: 'Skorý odchod pre tento byt je na tento deň už zapísaný.',
    by: (name: string, time: string) => `${name} · ${time}`,
    notSaved: 'Skorý odchod sa neuložil. Skús znova.',
    badTime: 'Zadaj čas odchodu, napr. 09:30.',
    badListing: 'Vyber byt zo zoznamu.',
    badDate: 'Skorý odchod sa dá zapísať len na najbližšie dni.',
    notRemoved: 'Skorý odchod sa nepodarilo odstrániť.',
    notAuthor: 'Odstrániť môže len autor alebo admin.',
    line: (time: string) => `🚪 Skorý odchod o ${time}`,
    cardLine: (time: string) => `🚪 Skorý odchod hostí o ${time} – práčovňa môže ísť skôr`,
  },
  /** "🖨️ Štítok": the flat's name on the X6 Bluetooth label printer (Martina, 2026-10-24). */
  label: {
    button: '🖨️ Štítok',
    printing: 'Tlačím štítok…',
    done: 'Štítok vytlačený ✓',
    noBluetooth: 'Na tlač otvor Práčovňu v appke Bluefy.',
    cancelled: 'Tlačiareň nebola vybraná.',
    showAll: 'Tlačiareň nebola vybraná. Klepni znova – ukážem všetky zariadenia v okolí.',
    notConnected: 'Tlačiareň sa nepripojila – je zapnutá a nablízku? Klepni znova a vyber ju.',
    wrongProtocol: 'Táto tlačiareň nepoužíva protokol X6 (služba AE30) – tlač zastavená. Daj vedieť Martine.',
    failed: 'Štítok sa nepodarilo vytlačiť. Skús znova.',
  },
  /** "Info pre upratovačov": the grey box above the packing section (Martina, 2026-10-30). */
  cleaning: {
    title: 'Info pre upratovačov',
    intro: 'Všetky informácie pre upratovačov na daný deň píšte sem.',
    guestyLabel: 'Stále info z Guesty',
    requestsLabel: 'Na tento deň',
    noRequests: 'Na tento deň zatiaľ nič.',
    placeholder: 'Napíš informáciu pre upratovačov…',
    flat: 'Byt',
    anyFlat: 'bez konkrétneho bytu',
    add: 'Pridať',
    reply: 'Odpovedať',
    replyPlaceholder: 'Napíš odpoveď…',
    send: 'Odoslať',
    cancel: 'Zrušiť',
    remove: 'Odstrániť',
    done: '✓ Vybavené',
    undo: 'Vrátiť',
    doneBy: (who: string, time: string) => `✓ Vybavené · ${who} · ${time}`,
    by: (name: string, time: string) => `${name} · ${time}`,
    notSaved: 'Informácia sa neuložila. Skús znova.',
    replyNotSaved: 'Odpoveď sa neuložila. Skús znova.',
    notDone: 'Zmena sa neuložila. Skús znova.',
    notRemoved: 'Informáciu sa nepodarilo odstrániť.',
    notAuthor: 'Odstrániť môže len autor alebo admin.',
    gone: 'Táto informácia už bola odstránená.',
  },
  notices: {
    newArrival: (name: string, time: string, day: string) => `⏰ Skorý príchod: ${name} o ${time} · ${day}`,
    removedArrival: (name: string, day: string) => `Skorý príchod odstránený: ${name} · ${day}`,
    newNote: (who: string, day: string) => `📌 Nové dôležité info od ${who} · ${day}`,
    editedNote: (who: string, day: string) => `📌 Upravené dôležité info od ${who} · ${day}`,
    newReply: (who: string, day: string) => `💬 Nová odpoveď od ${who} v dôležitom info · ${day}`,
    newPackage: (name: string, day: string) => `Nový balíček z Guesty: ${name} (${day})`,
    packedBy: (who: string, name: string) => `${who} zabalil(a) ${name}`,
    unpacked: (name: string) => `${name} je späť na balenie`,
    changed: (name: string) => `Zmena z Guesty: ${name}`,
    cancelled: (name: string) => `Zrušené z Guesty: ${name}`,
    many: (n: number) => `Zmeny z Guesty: ${n} ${n === 1 ? 'balíček' : n >= 2 && n <= 4 ? 'balíčky' : 'balíčkov'}`,
  },
  recovery: {
    title: 'Nové heslo',
    forAccount: 'Nastavuješ nové heslo pre účet',
    password: 'Nové heslo',
    again: 'Nové heslo znova',
    save: 'Uložiť heslo',
    tooShort: 'Heslo musí mať aspoň 8 znakov.',
    mismatch: 'Heslá sa nezhodujú.',
    same: 'Nové heslo musí byť iné ako doterajšie.',
    invalid: 'Odkaz na zmenu hesla je neplatný alebo vypršal. Požiadaj o nový na prihlasovacej stránke.',
    checking: 'Overujem odkaz…',
    saved: 'Heslo uložené, prihlasujem…',
    failed: 'Heslo sa nepodarilo uložiť, skús znova.',
    toLogin: 'Na prihlásenie',
  },
} as const;

/** Card warnings (red text). */
export const warningText: Record<WarningCode, string> = {
  bunk: 'Poschodová posteľ – over balenie',
  no_duvet_info: 'Typ paplónov nezadaný – over na byte',
  duvets_short: '❓ Paplónov v Guesty je menej, ako treba na pripravené postele – preveriť s Angelikou',
  duvets_exceed_capacity: '❓ Otázka pre Angeliku: v Guesty je viac paplónov, ako je kapacita bytu – koľko baliť?',
  beds_insufficient: 'Postele v Guesty stačia len pre N osôb – over na byte',
  guests_missing: 'Počet hostí nezadaný v Guesty – balíme na max. kapacitu',
  capacity_missing: 'Kapacita nezadaná v Guesty – over na byte',
  bathrooms_missing: 'Počet kúpeľní nezadaný v Guesty – over na byte',
  min_nights_unknown: 'min. pobyt neznámy – over kalendár',
  no_beds: 'Postele nezadané v Guesty – over na byte',
  unknown_bed_type: 'Neznámy typ postele – over na byte',
  capsules_multi: 'viac druhov kapsúl – over počet',
  multi_stay: 'Rezervácia s viacerými bytmi – over',
  double_checkout: '2 check-outy v ten istý deň',
  sheet_size_check: '❓ Veľkosť plachty preveriť s Angelikou (jednolôžko / prístelok – balíme veľkú)',
  separate_beds: 'ℹ️ Odporúčanie: môžeme pripraviť všetky postele, aby mal každý hosť svoju (aplikácia to ráta takto)',
};

/** Warning text for a card; fills in the numbers where the sentence needs them. */
/** "pre 2 hostí" / "pre 1 hosťa" (genitive after "pre") */
function preHosti(n: number): string {
  return n === 1 ? '1 hosťa' : `${n} hostí`;
}
/** "2 postele" / "5 postelí" */
function pluralPostele(n: number): string {
  return n === 1 ? 'posteľ' : n >= 2 && n <= 4 ? 'postele' : 'postelí';
}

export function warningLine(code: WarningCode, r: PackingResult): string {
  if (code === 'separate_beds') {
    const made = r.beds.usedGroups.length;
    return `ℹ️ Odporúčanie: pre ${preHosti(r.people)} môžeme pripraviť ${made === 2 ? 'obidve postele' : `všetky ${made} ${pluralPostele(made)}`}, aby mal každý svoju (aplikácia to ráta takto).`;
  }
  if (code === 'duvets_exceed_capacity' && r.duvetInventory) {
    const { large, small, capacity } = r.duvetInventory;
    const kinds = [large ? `${large} ${large === 1 ? 'veľký' : large <= 4 ? 'veľké' : 'veľkých'}` : '', small ? `${small} ${small === 1 ? 'malý' : small <= 4 ? 'malé' : 'malých'}` : ''].filter(Boolean).join(' + ');
    return `❓ Otázka pre Angeliku: v Guesty je ${kinds} ${large + small === 1 ? 'paplón' : large + small <= 4 ? 'paplóny' : 'paplónov'}, ale kapacita bytu je ${capacity} ${pluralOsob(capacity)} – koľko baliť?`;
  }
  if (code === 'beds_insufficient') {
    const n = r.beds.capacityAll;
    return `Postele v Guesty stačia len pre ${n} ${pluralOsob(n)} – over na byte`;
  }
  return warningText[code];
}

/** Bed type labels for "Postele: 1× king, 1× gauč". */
export const bedLabel: Record<string, string> = {
  KING_BED: 'king',
  QUEEN_BED: 'queen',
  DOUBLE_BED: 'manželská',
  SINGLE_BED: 'jednolôžko',
  BED_140: 'posteľ 140 cm',
  SOFA_BED: 'gauč',
  BUNK_BED: 'poschodová (lôžko)',
  AIR_MATTRESS: 'nafukovací matrac',
  FUTON: 'futon',
  UNKNOWN: 'posteľ',
};

/* ---------- derived texts ---------- */

export function packedOf(done: number, total: number): string {
  return `${done}/${total} zabalené`;
}

/** "Ďalší príchod **št 1.10.**" – the date is bold, as in the prototype. */
export function nextArrivalParts(ymd: Ymd): TextPart[] {
  return [{ text: 'Ďalší príchod ' }, { text: `${weekdayShort(ymd)} ${formatDM(ymd)}`, bold: true }];
}

export function nextArrival(ymd: Ymd): string {
  return plainText(nextArrivalParts(ymd));
}

/** Day tab label: Dnes / Zajtra / weekday. */
export function dayLabel(index: number, ymd: Ymd): string {
  return index === 0 ? sk.today : index === 1 ? sk.tomorrow : weekdayShort(ymd);
}

/** Day word for Angelika's sentence: Dnes / Zajtra / Št. */
export function dayWord(index: number, ymd: Ymd): string {
  if (index === 0) return sk.today;
  if (index === 1) return sk.tomorrow;
  const w = weekdayShort(ymd);
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** "Balíme na **N** osôb (…)" per spec §4 and the prototype; the number is bold. */
export function peopleParts(r: PackingResult): TextPart[] {
  const n = r.people;
  const count: TextPart = { text: String(n), bold: true };
  const osob = ` ${pluralOsob(n)}`;
  if (r.peopleSource === 'same_day') return [{ text: 'Balíme na ' }, count, { text: `${osob} (check-in v ten deň)` }];
  if (r.peopleSource === 'gap' && r.gap) {
    if (r.gap.reason === 'calendar_blocked') {
      return [{ text: 'Balíme na ' }, count, { text: `${osob} (ďalšia rezervácia – medzera je v kalendári blokovaná)` }];
    }
    const g = r.gap.nights;
    return [{ text: 'Balíme na ' }, count, { text: `${osob} (ďalšia rezervácia – ${g} ${pluralNoci(g)}, min. pobyt ${r.gap.minNightsMax ?? '?'} – nič iné sa nezmestí)` }];
  }
  const extra = r.next?.guests ? ` (ďalší hostia: ${r.next.guests})` : '';
  return [{ text: 'Balíme na max. kapacitu ' }, count, { text: `${osob}${extra}` }];
}

export function peopleSentence(r: PackingResult): string {
  return plainText(peopleParts(r));
}

/**
 * Blue banner "👶 Prichádzajúci/Ďalší hostia majú deti: N · batoľatá: N" (spec §4, both
 * counts always, numbers bold); null when the next reservation has no children or infants.
 */
export function childrenBannerParts(r: PackingResult): TextPart[] | null {
  if (!r.next || (!r.next.children && !r.next.infants)) return null;
  const who = r.sameDay ? 'Prichádzajúci hostia' : 'Ďalší hostia';
  return [{ text: `👶 ${who} majú deti: ` }, { text: String(r.next.children), bold: true }, { text: ' · batoľatá: ' }, { text: String(r.next.infants), bold: true }];
}

export function childrenBanner(r: PackingResult): string | null {
  const parts = childrenBannerParts(r);
  return parts ? plainText(parts) : null;
}

/** "1× king, 2× jednolôžko" (regular beds only, as in the prototype). */
/** "z 3" / "zo 4" (Slovak: "zo" before 4, 7, 14, 17, 40…). */
function ofWord(n: number): string {
  return /^[47]/.test(String(n)) ? 'zo' : 'z';
}

/**
 * "2× king (z 3), 1× jednolôžko": the beds to make, with the flat's total when
 * a group is only partly made; beds not made at all are named once at the end
 * ("· 1× jednolôžko netreba"), never as "0× …".
 */
export function bedSummary(r: PackingResult): string {
  const label = (t: string) => bedLabel[t] ?? t.toLowerCase().replace('_bed', '');
  const made = madeBeds(r.beds);
  const parts = made.filter((b) => b.qty > 0).map((b) => `${b.qty}× ${label(b.type)}${b.qty < b.of ? ` (${ofWord(b.of)} ${b.of})` : ''}`);
  const unmade = made.filter((b) => b.qty === 0).map((b) => `${b.of}× ${label(b.type)}`);
  return unmade.length ? `${parts.join(', ')} · ${unmade.join(', ')} ${sk.bedNotNeeded}` : parts.join(', ');
}

/** "rozložiť gauč", "rozložiť gauč ×2", "gauč netreba" or null when the flat has no sofa. */
export function sofaText(r: PackingResult): string | null {
  if (!r.beds.sofasTotal) return null;
  if (!r.beds.sofasUsed) return sk.sofaNotNeeded;
  return r.beds.sofasUsed > 1 ? `rozložiť gauč ×${r.beds.sofasUsed}` : 'rozložiť gauč';
}

/** "podľa Guesty" / "podľa Angeliky" / "malé" / "veľké" or null when no duvet info (warning shows instead). */
export function duvetText(r: PackingResult): string | null {
  if (r.duvetSource === 'default') return null;
  if (r.duvetType === 'exact') return r.duvetSource === 'facts' ? sk.duvetSource.facts : sk.duvetSource.exact;
  return sk.duvetSource[r.duvetType];
}

/** Label and small note of a capsule row. */
export function capsuleLabel(c: CapsuleLine): { label: string; note: string | null } {
  if (c.state === 'missing') return { label: sk.capsuleGeneric, note: sk.capsuleMissing };
  if (c.state === 'unsure') return { label: sk.capsuleGeneric, note: sk.capsuleUnsure };
  return { label: `Kapsule ${c.type}`, note: null };
}

export function packedBy(name: string | null | undefined, hm: string): string {
  return `Zabalil(a) ${name || '—'} · ${hm}`;
}

/** "14:32" today, "so 3.10. 14:32" on other days (Bratislava time). */
export function noteTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const ymd = todayInTz(d);
  const hm = formatHM(d);
  return ymd === todayInTz(now) ? hm : `${weekdayShort(ymd)} ${formatDM(ymd)} ${hm}`;
}

export function cheerDone(name: string): string {
  return `${name} je zabalené.`;
}

/** One segment of Angelika's sentence; `bold` segments are rendered in <b>. */
export interface TextPart {
  text: string;
  bold?: boolean;
}

/** Angelika's dynamic sentence (spec §5). */
export function angelikaSentence(p: {
  dayWord: string;
  hasData: boolean;
  total: number;
  todo: number;
  rush: number;
  kids: number;
}): TextPart[] {
  if (!p.hasData) return [{ text: 'Dáta z Guesty sa ešte načítavajú.' }];
  if (p.total === 0) return [{ text: `${p.dayWord} nie sú žiadne check-outy. Pokojný deň.` }];
  if (p.todo === 0) return [{ text: `${p.dayWord} je všetko zabalené. Výborná práca, ďakujem!` }];
  const parts: TextPart[] = [
    { text: `${p.dayWord} balíme ` },
    { text: `${p.todo} ${pluralByt(p.todo)}`, bold: true },
    { text: ` z ${p.total}.` },
  ];
  if (p.rush) parts.push({ text: ' Rýchle výmeny: ' }, { text: String(p.rush), bold: true }, { text: ', tie majú prednosť.' });
  if (p.kids) parts.push({ text: ` Pri ${p.kids} ${pluralByte(p.kids)} prídu deti.` });
  return parts;
}

export function plainText(parts: TextPart[]): string {
  return parts.map((x) => x.text).join('');
}
