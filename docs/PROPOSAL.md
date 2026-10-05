# LIVE-IN Práčovňa – Step 1 proposal (architecture, data model, screens)

Status: waiting for Julius's OK · 2026-09-29 · Spec: `Pracovna_Claude_Code_prompt.md` · Reference prototype: `reference/`

Where the spec and the prototype disagree, the spec wins. Everything below that is not in the spec is either a default I chose (section 9, "tell me if wrong") or a question for you (section 10).

---

## 1. What will be built

A Slovak, phone-first website for the laundry team. Every Bratislava apartment with a check-out today, tomorrow or the day after gets a card with exactly what to pack. Staff tap **Zabaliť**; every open device updates within a second; every action is kept forever. Guesty changes arrive within seconds through webhooks and are re-checked every 3 minutes by a scheduled job. All packing rules live in one pure, unit-tested calculation module.

## 2. Architecture

| Part | Runs where | Does |
|---|---|---|
| Next.js 16 (App Router, TypeScript, Tailwind v4) | Vercel, region Frankfurt (`fra1`) | screens, webhook receiver, cron routes, `/health`, CSV export |
| Supabase (Postgres, Auth, Realtime) | Frankfurt (`eu-central-1`) | database of record, login, live updates |
| `src/core/packing` – pure TypeScript | server only | laundry-field parser, scope rules, people/beds/linen/consumables/capsules calculator; 100 % unit-tested, no imports of Next, Supabase or Guesty |
| `src/guesty` client | server only | token cache, rate-limit backoff, typed endpoints, fake client for seed mode |
| Vercel Cron | production deployment | `*/3 * * * *` reconcile, `0 2 * * *` (UTC) nightly cleanup |
| Free uptime monitor on `/health` | external | e-mails you when sync fails twice in a row |

```
Guesty ──webhook (signed)──► POST /api/guesty/webhook ─► verify → store → 200 (<1 s)
                                                          └─► re-fetch object → save → recompute window
Vercel Cron */3 ──► GET /api/cron/reconcile ─► lock → token → listings (hourly) → check-outs D0..D2
                                                → next check-ins → calendar min-nights → recompute window → run log
Postgres trigger ──► Realtime broadcast "board" ──► every open device re-reads its 3-day board
Staff tap Zabaliť ──► RPC pack_package() ─► audit row + broadcast ─► all devices
```

**Where numbers come from.** `computePackage(input)` is deterministic: listing snapshot (beds, capacity, bathrooms, parsed laundry field) + outgoing reservation + next reservation + min-nights for the gap days + settings → people, badges, items, warnings. The result is stored in `packages.computed_items`. Screens only render and sum; they never calculate.

**One convergence function.** `recomputeWindow()` recomputes all packages of the 3-day window from database state (about 70 rows, milliseconds). *Revised 2026-10-03: the board shows 7 days (today..today+6, about 150 rows); migration 0010 widens the staff window to match.* Webhooks, the cron, a settings save and the nightly job all call it. Writes are change-only, so nothing flickers on the tablets when nothing changed.

**Package identity.** One package per outgoing Guesty reservation id. It follows the reservation if the check-out date moves. Two check-outs of one flat on one day give two cards plus a warning „2 check-outy v ten istý deň“.

## 3. Repo layout

