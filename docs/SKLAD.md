# Sklad v appke: návrh, migračný plán, preview

Zadanie z 17. 11. 2026 („LIVE-IN | Sklad v appke“). Tento dokument je určený na review. **Nič z toho nie je nasadené do produkcie ani do produkčnej databázy.**

## 1. Čo je hotové, čo je len návrh, čo je nasadené

| Oblasť | Stav |
|---|---|
| Doménové pravidlá (`src/core/stock`): prepočet balení s „Neoverené“, plán výdaja zo snapshotu, kniha pohybov a stav, uzávierka inventúry, návrh objednávky, predpoveď, mesačný prehľad | **Hotové a otestované** (37 testov) |
| Migrácia `supabase/migrations/0021_sklad.sql`: tabuľky, RLS, RPC, výdaj pri zabalení, Späť bez vrátenia, inventúra, objednávky | **Hotové, otestované na PGlite (32 testov) a od 18. 11. 2026 aplikované v produkčnej DB** (odpočty vypnuté) |
| Obrazovky `/sklad` (Stav, Inventúra, Pohyby, Spotreba, Objednávky, Katalóg a nastavenie), tlačový list A4, CSV | **Hotové**, overené v ukážkovom režime (bez DB) |
| Návrat migrácie `supabase/rollback/0021_sklad_rollback.sql` | **Hotové a otestované** |
| Skutočné odosielanie objednávok dodávateľovi (e-mail/API) | **Len návrh.** Je export CSV a pripravený e-mail; objednávka ostáva „NEODOSLANÉ“, kým ju oprávnená osoba neoznačí. |
| Vylúčenie opráv a blokácií z predpovede | **Len návrh.** Zatiaľ ručné pole „Vyradené byty“. |
| PDF inventúrneho listu | Tlačový list A4 (`/sklad/inventura/<id>/tlac`), PDF sa uloží z tlače prehliadača. Samostatný generátor PDF nie je. |
| Odkaz „Sklad“ v menu | Skrytý, kým nie je `NEXT_PUBLIC_SKLAD_NAV=1`. Stránky fungujú na `/pracovna/sklad` pre správcov aj bez neho. |
| Nasadenie | Aplikovaná je len DB migrácia (odpočty vypnuté). Kód obrazoviek je na vetve `feature/sklad`, `main` je nedotknutý. |

## 2. Ako to funguje

