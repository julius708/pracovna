# LIVE-IN Práčovňa

Laundry packing board for LIVE-IN (Bratislava). Shows which apartments need a bag packed today, tomorrow and the day after, how many linen items and consumables go in, and lets staff mark each bag as packed. Data comes live from Guesty; package status lives in the app's own database.

Stack: Next.js (App Router, TypeScript) on Vercel · Supabase (Postgres, Auth, Realtime) · Tailwind · Vitest.

The full design is in [docs/PROPOSAL.md](docs/PROPOSAL.md).

## Status

| Step | Content | State |
|---|---|---|
| 1 | Architecture, data model, screens | approved 2026-09-29 |
| 2 | Packing calculator + laundry-field parser + unit tests | done |
| 3 | Guesty client, reconciliation, webhooks, database schema, seed mode | done (live probe pending credentials) |
| 4 | UI, auth, realtime, Settings, História, Stav | done (reviewed and re-reviewed 2026-10-02) |
| 5 | Staging deploy on Vercel | done 2026-10-02: https://pracovna-cyan.vercel.app (team "Pracovna APP", Pro; crons every 3 min; Guesty webhook registered) |

## Repository layout

```
src/core/packing/   pure packing domain: parser, scope, people, beds, linen, consumables, capsules, calculator
src/core/i18n/      every Slovak string of the app
src/guesty/         Open API client: token cache, HTTP backoff, endpoints, zod schemas, mappers, fake client, fixtures
src/sync/           reconcile (every 3 min), recompute of the 7-day board window, listings, min-nights, webhooks, nightly, alerts, seed
src/db/             repo interface, memory repo (tests/seed), Supabase repo (service role), server client (auth)
src/app/            pages: / (board), /login, /nastavenia, /historia (+export.csv), /stav; _lib (viewer, board data, server actions)
src/app/api/        route handlers: guesty/webhook, cron/reconcile, cron/nightly, admin/sync-now, admin/webhooks/register
src/ui/             Board, PackageCard, Summary, Header, SettingsForm, StatusPanel, LoginForm, board-model (pure), useLiveBoard
src/app/health/     public health JSON
supabase/           migrations and seed.sql (default settings)
scripts/            guesty-probe.ts (records real API shapes), build-seed-listings.mjs
tests/              unit (domain), blackbox (independent second opinion), integration (seed-mode end to end, webhooks)
public/assets/      logo, Angelika's photo, capsule photos
```

`src/core` must not import Next, Supabase or the Guesty client; ESLint enforces it.

## Local setup

```bash
pnpm install
cp .env.example .env.local        # fill in what you have; SEED_MODE=true works without any keys
pnpm test                         # all suites
pnpm typecheck
pnpm lint
pnpm dev                          # http://localhost:3000
```

Node 22+ and pnpm are required. On Windows: `winget install --source winget OpenJS.NodeJS.LTS` and `npm i -g pnpm`.

Set all three Supabase variables or none: with only some of them the app refuses to start (a half-configured database would mix the development sign-in with real sessions).

### Sign-in and passwords

Users are created in Supabase (Authentication → Add user, "Auto Confirm User" ticked); the `handle_new_user` trigger creates their staff profile. The login page has "Zabudnuté heslo?"; Supabase e-mails a link and the user sets a new password on `/nove-heslo`. Three Supabase settings make the links work:

1. Authentication → URL Configuration: **Site URL** `https://pracovna-cyan.vercel.app`, **Redirect URLs** `https://pracovna-cyan.vercel.app/**` (plus `http://localhost:3000/**` for development).
2. Authentication → Email Templates → **Reset Password**: replace the `{{ .ConfirmationURL }}` link with
   `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/nove-heslo`.
   This token-hash form works on any device (request the link on the PC, open it on the phone); the default PKCE link only works in the browser that asked for it. The dashboard's "Send password recovery" uses the same template.
3. Without custom SMTP Supabase sends only a few auth e-mails per hour and, on some plans, only to project members; set up SMTP (Authentication → SMTP Settings) before the team relies on it.

Links that still arrive in the old formats are handled too: `?code=` is exchanged by `/auth/callback`, a `#access_token…&type=recovery` fragment is consumed by `/nove-heslo`, and either of them landing on the site root or `/login` is forwarded to the callback. Only recovery links are accepted by the callback.

### Seed mode

Without Supabase keys the login page offers two development stand-ins ("Test správca", "Test personál") so the whole app can be exercised locally; with Supabase configured the real e-mail/password login is used and the stand-ins disappear.