```
app/                (auth)/login · (board)/page.tsx · nastavenia/ · historia/ (+export.csv) · stav/ · health/route.ts
                    api/guesty/webhook · api/cron/{reconcile,nightly} · api/admin/{sync-now,settings,webhooks/register}
public/assets/      live-in-logo.png, angelika.jpg, kapsula-*.png (copied from reference/assets)
src/core/packing/   parser.ts, scope.ts, people.ts, beds.ts, linen.ts, consumables.ts, capsules.ts, calculator.ts, dates.ts, types.ts
src/core/i18n/sk.ts every Slovak string, verbatim from the prototype
src/guesty/         client.ts, token.ts, endpoints/{listings,reservations,calendar,customFields,spaces,webhooks}.ts, fake-client.ts, fixtures/
src/sync/           reconcile.ts, listings.ts, minNights.ts, recompute.ts, webhook-handler.ts, nightly.ts, lock.ts, alerts.ts
src/db/             server.ts, browser.ts, admin.ts (service role, server only), rpc.ts, types.ts (generated)
src/ui/             Header, DayTabs, Angelika, Summary, Filters, PackageCard, NoteEditor, SettingsTable, HistoryTable
supabase/           config.toml, migrations/*.sql, seed.sql
scripts/            guesty-probe.ts, seed.ts, send-test-webhook.ts
tests/              unit/ (packing) · integration/ (guesty client, webhook) · db/ (policies, RPCs)
README.md, .env.example, vercel.json
```

Versions (npm, 2026-09-29): Next 16.3, React 19.3, Tailwind 4.3, Vitest 5, supabase-js 2.117, @supabase/ssr 0.12, svix, zod. Node 22, pnpm.

## 4. Data model

Follows the spec's suggestion (§6) with `users` renamed to `profiles` (Supabase convention) and three operational tables added. Full DDL sketch in Appendix A.

| Table | Holds | Staff see | Admin see |
|---|---|---|---|
| `profiles` | name, role `staff`/`admin`, active flag; created automatically on first login | names | all, can edit |
| `listings` | Guesty snapshot: name, city, active, beds, bathrooms, capacity, tags, raw + parsed laundry field, cleaner, in-scope flag + exclusion reason | in-scope rows | all |
| `reservations` | ids, status, localized dates, guest counts (adults/children/infants), confirmation code, source; never guest names | – | all |
| `calendar_min_nights` | min nights + calendar status per listing and gap day | – | all |
| `packages` | one per outgoing reservation: computed part (date, listing, people, items, warnings, hash) + staff part (status, note, checklist, packed by/at) | yesterday…day+2 | all |
| `package_events` | audit log, insert-only, kept forever | – | all, CSV |
| `settings` (+ `settings_history`) | linen table, consumables, duvet type per flat, global checklist; versioned | read | write |
| `sync_runs`, `webhook_events`, `guesty_tokens`, `sync_locks` | operations | – | runs + events (tokens: nobody) |

**Status/note/checklist are never overwritten by sync – two layers.** Logged-in users have no direct write access to `packages`; the only write paths are four RPC functions (`pack_package`, `unpack_package`, `set_note`, `toggle_check`), each writing one audit row in the same transaction. The sync writes through one function, `upsert_package_computed`, whose column list contains only computed columns; a unit test asserts it never includes a staff column. A small database trigger refuses any other update to the staff columns.

**Bratislava time everywhere.** `today_ba()` = `(now() at time zone 'Europe/Bratislava')::date` is used in the visibility policy, in the board query and in the cron, so the third tab is never empty for staff between midnight and 02:00 (when UTC is still "yesterday").

**Realtime.** A database trigger broadcasts a tiny message on a private topic `board` whenever a package or a setting changes. Each device subscribes once and re-reads its 3-day board (≤ 75 rows) through one RPC, debounced 250 ms; also on reconnect, on tablet wake, and at local midnight. Volume is a few hundred messages a day, far inside the free tier.

**Retention (nightly).** `sync_runs` 30 days, `webhook_events` 90 days, `calendar_min_nights` from yesterday on, reservations with check-out older than 60 days that no package references. Kept forever: packages, package_events, settings_history, profiles.

## 5. Guesty integration

Base `https://open-api.guesty.com/v1`, bearer token. All facts below were verified in the Guesty Open API docs on 2026-09-29; two shapes remain to be confirmed with one live probe on day 1 (marked *probe*).

