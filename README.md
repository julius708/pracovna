# LIVE-IN Práčovňa

Laundry packing board for LIVE-IN (Bratislava). Shows which apartments need a bag packed today, tomorrow and the day after, how many linen items and consumables go in, and lets staff mark each bag as packed. Data comes live from Guesty; package status lives in the app's own database.

Stack: Next.js (App Router, TypeScript) on Vercel · Supabase (Postgres, Auth, Realtime) · Tailwind · Vitest.

The full design is in [docs/PROPOSAL.md](docs/PROPOSAL.md).

## Status

| Step | Content | State |
|---|---|---|
| 1 | Architecture, data model, screens | approved 2026-09-29 |
| 2 | Packing calculator + laundry-field parser + unit tests | done |
| 3 | Guesty client, reconciliation, webhooks | next |
| 4 | UI, auth, realtime, Settings, História | – |
| 5 | Staging deploy on Vercel | – |

## Repository layout

```
src/core/packing/   pure packing domain: parser, scope, people, beds, linen, consumables, capsules, calculator
src/core/i18n/      every Slovak string of the app
tests/unit/         unit tests of the domain (the 11 required cases from the spec and edge cases)
tests/blackbox/     tests written independently from the spec, used as a second opinion
public/assets/      logo, Angelika's photo, capsule photos
docs/               proposal and notes
```

`src/core` must not import Next, Supabase or the Guesty client; ESLint enforces it.

## Local setup

```bash
pnpm install
cp .env.example .env.local   # fill in later steps
pnpm test                    # unit tests
pnpm typecheck
pnpm lint
pnpm dev                     # http://localhost:3000
```

Node 22+ and pnpm are required. On Windows, install with `winget install --source winget OpenJS.NodeJS.LTS` and `npm i -g pnpm`.

## Packing rules

The rules are specified in the owner's spec and refined in `docs/PROPOSAL.md` section 6. In short:

- A package exists for every in-scope apartment with a check-out on a given day.
- People to pack for: same-day check-in → that reservation's guests; later check-in whose gap cannot be sold (min. nights or blocked calendar) → the next reservation's guests; otherwise the listing's capacity.
- Beds: king/queen/double and unknown types sleep 2; single sleeps 1; bunk = 2 singles with a warning; sofa beds are unfolded one by one only when regular beds cannot cover the people.
- Linen per bed, per person and per bathroom from the editable table; exact duvet counts and per-item overrides from the Guesty field "Informácie do práčovne" replace the calculation.
- Consumables: toilet paper `max(2, people)`, fixed items, and coffee capsules per type (count = people unless "N ks").

Guesty app creation, webhook registration and deployment are documented in later steps.
