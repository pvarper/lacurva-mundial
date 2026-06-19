# Explore: SportMonks API integration (issue #43)

## What

Explored lacurva-mundial codebase to scope SportMonks Football API v3 integration for auto-updating match scores instead of manual entry.

## Why

Issue #43 requests replacing manual admin score entry (`PUT /api/fixtures/:id`) with an automated sync from SportMonks API.

## Findings

- `data/fixtures.json` — flat array, fields: `id, matchNumber, date (ISO UTC), boliviaDate, boliviaTime, homeTeam, awayTeam, homeScore, awayScore, status, phase, roundName, group, city, stadium, stadiumCommonName, source`. No external-ID field exists yet; adding `sportmonksFixtureId` is additive/non-breaking.
- `server.js:18` — `FIXTURE_STATUSES = Set(['scheduled','live','final'])` is the only valid status vocabulary; SportMonks `state_id` needs mapping into these 3.
- `server.js:440` — `PUT /api/fixtures/:id` is the ONLY current write path for status/score, admin-only, writes via `writeJson` + audit log action `fixture_updated` with `previousValue` diff. A sync job should reuse this same fixture-mutation + `writeJson` pattern but log a distinct audit action (e.g. `fixture_synced`) to keep manual vs automated changes distinguishable.
- `server.js:219` `calculatePredictionPoints` — reads `match.status === 'final'` + `homeScore`/`awayScore` directly, agnostic to how they were set. Safe to feed from sync.
- `server.js:209` `isPredictionLocked` — compares `match.date` to now, independent of score source.
- `package.json` — deps are only `express`, `express-rate-limit`, `express-session`, `helmet`. No `axios`/`node-fetch`/`dotenv`/`node-cron`. No `engines` field pinning Node version.

## Learned

- No cron/background job pattern exists anywhere in the codebase — this would be the first one. In-process `setInterval` in a new isolated module (e.g. `lib/sportmonks-sync.js`) imported into `server.js` is most consistent with current single-process architecture, vs adding a job runner dependency.
- No outbound HTTP client exists — net new. Built-in Node `fetch` (available since Node 18, no dependency needed) is viable IF deployment Node version is confirmed >=18; project has no `engines` field to confirm this.
- `process.env` is read directly with no dotenv loader (`SESSION_SECRET` pattern) — `SPORTMONKS_API_TOKEN` would follow same convention unless dotenv is added.
- Team names in `fixtures.json` are in Spanish (México, Sudáfrica, Corea del Sur) — sync must match fixtures by a stable `sportmonksFixtureId` mapping, NOT by team-name string comparison against SportMonks' English/local names.
- Audit log is capped at last 1000 entries (`audit-log.json`) — high-frequency sync writes (10s polling per issue context) risk flooding/evicting audit history fast if every poll cycle logs, even when nothing changed. Sync should only log on actual state transitions, not every poll tick.

## Open questions for design phase

- Node version confirmation (need >=18 for built-in `fetch`).
- Exact `state_id` mapping table (SportMonks state → `scheduled`/`live`/`final`).
- Polling cadence vs rate limits vs 1-minute prediction lock window.
- How `sportmonksFixtureId` gets populated (manual one-time mapping vs name+date lookup).
- Whether manual admin edits should be protected from being overwritten by a subsequent sync tick (needs a `source: 'manual' | 'sync'` flag).
- Token loading mechanism (dotenv vs manual export).
- Audit logging frequency/action naming for sync-driven changes.

Engram topic: `sdd/sportmonks-integration/explore` (observation #2899)