**Token.** `POST /oauth2/token` (form-encoded, `grant_type=client_credentials&scope=open-api`); tokens live 24 h and Guesty allows **only 5 tokens per 24 h per client id**. One cached token in `guesty_tokens`, shared by all server instances, refreshed 30 min before expiry under a single-flight lock, one reactive refresh on 401, hard cap of 3 mints per 24 h with an alert at the 3rd. Only the server mints; my probe script reuses a git-ignored local token file.

**Rate limits.** 15 req/s, 120/min, 5 000/h per account; >15 concurrent → 429. Client: one request at a time per job; 429 → sleep `Retry-After`; 5xx → retry after 1 s and 3 s. Budget: reconcile ≈ 8–30 calls per run, listings ≈ 110/h, together under 15 % of the hourly limit.

**Reconcile every 3 minutes** (`GET /api/cron/reconcile`, Bearer `CRON_SECRET`, 4-minute lease lock so overlapping runs skip):
1. Listings, at most hourly: `GET /listings` paged by `limit=100&skip`, fields `_id nickname title active isListed address.city accommodates bedrooms bathrooms beds tags customFields listingRooms`. Beds from `listingRooms[].beds[]` (*probe*: undocumented but present in the reference export; fallback Spaces API `GET /properties/spaces/unit-type/{id}`), bathrooms from the listing (fallback Spaces `bathrooms`), laundry field inline (fallback `GET /properties-api/custom-fields/{id}`). A run that would drop more than 5 in-scope listings is not applied and raises an alert.
2. Check-outs: `GET /reservations-v3/search?filter[checkOut][gte]=D0&filter[checkOut][lte]=D2&filter[status]=confirmed&sort=checkOut&limit=100`, paged until `hasMore=false`. Uses `stay[]` for listing, localized dates, `guestsCount`, `numberOfGuests`.
3. Next check-ins: per chunk of ≤ 20 listing ids, `filter[listingId]=…&filter[checkIn][gte]=D0&filter[status]=confirmed&sort=checkIn`, **paged by `hasMore` until every listing in the chunk has its first hit** (so a lightly booked flat is never hidden behind busy ones). *Probe*: whether `filter[listingId]` accepts a list.
4. Absence check: reservations we hold as confirmed but did not see → `GET /reservations-v3?reservationIds=` (≤ 10 per call). Non-confirmed status → cancel the package; not found on two consecutive runs → treated as deleted; transient error → untouched.
5. Min-nights: one `GET /availability-pricing/api/calendar/listings?listingIds=…&startDate&endDate` call for listings whose package has a gap of 1–14 nights; per day `minNights`, `status`, `cta`. Unknown days → pack for capacity + muted note „min. pobyt neznámy – over kalendár“. PriceLabs `min_stay` (verified today via your PriceLabs connector, keyed by Guesty listing id) is the fallback, switched on only when you give me a PriceLabs API key.
6. `recomputeWindow()`; write `sync_runs`; on failure increment `consecutive_failures`, alert at 2.

**Webhooks.** Registered once from the admin Stav page: `POST /webhooks` with events `reservation.created.v2`, `reservation.updated.v2`, `listing.new`, `listing.updated`, `listing.removed`; then `GET /webhooks-v2/secret?url=…` for the signing secret (pasted into Vercel). Guesty signs with Svix; the handler verifies the signature (5-minute tolerance), stores the event (`svix-id` + `meta.eventId` unique → duplicates are no-ops), answers 200 immediately, then in the background **re-fetches the reservation by id** (payloads are never trusted; a cancellation arrives as `reservation.updated.v2` with status `canceled`) and recomputes. Guesty retries a failed delivery 8 times over ~28 h; anything still missed is caught by the 3-minute reconcile.

**Nightly (02:00 UTC).** Retention, full listing refresh, webhook health (our URL must still be listed and a webhook must have arrived in the last 24 h on a day with changes), recompute for the new day.

**Scope rules** (in `scope.ts`, unit-tested): city contains „bratislava“ (diacritics-insensitive), nickname not `KE:`/`TT:` (case-insensitive), `active = true`, not owner-cleans. Owner-cleans = laundry field contains one of the four spec phrases (diacritics-insensitive), or a Guesty tag normalising to „upratuje majiteľ“, or one of the 5 hard-coded ids. A listing that leaves scope cancels its open packages.

