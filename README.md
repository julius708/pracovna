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
| 4 | UI, auth, realtime, Settings, História, Stav | done (verified in seed mode; realtime needs the Supabase project) |
| 5 | Staging deploy on Vercel | next |

## Repository layout

```
src/core/packing/   pure packing domain: parser, scope, people, beds, linen, consumables, capsules, calculator
src/core/i18n/      every Slovak string of the app
src/guesty/         Open API client: token cache, HTTP backoff, endpoints, zod schemas, mappers, fake client, fixtures
src/sync/           reconcile (every 3 min), recompute of the 3-day window, listings, min-nights, webhooks, nightly, alerts, seed
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
| `/api/cron/reconcile` | every 3 minutes | listings (hourly), check-outs of the 3 days, next check-ins, absence check, min-nights, recompute, webhook retries |
| `/api/cron/nightly` | 02:00 UTC | retention, full listing refresh, webhook health, recompute |

Vercel sends `Authorization: Bearer <CRON_SECRET>`; set `CRON_SECRET` (random, 32+ characters) in the Vercel environment. Vercel Hobby cannot run a 3-minute cron; the project needs Vercel Pro.

## Database

Migrations are plain SQL in `supabase/migrations/`, applied with the Supabase CLI (`supabase db push`) or pasted into the SQL editor; `supabase/seed.sql` loads the default linen table. Rules that the schema enforces:

- staff can only change packages through the RPCs `pack_package`, `unpack_package`, `set_note`, `toggle_check`; the sync writes only the computed columns through `sync_upsert_package`; a guard trigger refuses any other update;
- the staff RPCs act only on the rows the board shows to staff (visible, yesterday to the day after tomorrow); admins may touch any row;
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

`/health` returns 503 when the database is down, the last successful sync is older than 30 minutes, or two syncs in a row failed. Point a free uptime monitor at it. `ALERT_WEBHOOK_URL` (optional) receives a JSON `{text}` when an alert opens, every 6 hours while it stays open, and once when it resolves.

## Packing rules

The rules are specified in the owner's spec and refined in `docs/PROPOSAL.md` section 6. In short:

- A package exists for every in-scope apartment with a check-out on a given day.
- People to pack for: same-day check-in → that reservation's guests; later check-in whose gap cannot be sold (min. nights or blocked calendar) → the next reservation's guests; otherwise the listing's capacity.
- Beds: king/queen/double and unknown types sleep 2; single sleeps 1; bunk = 2 singles with a warning; sofa beds are unfolded one by one only when regular beds cannot cover the people.
- Linen per bed, per person and per bathroom from the editable table; exact duvet counts and per-item overrides from the Guesty field "Informácie do práčovne" replace the calculation.
- Consumables: toilet paper `max(2, people)`, fixed items, and coffee capsules per type (count = people unless "N ks").