`SEED_MODE=true` swaps the Guesty client for a fake one with the 107 real listing shapes and generated reservations around today (same-day check-ins with children, 1–2-night gaps with min. stay 1/2, blocked calendar days, no next reservation, two check-outs of one flat, a multi-listing stay, a cancelled reservation). Without Supabase keys the data lives in memory for the lifetime of the server process. Seed mode is refused when `APP_ENV=production`.

Trigger a sync locally:

```bash
curl http://localhost:3000/api/cron/reconcile      # allowed without CRON_SECRET only in seed mode
curl http://localhost:3000/health
```

## Guesty

### Creating the OAuth application

1. In Guesty open **Integrations → Developer tools → OAuth applications** and create an application (for example "LIVE-IN Pracovna").
2. Copy the **Client ID** and the **Client Secret** (the secret is shown only once) into `.env.local` locally and into the Vercel environment variables as `GUESTY_CLIENT_ID` / `GUESTY_CLIENT_SECRET`. Never paste them in chat or commit them.
3. Guesty allows **5 access tokens per 24 hours** per application. The app mints at most 3 and caches the token in the database; the probe script uses one and caches it in `.probe-token.json` (git-ignored). Do not run the probe more than once a day.

### The day-1 probe

```bash
pnpm probe                              # ~10 requests, one token
pnpm probe -- --webhook-url https://<host>/api/guesty/webhook
```

It writes `docs/guesty-notes.md` (field shapes, listing counts with and without the active/listed filters) and redacted fixtures to `src/guesty/fixtures/recorded/`. Recorded on 2026-10-02 against the LIVE-IN account:

- `GET /listings` returns `listingRooms`, `bathrooms` and inline `customFields`; envelope `{results, count, limit, skip}`; 132 listings, 131 with `active=true&listed=true`.
- `GET /reservations-v3/search` answers `{results, pagination.hasMore}`; `filter[listingId]` takes a comma-separated string (bracket arrays are refused); stay segments carry `listingId`.
- `GET /reservations-v3` needs `reservationIds[]=a&reservationIds[]=b` (a comma-joined value is a 400) and answers a plain array whose stay segments carry `unitTypeId` (the listing) and `unitId` instead of `listingId`.
- The calendar batch takes `listingIds=a,b` and answers `{status, data: {days: [...]}, message}` with `listingId`, `minNights`, `status`, `cta` per day.

`tests/unit/guesty/real-shapes.test.ts` pins these shapes.

### Registering the webhook

Webhooks can only be created through the API. After the site is deployed:

```bash
curl -X POST https://<host>/api/admin/webhooks/register -H "Authorization: Bearer $CRON_SECRET"
```

The response contains the signing secret once. Put it into Vercel as `GUESTY_WEBHOOK_SECRET` and redeploy. The endpoint subscribes to `reservation.created.v2`, `reservation.updated.v2`, `listing.new`, `listing.updated`, `listing.removed`. Every delivery is verified with the Svix signature, stored, acknowledged within a second and processed afterwards; the reservation is always re-fetched from Guesty before anything changes. Anything missed is caught by the 3-minute reconcile.

## Scheduled jobs (Vercel Cron, `vercel.json`)

| Path | Schedule | Does |
|---|---|---|
| `/api/cron/reconcile` | every 3 minutes | listings (hourly), check-outs of the 7 board days, next check-ins, absence check, min-nights, recompute, webhook retries |
| `/api/cron/nightly` | 02:00 UTC | retention, full listing refresh, webhook health, recompute |

Vercel sends `Authorization: Bearer <CRON_SECRET>`; set `CRON_SECRET` (random, 32+ characters) in the Vercel environment. Vercel Hobby cannot run a 3-minute cron; the project needs Vercel Pro.

## Database

Migrations are plain SQL in `supabase/migrations/`, applied with the Supabase CLI (`supabase db push`) or pasted into the SQL editor; `supabase/seed.sql` loads the default linen table. Rules that the schema enforces:

- staff can only change packages through the RPCs `pack_package`, `unpack_package`, `set_note`, `toggle_check`; the sync writes only the computed columns through `sync_upsert_package`; a guard trigger refuses any other update;
- the staff RPCs act only on the rows the board shows to staff (visible, yesterday to today+6, see `WINDOW_DAYS`); admins may touch any row;
- `package_events` is append-only and kept forever;
- row visibility follows Bratislava's calendar date (`today_ba()`);
- a deactivated user can still read their own profile row (so the app can say "Účet je deaktivovaný"), nothing else; an admin cannot deactivate or demote their own account.