### Výdaj pri zabalení
- `pack_package` (0011) sa rozšíril: po zápise udalosti `packed` v **tej istej transakcii** zavolá `stock_issue_for_package` so snapshotom z udalosti (`package_events.data`), nie s prepočítanými potrebami. Karta sa po zabalení môže prepočítať, výdaj ostáva podľa snapshotu.
- **Raz a len raz.** Každý fyzický výdaj má `unique_key` (`pkg:<id udalosti>:<karta>`), jedinečný index ho vynúti. Opakovanie rovnakej akcie (`client_action_id`), dvojklik a druhé zariadenie končia na „already_packed“ ešte pred výdajom (zámok riadku balíka); aj priame opakovanie výdaja pre tú istú udalosť je bez účinku.
- **Chyba skladu nezablokuje balenie hostí** (predvolené): ide do frontu `stock_issue_errors`, správca ju v Stave zopakuje (`stock_retry_issue`, idempotentne). Ak chceš prísnu atomicitu (chyba skladu zruší aj zabalenie), nastav `stock_config.strict_atomic = true`.
- Nenamapované riadky (karta bez priradenia, kapsule bez určeného druhu, neznámy kávový systém) sa **nehádajú**: idú do `stock_unmapped_issues` na kontrolu. Kávové systémy sú oddelené karty (Nespresso Original, Vertuo, Tchibo Cafissimo, L'OR Tassimo). Priradenie je podľa presného `typeKey`, takže varianty typu „nespresso original (malé)“ treba priradiť osobitne.
- Záporný stav sa zobrazí a nič neblokuje.
- Posteľná bielizeň je požičaná: výdaj je presun (čistá → byty, ak existuje sklad druhu „zabalené v bytoch“), nie spotreba a nikdy nejde do návrhu objednávky ani do prehľadu spotreby.

### Späť nie je fyzické vrátenie
- Každé zabalenie otvorí **dávku výdaja** (`stock_issue_batches`). `unpack_package` len prepne dávku do `return_pending` a vytvorí nezrovnalosť. Sklad sa nemení.
- Znovu zabalené bez vrátenia: rovnaká požiadavka = žiadny druhý výdaj; vydá sa len **doplnenie** (väčšia potreba). Menšia potreba nezmení stav, ide do nezrovnalostí ako prebytok.
- Skutočné vrátenie potvrdí `stock_confirm_return` (pohyb `return`), dávka sa uzavrie a ďalšie zabalenie otvorí nový cyklus. „Tovar ostal v byte“ uzavrie správca s dôvodom (`stock_resolve_discrepancy`). Nič sa nemaže ani neprepisuje (kniha pohybov je append-only, zmeny len novým pohybom).

### Začiatočný stav a zapnutie odpočtov
- Odpočty sú v `stock_config.deduction_enabled = false`. Zapnúť ich ide **len po schválenej inventúre** (`stock_set_deduction` odmietne bez baseline), nie k dátumu.
- Stav = súčet pohybov od začiatočného stavu (`opening_balance`). Pohyby pred ním sa nikdy nepočítajú.
- Pri zapnutí sa **raz** doplnia balenia zabalené po čase uzávierky inventúry, ktoré sú dnes zabalené a nemajú dávku (`stock_backfill_since_baseline`, idempotentné). Balenia pred uzávierkou ani vrátené cez Späť sa nedotknú. Prípadné balenie, ktoré prebiehalo presne pri zapnutí, sa doplní ďalším zapnutím alebo ručným spustením.

### Inventúra
- Dátum určuje správca. Riadok = celé balenia, voľné kusy, polica, zdroj, poznámka, osoba a čas. Súčet = balenia × kusov v balení + voľné kusy; balenie bez overeného prepočtu = riadok „Neoverené“ a uzávierku zablokuje.
- Prázdne pole **nie je** nula (riadok ostane „nespočítané“, bez pohybu). Nula sa potvrdzuje osobitne („overená nula“) a zapíše sa ako stav 0.
- Uzávierka k presnému času: spočítané sa porovná s očakávaným stavom k tomuto času a rozdiel sa zapíše ako auditovaný pohyb `inventory_difference`; prvé spočítanie položky je `opening_balance`. Čas uzávierky nesmie byť v budúcnosti ani skôr ako predošlá uzávierka skladu. Ručný pohyb s časom pred uzávierkou sa zapíše na čas uzávierky (pôvodný čas ostáva v poznámke).
- Tlačový list A4 a CSV sú na detaile inventúry.

### Objednávky
- Návrh: `max(0, potreba do dodávky + rezerva − použiteľná zásoba − potvrdený príjem)`, zaokrúhlené nahor na **overené** nákupné balenia (príp. kartóny) a minimálnu objednávku. Príklad zo zadania: 476 + 60 − 150 = 386 → 20 balení po 20 ks. Server prepočíta návrh sám (`stock_units_for`, testovaný proti TypeScriptu); iný počet než návrh vyžaduje dôvod.
- Ponuka dodávateľa nie je záväzná a je **verzovaná podľa platnosti**; riadok objednávky si pamätá balenie z času objednania, takže neskoršia zmena balenia nezmení príjem.
- Stavy: návrh → kontrola → schválenie (oprávnená osoba) → odoslanie → potvrdenie dodávateľa → čiastočný/úplný príjem. Export a pripravený e-mail neznamenajú odoslané. Odoslanie sa označuje samostatne; opakovanie nikdy nevytvorí druhú objednávku; nejasný výsledok (`ambiguous`) sa uzavrie overením. Sklad rastie až pri potvrdenom fyzickom príjme.
- Predpoveď: známa potreba z potvrdených rezervácií cez ten istý výpočet balenia; ďalší predaj ako scenár nízky/stredný/vysoký = (dostupné noci aktívnych bytov × obsadenosť) / priemerná dĺžka pobytu − už potvrdené pobyty (nikdy sa nepočítajú dvakrát). Koeficienty na pobyt sa kalibrujú z výdajov po odpočítaní vrátení, vždy s obdobím a veľkosťou vzorky; pod 20 pobytov je hodnota „málo dát“, nie 0. Týždeň sa nenásobí štyrmi. Obsadenosť 40/60/80 % je len **predpoklad na úpravu**, nie meranie.

### Oprávnenia (vynútené v DB, nielen v UI)
| Kto | Smie |
|---|---|
| Personál (aktívny profil) | zabaliť/vrátiť Späť (ako doteraz), zapísať ručný výdaj, výdaj do bytu, poškodenie, vrátenie, potvrdiť vrátenie dávky; vidí katalóg, **nevidí** stavy ani pohyby |
| Správca (`profiles.role = admin`, koordinátor) | všetko okrem schvaľovania: inventúra, katalóg, príjem, presuny, návrh a kontrola objednávok, uzavretie nezrovnalostí |
| Schvaľovateľ | správca zo zoznamu `stock_config.order_approvers` (prázdny zoznam = každý správca): schváli objednávku a inventúru, označí odoslanie, zapne odpočty |
Používajú sa existujúce roly; nová rola sa nezavádza. Audit (`stock_audit`, udalosti objednávok, pohyby) neobsahuje kódy ani heslá.

## 3. Migračný plán (nasadenie až po schválení)
1. **Review** vetvy `feature/sklad` a tohto dokumentu. Preview vetvy ukáže stránky s bannerom „Sklad ešte nie je zapnutý v databáze“ a ukážkovými dátami.
2. **Aplikovať `0021_sklad.sql`** v produkčnej DB (po súhlase). Je aditívna; po aplikácii sú odpočty vypnuté, takže prevádzka sa nemení. Jediná zmena existujúceho správania je interná: `pack_package`/`unpack_package` pri každom zabalení prečítajú `stock_config` a pri vypnutých odpočtoch nič nerobia. Prevádzka počas nasadenia beží (migrácia nezamyká tabuľky balenia dlhšie než jedno `create or replace function`).
3. **Skontrolovať** zabalenie a Späť na stagingu a v prvý deň v produkcii (nesmie sa nič zmeniť).
4. Správca: „Katalóg a nastavenie“ → základné karty (bez čísel) → sklady → ponuky s overeným balením a zdrojom → priradenia kávových systémov a ďalších riadkov. Nastaviť schvaľovateľov.
5. **Počiatočná inventúra** (dátum určí Július), uzavrieť v presnom čase, **schváliť** = začiatočný stav.
6. **Zapnúť odpočty** (tlačidlo je dostupné až po kroku 5). Sleduj Stav: nenamapované riadky, nezrovnalosti, chyby výdaja.
7. Až keď sú dáta čisté a je vzorka ≥ 20 pobytov, dávať dôveru predpovedi; dovtedy sa objednáva zo známej potreby.
8. Zobraziť „Sklad“ v menu (`NEXT_PUBLIC_SKLAD_NAV=1`).

**Návrat:** krok A v `supabase/rollback/0021_sklad_rollback.sql` vypne odpočty a vráti `pack_package`/`unpack_package` na verzie z 0011/0006 (sklad ostane nedotknutý). Krok B (zmazanie skladových objektov) je deštruktívny a v súbore je zakomentovaný.

## 4. Testy (zhoda so zoznamom v zadaní)
- `tests/unit/stock/*` (37): neznáme balenie, rôzne kávové systémy, otvorené/voľné kusy a súčet inventúry, zmena balenia dodávateľa v čase, nulový/chýbajúci stav, záporný stav, čiastočné dodávky, minimum a kartóny, časový rez inventúry, predpoveď bez dvojitého započítania a bez ×4, kalibrácia s malou vzorkou, mesačný prehľad bez osôb.
- `tests/blackbox3/sklad-pglite.test.ts` (32, celá reťaz migrácií 0001–0021 na PGlite): retry a dvojklik/druhé zariadenie pri Zabalené, Späť bez vrátenia a nový výdaj, potvrdené vrátenie a nový cyklus, zmena požiadavky po zabalení, výmena bytov (výdaj patrí bytu z času zabalenia), nenamapované riadky, SQL plán = TypeScript plán, chyba skladu neblokuje balenie a idempotentný retry, voliteľná prísna atomicita, spätné doplnenie bez dvojitého odpočtu, uzávierka inventúry k času, ručné pohyby, oprávnenia a RLS, objednávky (príklad 476/386/20, dôvod zmeny, nejasné odoslanie, idempotencia, čiastočný a úplný príjem, zmena balenia), SQL výpočet balení = TypeScript, návrat migrácie.
- Čo test **neoveruje**: skutočne súbežné transakcie z viacerých pripojení (PGlite má jedno pripojenie). Ochranu tvorí zámok riadku balíka (`for update`) a jedinečné kľúče; odporúča sa pred zapnutím skúška dvoma zariadeniami na stagingu.
- Pozn.: `tests/blackbox3/db-pglite.test.ts > run_retention` padá aj na čistom `main` (nesúvisí so skladom).

## 5. Otvorené otázky pre majiteľa
1. Kto je koordinátor a kto je schvaľovateľ objednávok? (Teraz každý správca; zoznam schvaľovateľov sa nastavuje v „Katalóg a nastavenie“.)
2. Má personál vidieť stav zásob (teraz nie, vidí len katalóg a zapíše pohyb)?
3. Chceš prísnu atomicitu (`strict_atomic`), alebo nech chyba skladu nikdy nezablokuje balenie hostí (predvolené)?
4. Skutočné odosielanie objednávok: akého dodávateľa a akým kanálom (e-mail s prílohou, API)? Dovtedy je to export a pripravený e-mail.
5. Zdroj blokácií a opráv bytov pre predpoveď (kalendár Guesty), aby sa pole „Vyradené byty“ nahradilo automatikou.