**Seed mode.** `SEED_MODE=true` swaps in a fake Guesty client with the 107 real listing shapes and generated reservations covering every rule (same-day, gaps 1–2 nights with min-nights 1/2, no next, private linen, missing/„upresniť“/„nedávať“ capsules, bunk, 1.5 and 2 bathrooms, exact duvets, overrides, two check-outs on one day). Refused when `APP_ENV=production`.

## 6. Packing rules – how the spec is implemented

Everything in spec §4 is implemented exactly; the default linen table is loaded by `seed.sql` (the prototype's defaults are identical to the spec table). Points the spec leaves open are resolved as follows.

| Area | Implementation |
|---|---|
| Duvet precedence | Guesty exact counts (missing line = 0, absolute) → `Paplóny: malé/veľké` line → Settings „Paplóny podľa bytu“ → large + „Typ paplónov nezadaný – over na byte“ |
| Bed types | KING/QUEEN/DOUBLE = double for 2; SINGLE = 1; BUNK = 2 singles + warning; SOFA_BED = conditional 2 („rozložiť gauč ×N“ / „gauč netreba“); AIR_MATTRESS/FUTON = conditional like a sofa; CRIB/TODDLER_BED = ignored; any other = double + „Neznámy typ postele – over na byte“ |
| Edge cases | no beds → one double + warning; beds (incl. sofas) < people → „Postele v Guesty stačia len pre N osôb – over na byte“; capacity missing → bed capacity + warning; same-day check-in with 0 guests → capacity + red „Počet hostí nezadaný v Guesty – balíme na max. kapacitu“; bathrooms unknown → 1 + warning |
| Gap sentence | shows the max `minNights` over the gap; plurals 1 „voľná noc“, 2–4 „voľné noci“, 5+ „voľných nocí“; 1 „osobu“, 2–4 „osoby“, 5+ „osôb“ |
| Capsules | line split on `;`/`,`; count = first integer, type = rest; „nedávať/žiadne/nie/bez/0“ → no row; „upresniť“ → row + red „druh treba upresniť“; no line → row + red „druh nezadaný v Guesty“; totals per type after normalising case, diacritics and apostrophes; photos by substring `cafissimo`, `l'or`, `nespresso original` (longest match first) |
| Per-item overrides | `sync.py` aliases kept (`predložky`, `osušky`, `uteráky` …); value = first integer („2 (+1 rezerva)“ → 2, not 21) |
| Laundry field | matched by field id `6ab385c5bcf98e0011a9419d`, fallback: field name contains „pracovn“; `Poznámka:` and unknown lines → grey box „Z Guesty: …“, separate from the staff note |
| Cancellation | never packed → package hidden; packed → stays grey with „Zrušené“, no buttons, only under „Všetko“, excluded from X/Y, tiles and Angelika's numbers; re-confirmed → restored with its old status; inputs changed after packing → amber „Zmenené po zabalení“ |
| Stale header | red 30 minutes after the last successful reconcile (spec), not 26 h (prototype) |
| Sorting | alphabetical, Slovak collation, not-packed first (spec) – see Q7 |

## 7. Screens

Slovak only, strings verbatim from the prototype. Brand tokens from the prototype `:root` (verified: `--brand #FF7F00`, buttons `#E06A00` with white text, logo `#3A3A3A`, full dark set) go into Tailwind `@theme`; dark mode follows the device; fonts Bricolage Grotesque + Figtree via `next/font`; assets served from `/assets/`. At 375 px: one column, 16 px gutters, no horizontal scroll, tap targets ≥ 44 px, primary button 52 px full width.

| Route | Who | Contents |
|---|---|---|
| `/login` | public | e-mail + password, „Prihlásiť sa“, error texts, no self-signup |
| `/` board | staff, admin | **Header**: house mark, „LIVE-IN“, „Práčovňa“; „Guesty · Bratislava“ + last sync („dnes 06:02“), red after 30 min; name + „Odhlásiť“. **Day tabs** „Dnes / Zajtra / št 1.10.“ with „X/Y zabalené“ + progress bar. **Angelika** block with the dynamic sentence (plurals byt/byty/bytov; all packed → „… je všetko zabalené. Výborná práca, ďakujem!“; no check-outs → „Pokojný deň.“). **Summary** tiles (big orange remaining, label, „z N“) and the „Spotrebný tovar“ box „zostáva · z“ with capsule photos. **Filters** „Na balenie / Zabalené / Všetko“ with counts, optional cleaning-company row. Empty states from the prototype. |
| card | – | **todo**: light red, red border, pill „Nezabalené“, buttons „Zabaliť“ + „Poznámka“. **packed**: whole card green, disabled „Zabalené ✓“, pill „Zabalené ✓“, „Späť“, footer „Zabalil(a) Meno · 09:41“, checklist locked. **Just packed** (acting device): Angelika box above the buttons, big photo with wiggle, random praise + „<byt> je zabalené.“, 3.5 s, static under reduced motion; card stays in place in „Na balenie“ until the filter or day changes. **cancelled**: grey „Zrušené“. Content order as in spec §5: name, badges, banners (children, purple private linen), Guesty note, linen rows with the number in a box, consumables box, bed line, duvet source, coffee machine, checklist, staff note. |
| `/nastavenia` | admin | linen table (columns „Položka · rozmer · Manželská · Jednolôžko · Gauč · Na hosťa · Na kúpeľňu · Na byt“; toilet paper shown read-only with its rule), „Paplóny podľa bytu“ dropdowns with „(Guesty: …)“ hints, „Checklist na každý byt“, users (name, role, active), read-only list of excluded flats with reasons. Save = version check + server-side recompute + toast „Nastavenie uložené · prepočítané N balíčkov“. |
| `/historia` | admin | filters date range / byt / osoba / udalosť; table čas · deň · byt · udalosť · kto · detail; „Export CSV“ (UTF-8 BOM, `;`) |
| `/stav` | admin | last successful sync, failures in a row, last webhook, webhook registered?, token expiry and mints today, last 50 runs, lists of flats with unknown min-nights / insufficient beds / missing laundry field; buttons „Synchronizovať teraz“, „Zaregistrovať webhook“ |
| `/health` | public JSON | `{ok, version, db, last_ok_sync_at, sync_age_s, consecutive_failures, last_webhook_at}`; 503 when db down, sync older than 30 min or 2 failures in a row |

## 8. Auth, testing, operations, deploy

**Login** = e-mail + password per person, no self-signup. You create each user in the Supabase dashboard (Authentication → Add user, or „Invite“ which e-mails a set-password link); a trigger creates the `staff` profile; you promote admins and deactivate people in `/nastavenia`. Passwords never pass through me or through chat. Sessions via `@supabase/ssr` and Next 16 `proxy.ts`; roles are checked in database policies and RPCs, never from client-editable metadata. Devices sign out after 12 h idle.

**Tests.** Vitest on the pure module: the 11 required tests plus the edge cases in section 6 (guests 0, capacity 0, no beds, insufficient beds, bunk, crib, precedence chain, small-duvet conversion, private linen, gap plurals, unknown gap day, DST night 2026-10-25, Slovak collation). Integration tests with recorded Guesty fixtures (token cache, 429, paging, webhook signature valid/tampered/duplicate, cancellation → „Zrušené“). Database tests: staff cannot update packages directly, `pack_package` replay is idempotent, second packer gets „Už zabalil(a) Meno“, policy shows day+2 at 00:30 Bratislava.

**Observability.** JSON-line logs (`job, run_id, request_id, guesty_calls, duration_ms`, never tokens or guest data); durable summaries in `sync_runs`; `/stav` shows everything so you never need the Vercel dashboard. **Alerts:** `/health` returns 503 → free uptime monitor e-mails you; red header + admin banner on the board; optional chat webhook.

**Deploy.** One Vercel project, one Supabase project, one Guesty OAuth app. Until go-live the production deployment *is* the staging site (Vercel runs crons only on production deployments); at go-live it gets the domain, real users and `APP_ENV=production`. Migrations are hand-written SQL applied with the Supabase CLI. Secrets live only in Vercel env vars and git-ignored `.env.local` (Appendix C).

Order of work stays as in spec §8: step 2 (calculator + parser + tests) needs nothing from you; step 3 needs the Guesty credentials; step 5 gives you the staging link.

## 9. Defaults I chose – tell me if any is wrong

- **People** = Guesty `guestsCount` (adults + children; infants excluded), as the prototype did.
- **Overrides** (`Osušky veľké: N` etc.) are fixed counts regardless of people.
- **Several capsule types on one line without counts** → each type gets `people` + warning „viac druhov kapsúl – over počet“. A count without a type (`Kapsule: 10 ks`) shows the generic row with the red note and the fixed count.
- **Summary tiles, filter counts and Angelika's sentence** follow the cleaning-company filter; the day tabs do not (prototype behaviour).
- **Späť** is unlimited and logged; the checklist does not block „Zabaliť“; ticks lock after packing.
- **Third day** is named by weekday („št 1.10.“) in the tab and the sentence; „Pozajtra“ is not used.
- **Size lines** (`Plachta: 160×200`) are not parsed; they show in the „Z Guesty:“ box.
- **Toilet paper** rule is fixed in code and shown read-only in Settings; the other consumables are editable.
- **One environment** (staging becomes production at go-live), one package per outgoing reservation.
- **Children banner** is shown whenever a next reservation with children exists, as in the prototype.

## 10. Questions – „OK“ accepts every default

1. **Money.** Vercel Pro **$20/month** from the start. Reason: Vercel Hobby allows cron jobs only once a day and is limited to non-commercial use, so the 3-minute reconcile is impossible there. A $0 alternative for the staging phase exists (Supabase's own scheduler calling our route every 3 minutes; reported to work on the free plan but not stated in official docs). Supabase **Free now, Pro $25/month at go-live** (no pausing after inactivity, daily backups, 8 GB). *Default: Vercel Pro now, Supabase Pro at go-live.*
2. **This PC.** Node.js and Git are not installed here. May I install Node.js LTS and Git via `winget` (free)? And which GitHub account/organisation should own the private repo `pracovna` (I create the repo after you sign in with `gh auth login`)? *Default: yes, install; repo under your personal GitHub account.*
3. **Guesty app.** You create the OAuth application (Guesty → Integrations → Developer tools → OAuth applications → „LIVE-IN Pracovna“) and paste Client ID + Secret into Vercel env vars, accepting that the staging site reads your real reservations read-only. The Client Secret is shown only once. *Default: yes.*
4. **Regular beds.** When packing for fewer people than the beds hold (1 guest, two king beds), every regular bed still gets its full set; only towels, toilet paper and capsules follow `people`. This is the prototype behaviour. The alternative (make only the beds needed) changes daily linen volume a lot. *Default: prototype.* **Revised 2026-10-03 by the owner (Klariská: 2 guests, 3 king beds, 3 duvets shown; Moyzesova: 3 guests, 4 duvets shown): beds and duvets follow the people.** One regular bed per person (double beds first, then singles, never more than the flat has; sofas as before, only when the made beds cannot sleep everyone), and the Guesty duvet counts are the flat's full set handed out per made bed (a double bed its large duvet(s), otherwise two small; a single one small); beds are made complete even for one guest, so 3 guests get two complete double beds, and only towels, toilet paper and capsules follow the guest count (owner, 2026-10-04). Pillows always follow the duvets (2 per large, 1 per small); sheets follow the made beds as Guesty lists them, one large sheet each; small sheets are never packed automatically and a made single bed adds the card question "Veľkosť plachty preveriť s Angelikou". A full flat gets the whole set as before.
5. **Private linen.** *Revised 2026-10-05 by the owner: private linen is only a note for the packers (the purple banner stays); the card shows duvets, pillows, sheets and towels exactly like every other flat and they count in the day totals.* Original decision: `Prádlo: súkromné` omits all linen rows including duvets (7 of the 11 private flats have exact duvet counts entered, which would then be ignored), packs consumables + checklist only, and the flat still counts in „X/Y zabalené“. *Default: yes.*
6. **Gap rule details.** (a) A gap day that is blocked or closed-to-arrival in the Guesty calendar also counts as unsellable, not only the min-nights rule. (b) Gaps longer than 14 nights are treated as sellable without a calendar lookup (a 15-night gap would need a 16-night minimum stay to be unsellable). *Default: yes to both.*
7. **Rush priority.** Spec sorting is alphabetical with not-packed first, yet the Angelika sentence says „Rýchle výmeny: N, tie majú prednosť“. Keep spec sorting and rely on the orange badge, or sort rush cards first inside the not-packed group? *Default: spec sorting.*
8. **Login and PriceLabs.** Personal e-mail + password per staff member created by you in the Supabase dashboard, minimum 8 characters; PriceLabs min-stay fallback stays off until you give me a PriceLabs API key. *Default: yes.*

Things to send later, not blocking: **D1** staff/admin names + e-mails; **D2** the canonical list of the capsule types (photos exist for Cafissimo, L'OR, Nespresso original); **D3** the real bunk-bed rule for Šustekova Sky / Hrobákova.

---

## Appendix A – DDL sketch

```sql
create function today_ba() returns date language sql stable as
  $$ select (now() at time zone 'Europe/Bratislava')::date $$;

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null, role text not null default 'staff' check (role in ('staff','admin')),
  active boolean not null default true, created_at timestamptz not null default now());

create table listings (
  guesty_id text primary key, name text not null, title text, city text,
  active boolean not null default true, accommodates int, bedrooms int, bathrooms numeric(3,1),
  beds jsonb not null default '{}', beds_source text,            -- listingRooms | spaces | none
  tags text[] not null default '{}', laundry_raw text, laundry jsonb, cleaner text,
  owner_cleans boolean not null default false, in_scope boolean not null default false, exclusion_reason text,
  fetched_at timestamptz not null, updated_at timestamptz not null default now());

create table reservations (
  guesty_id text primary key, listing_id text not null, arrival_listing_id text not null,
  status text not null, check_in_date date not null, check_out_date date not null,
  guests int, adults int, children int, infants int, confirmation_code text, source text,
  not_found_runs smallint not null default 0, fetched_at timestamptz not null, updated_at timestamptz not null default now());
create index reservations_checkout_idx on reservations (check_out_date, status);
create index reservations_arrival_idx on reservations (arrival_listing_id, check_in_date) where status = 'confirmed';

create table calendar_min_nights (
  listing_id text not null, date date not null, min_nights int, status text, cta boolean,
  source text not null default 'guesty', fetched_at timestamptz not null default now(), primary key (listing_id, date));

create table packages (
  id uuid primary key default gen_random_uuid(),
  -- computed group (sync only)
  outgoing_reservation_id text not null unique, listing_id text not null, listing_name text not null,
  date date not null, incoming_reservation_id text, same_day boolean not null default false,
  gap_nights int, gap_blocked boolean, target_people int not null,
  people_source text not null check (people_source in ('same_day','gap','capacity')),
  computed_items jsonb not null, computed_hash text not null, warnings jsonb not null default '[]',
  computed_at timestamptz not null default now(),
  -- lifecycle
  status text not null default 'todo' check (status in ('todo','packed','cancelled')),
  hidden boolean not null default false, cancel_reason text, cancelled_at timestamptz,
  -- staff group (RPC only)
  note text not null default '', note_by uuid, note_at timestamptz,
  checklist jsonb not null default '{"items":[],"checked":{}}',
  packed_by uuid, packed_by_name text, packed_at timestamptz, packed_hash text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index packages_date_idx on packages (date, status) where not hidden;

create table package_events (
  id bigint generated always as identity primary key,
  package_id uuid not null references packages(id), package_date date not null,
  listing_id text not null, listing_name text not null,
  event text not null check (event in ('created','recomputed','moved','cancelled','restored','packed','unpacked','note','checklist','settings_recompute')),
  actor uuid, actor_name text not null, client_action_id uuid unique,
  data jsonb not null default '{}', created_at timestamptz not null default now());
-- trigger: updates and deletes raise; the log is immutable

create table settings (key text primary key, value jsonb not null, version int not null default 1,
  updated_by uuid, updated_at timestamptz not null default now());          -- linen_table | consumables | duvet_types | checklist
create table settings_history (id bigserial primary key, key text, old_value jsonb, new_value jsonb, changed_by uuid, changed_at timestamptz default now());
create table sync_runs (id bigserial primary key, job text not null, trigger text not null,
  started_at timestamptz not null default now(), finished_at timestamptz, ok boolean, error text,
  guesty_calls int not null default 0, stats jsonb not null default '{}');
create table webhook_events (id bigint generated always as identity primary key, svix_id text unique, event_id text unique,
  event text, object_id text, received_at timestamptz not null default now(), processed_at timestamptz,
  status text not null default 'received', attempts int not null default 0, error text, payload jsonb);
create table guesty_tokens (id smallint primary key default 1 check (id = 1), access_token text, expires_at timestamptz,
  obtained_at timestamptz, mints timestamptz[] not null default '{}', lease_until timestamptz);
create table sync_locks (name text primary key, locked_until timestamptz not null, run_id text);
create table app_state (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
```

Realtime: trigger on `packages` and `settings` calls `realtime.send()` on the private topic `board`; policy on `realtime.messages` allows active users to read it. Staff RPCs are `security definer` with `set search_path = ''`, check the caller is an active profile, and replay safely on a repeated `client_action_id`.

## Appendix B – What Angelika sees when things fail

| Failure | Behaviour |
|---|---|
| Guesty down | board keeps last state; header red after 30 min; alert after 2 failed runs; everything catches up automatically |
| Webhook deleted or disabled | reconcile keeps the board correct with ≤ 3 min lag; nightly check alerts; re-register from `/stav` |
| Vercel cron missed or doubled | next run catches up; the lease lock skips overlaps |
| Token quota exhausted | existing token used until expiry; alert; `/stav` shows the next possible mint |
| Two devices pack the same card | first wins; second sees „Už zabalil(a) Meno“ and the fresh card |
| Tablet slept / connection dropped | grey „offline“ dot; re-read on reconnect; 60 s polling meanwhile |
| Day rollover / DST night | tabs re-derived at local midnight without reload; database and cron use `today_ba()` |

## Appendix C – Environment variables (`.env.example`)

```
NEXT_PUBLIC_SUPABASE_URL=            NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=           # server only
GUESTY_CLIENT_ID=                    GUESTY_CLIENT_SECRET=
GUESTY_ACCOUNT_ID=682f39ceca0d576ff1aa1da7
GUESTY_WEBHOOK_SECRET=               # from the register step
GUESTY_LAUNDRY_FIELD_ID=6ab385c5bcf98e0011a9419d
GUESTY_CLEANER_FIELD_ID=             # optional, once the dropdown exists in Guesty
CRON_SECRET=                         # random, ≥ 32 chars; Vercel sends it as Bearer on cron calls
APP_ENV=staging                      # staging | production
SEED_MODE=false
PRICELABS_API_KEY=                   # optional
ALERT_WEBHOOK_URL=                   # optional
```