## Deliberate differences from the prototype

The owner's prototype (`pracovna.html` in the `reference/` folder of the spec directory, not part of this repository) is the reference for rules, texts and look; the owner's spec wins where they disagree. These are the knowing deviations:

- Angelika's bubble before the first sync says „Dáta z Guesty sa ešte načítavajú.“ instead of the prototype's „…po rannom syncu“: the app syncs every 3 minutes, there is no morning sync.
- The children banner always shows both counts, „deti: N · batoľatá: N“, as written in the spec (the prototype hid a zero part). Numbers are bold like in the prototype.
- Card content order follows the spec: name, badges (Rýchla výmena, „Balíme na N osôb …“, next arrival), then banners (children, private linen). The prototype printed the banners first.
- Item pictograms are off, as in the prototype (`ICONS_ON = false`); only the capsule photos are shown.
- Dark mode uses dark text on the green/red status pills and the „Zabalené ✓“ button (the prototype's white text had about 2:1 contrast there).

## Alerts and health

`/health` returns 503 when the database is down, the last successful sync is older than 30 minutes, or two syncs in a row failed. Point a free uptime monitor at it (for example UptimeRobot: HTTPS monitor of `https://pracovna-cyan.vercel.app/health`, 5-minute interval, keyword `"ok":true` must exist, alert contact your e-mail). That is the only check that still works when Vercel itself is down or the cron stopped.

The app also raises its own alerts (sync failed twice in a row, Guesty token quota, webhook missing or silent, listing drop): once when the alert opens, every 6 hours while it stays open, and once when it resolves. Sinks, both optional:

- **Telegram** (recommended, free, instant on the phone): in Telegram open @BotFather, send `/newbot`, pick a name and copy the token into `ALERT_TELEGRAM_BOT_TOKEN`. Send the new bot any message (or add it to the laundry group and write there), then put the chat id into `ALERT_TELEGRAM_CHAT_ID` (`https://api.telegram.org/bot<token>/getUpdates` shows it under `message.chat.id`; group ids are negative).
- `ALERT_WEBHOOK_URL`: any endpoint that accepts a JSON `{text}` POST (Slack/Teams incoming webhook, Zapier, …).

`POST /api/admin/webhooks/register`'s sibling `POST /api/admin/alerts/test` (cron secret or admin session) sends a test message through every configured sink and reports what was delivered.

"Prádlo: súkromné" in the Guesty field is a note for the packers (purple banner on the card: take the flat's own linen); the counts are computed and shown exactly like for every other flat, but the linen of these flats stays out of the day totals (their consumables and capsules count); owner's decision of 2026-10-05, replacing proposal Q5.

## Board window

The board shows a week: today and the next six days (`WINDOW_DAYS` in `src/core/packing/dates.ts`; owner's request of 2026-10-03, three days before). The day tabs scroll sideways on a phone. The sync pulls check-outs for the same seven days, and the database shows staff visible packages from yesterday to today+6 (migration 0010); admins see everything.

## Notice board

"Dôležité info" sits above the apartment list, one box per day: a note belongs to the day whose tab was open when it was written and shows only there. Any active user can add a note (up to 500 characters); the author's name and time are shown with it, and every device gets a "Nové dôležité info od … · Zajtra 4.10." notice. The author can edit their own note (marked "upravené"); a note is removed by its author or an admin; removed notes stay in `board_notes` for the record (admins can still read them). Writes go through the `add_board_note` / `edit_board_note` / `remove_board_note` RPCs (migrations 0007 to 0009).

**Skoré príchody** (owner, 2026-10-11): a red box under the notice board, one per day, filled from Guesty. The planned arrival of a reservation is the clock part of Guesty's check-in timestamp (`arrivalClock` in the mapper; 16:00 is standard, an agreed early check-in shows as 12:00 or 13:00) and is stored on the reservation (`arrival_time`). Every recompute brings `early_arrivals` in line with the confirmed reservations of the board days (`src/sync/early-arrivals.ts`: one row per flat and day for arrivals before `EARLY_ARRIVAL_BEFORE`, old rows marked removed by "Guesty"). The reconcile therefore also fetches the confirmed check-ins of the board days at every flat (stage 3b), not only the next arrivals of flats with a check-out, and re-verifies the held ones by id, so a new early check-in at an empty flat, a changed time or a cancellation reaches the board within three minutes without a webhook. Everyone who opens that day sees the entries, the day tab carries ⏰, the flat's card for that day shows "⏰ Skorý príchod o 12:00 – hosť môže byť v byte skôr", and every open device gets a notice when Guesty reports or withdraws one. Nothing is typed in by hand and nothing is sent outside the app (migrations 0012 and 0013).

**Push notifications** (owner, 2026-10-11): "🔔 Zapnúť upozornenia" in the header subscribes the device (Web Push; service worker `public/sw.js`, manifest `public/manifest.webmanifest`, app icons in `public/icons`). The subscription is stored under the user in `push_subscriptions` (migration 0014; writes go through `save_push_subscription` / `remove_push_subscription`, so a shared phone belongs to whoever is signed in on it; the service worker re-stores a rotated subscription through `/api/push/subscription`). When a recompute adds an early arrival, `src/sync/push.ts` sends "⏰ Skorý príchod o 13:00 · Poštová, Heart (č. bytu 606) · zajtra 12.10." to every subscription of an active user through the service role; subscriptions the push service reports gone (404/410) are deleted. Push needs the three VAPID settings `NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY` and `WEB_PUSH_SUBJECT` (generated once with `web-push generate-vapid-keys`); without them the toggle is hidden and nothing is sent. On an iPhone push works only after the app is added to the home screen (Safari → Zdieľať → Pridať na plochu); the toggle says so.

**História balenia** (`/historia/balenie`, admins): one row per packed card with who packed it, when, for how many people and the exact counts (linen, consumables, capsules) as they were on the card at the moment of packing. The `packed` audit event stores that snapshot (migration 0011); events from before it show the package's last computed counts. The filter (packing day, flat, person) has a CSV export with one column per item.

## Packing rules

The rules are specified in the owner's spec and refined in `docs/PROPOSAL.md` section 6. In short:

- A package exists for every in-scope apartment with a check-out on a given day.
- People to pack for: same-day check-in → that reservation's guests; later check-in whose gap cannot be sold (min. nights or blocked calendar) → the next reservation's guests; otherwise the listing's capacity.
- Beds follow the people: one regular bed per person (double beds first, then singles, never more than the flat has); king/queen/double and unknown types sleep 2, single sleeps 1, bunk = 2 singles with a warning; sofa beds are unfolded one by one only when the made beds cannot sleep everyone. The card shows "2× king (z 3)" when fewer beds than the flat has are made.
- Linen per made bed, per person and per bathroom from the editable table. The duvet counts in the Guesty field "Informácie do práčovne" are the flat's full set: handed out per made bed: a double bed gets its share of the large duvets (the set divided over the double beds), otherwise two small ones, a single bed one small; beds are made complete even for one guest (3 guests = 2 complete double beds), two guests get two beds when the flat has them (stated on the card as "Odporúčanie: pre 2 hostí môžeme pripraviť obidve postele, aby mal každý svoju") and a full flat gets the whole set ; pillows always follow the duvets (2 per large, 1 per small, whatever decided the duvets) and sheets follow the made beds as Guesty lists them, one large sheet each; small sheets are packed only where Angelika confirmed the size (see the flat facts below), otherwise a made single bed gets a large sheet and the card question "Veľkosť plachty preveriť s Angelikou"; a 140 cm bed takes its own "Plachta 140 cm"; per-item overrides (osušky, uteráky, predložky) replace the calculation as absolute numbers.
- Flat facts (`src/core/packing/flats.ts`, owner 2026-10-10): what Angelika knows about particular flats and Guesty does not say, keyed by the Guesty listing id: her name for the flat (shown under the Guesty name: "č. bytu 606", "Eurovea", "byt 190"…), the beds as she counts them (Skalická and Tomášikova: 2 small + 3 large, small sheets confirmed; Vajnorská: king + a 140 cm bed), the real capacity (Mestská: 4, Guesty says 2), the full duvet set (Moyzesova: 3 large + 2 small, shown as "Paplóny: podľa Angeliky"), a note for the card ("Info o byte: …") questions she has settled (never shown for that flat) and items the flat never gets because it has its own stock (Vajnorská 32A: no toilet paper and no dishwasher tablets for now, owner 2026-10-16; the rows leave the card and the day totals). These win over the Guesty data they replace. A made bed the duvet set leaves bare raises the card question "Paplónov v Guesty je menej, ako treba na pripravené postele – preveriť s Angelikou" (Skalická and Tomášikova until Angelika confirms their duvet set).
- Consumables: toilet paper = people + 1; bin bags 2 large + 2 small for a flat below capacity 4, 3 + 3 from capacity 4 (both rules fixed in code, read-only in Settings); the other fixed items from the table; coffee capsules per type (count = people unless "N ks").
