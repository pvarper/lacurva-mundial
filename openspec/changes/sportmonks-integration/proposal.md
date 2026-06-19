# Proposal: SportMonks API integration (issue #43)

## Why

Admin currently must manually enter scores via `PUT /api/fixtures/:id` for every match during the World Cup. This is slow, error-prone under live-match conditions, and does not scale across many concurrent matches. SportMonks already has live state and score data; syncing it removes manual toil and reduces the risk of stale or incorrect standings during high-traffic moments (live matches, right after final whistle).

## Intent

- **Problem**: manual score entry doesn't scale and introduces latency/errors during live tournament play.
- **Why now**: World Cup 2026 fixtures are loaded; issue #43 explicitly requests this before matches go live.
- **Success**: fixture status/score reflects SportMonks data within an acceptable polling window, without admin intervention, while preserving the existing manual-edit path as a fallback/override.

## Scope — in

- New isolated sync module (e.g. `lib/sportmonks-sync.js`) polling SportMonks `/football/fixtures/latest?include=scores` on an interval.
- Add `sportmonksFixtureId` field to fixtures.json entries (additive, non-breaking) to match fixtures without relying on team-name comparison (existing names are Spanish; SportMonks returns English/local names).
- Map SportMonks `state_id` to the existing 3-value status vocabulary (`scheduled`, `live`, `final`).
- Reuse the existing fixture-mutation + `writeJson` pattern from `PUT /api/fixtures/:id`, but log sync-driven changes under a distinct audit action (`fixture_synced`) instead of `fixture_updated`, and only log on actual state transitions (not every poll tick) to avoid flooding the 1000-entry audit cap.
- Track provenance per fixture (manual vs sync) so downstream logic and the admin UI can distinguish source of truth.
- Built-in Node `fetch` for the HTTP client (no new dependency), `process.env` for the API token following the existing `SESSION_SECRET` convention (no dotenv unless decided otherwise).

## Scope — out / non-goals

- Lineups, player stats, odds, news, or any other SportMonks data beyond fixture status and score.
- Any UI redesign beyond minimally surfacing sync status/provenance if needed for admin clarity.
- Historical backfill of past tournaments/fixtures.
- Multi-provider abstraction (only SportMonks is in scope).
- Removing the manual `PUT /api/fixtures/:id` path — it remains as an override/fallback, not deleted.
- Job-runner/queue infrastructure — stays in-process via `setInterval`, consistent with current single-process architecture.

## Approach (high-level)

1. New isolated module owns all SportMonks HTTP calls, polling loop, and `state_id` → status mapping. No changes to existing route handlers' external behavior.
2. Sync module reuses fixture array mutation + `writeJson(fixtures.json)` already used by the admin `PUT` handler, ensuring a single source of truth for persistence logic.
3. Audit logging is selective: a write is logged only when status or score actually changes value (a "transition"), under a new `fixture_synced` action distinct from `fixture_updated`.
4. `sportmonksFixtureId` added per fixture as the stable join key; sync never matches by team name.
5. Manual vs. sync provenance is tracked (likely a `source` field value of `'manual'` or `'sync'`) so the design phase can define exact precedence/locking rules.

## Decisions needed before design can finalize

1. **Node version confirmation** — must be >=18 to use built-in `fetch` without adding a dependency; project has no `engines` field today.
2. **Polling cadence** — tension between freshness (live matches), SportMonks rate limits, and the 1-minute prediction lock window. Needs an explicit interval (e.g. 30s/60s).
3. **`sportmonksFixtureId` population** — manual one-time mapping list authored by admin, vs. an automated lookup/matching script run once against fixtures.json.
4. **Manual-edit precedence** — does a manual `PUT` lock that fixture against sync until some condition, or does sync always win on next poll?

## Where

`data/fixtures.json` (new field), `server.js` (audit action reuse pattern), new `lib/sportmonks-sync.js` (net new), `package.json` (no new deps if Node >=18 confirmed; otherwise dotenv may be added per decision #1).

Engram topic: `sdd/sportmonks-integration/proposal` (observation #2900)
