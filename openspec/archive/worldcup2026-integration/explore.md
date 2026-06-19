# Explore: switch fixture-sync provider from SportMonks to worldcup2026 (issue #43)

## Current state

SportMonks integration (branch `feat/sportmonks-integration-43`, commit 8a4e788) is a dead end — the live token is on the Football Free Plan, which doesn't cover the World Cup. `lib/sportmonks-team-map.js` has every team id hardcoded `null`, so `isSyncCandidate` always skips every fixture (permanent no-op). `lib/sportmonks-states.js` state-id mappings are unverified guesses. `server.js` `FIXTURE_STATUSES = new Set(['scheduled', 'live', 'final'])` (line 19) is enforced on `PUT /api/fixtures/:id` (line 441).

## New provider: worldcup2026 (worldcup26.ir)

- Live hosted REST API, base URL `https://worldcup26.ir`, no API key for GET endpoints.
- Working endpoint confirmed: `GET /get/games` (returns all 104 matches in one call). `GET /get/game/{id}` returned `{"error":"Error getting game with id:N"}` when tested directly — singular-by-id route appears broken/unreliable; use `/get/games` (bulk) instead.
- Match JSON shape (confirmed live, not just README): `{id, home_team_id, away_team_id, home_score, away_score (strings), home_scorers, away_scorers, group, matchday, local_date ("MM/DD/YYYY HH:mm"), persian_date, stadium_id, finished ("TRUE"/"FALSE" string), time_elapsed, type, home_team_name_en, home_team_name_fa, away_team_name_en, away_team_name_fa}`.
- **`time_elapsed` field gives granular status** — confirmed values seen live: `"notstarted"`, `"finished"`. This likely carries live-minute values during in-play matches (unconfirmed — no live match was observed during this exploration window). This resolves the "no live signal" gap initially flagged — the API has more than just a finished boolean.
- Team names are provided in English (`home_team_name_en`) AND Persian (`home_team_name_fa`) — no Spanish, but English names are far easier to map against our Spanish names than guessing from IDs alone (e.g. "Mexico" -> "México", "South Africa" -> "Sudáfrica").

## Critical finding: id does NOT map to our matchNumber

Initial hypothesis (id 1-104 == matchNumber 1-104) is **FALSE**, confirmed by live data:

- API `id=1`: Mexico vs South Africa, 06/11/2026 13:00, finished, 2-0 — matches our `m-001` (matchNumber 1, México vs Sudáfrica) exactly. Coincidence, not a pattern.
- API `id=13`: Iran vs New Zealand, 06/15/2026 18:00, finished, 2-2 — but our `m-013` (matchNumber 13) is **Arabia Saudita vs Uruguay**. Our `m-015` (matchNumber 15) is Irán vs Nueva Zelanda, but with a different date/time. The two datasets do not share the same match ordering (ours sourced from fixturedownload, theirs independently assigned).

**Conclusion**: direct id-keyed fetch (`/get/game/{matchNumber}`) is invalid and must not be used. Matching MUST be done by team name (translated) + date, fetching the full `/get/games` list once per cycle and filtering — this was already the "Approach 2 (defensive)" the original exploration pass recommended as the safer option; it is now the ONLY viable option, not just the safer one.

## Reusability of existing SportMonks sync code

- `lib/sportmonks-sync.js` — poll-loop skeleton (`runSyncCycle`, `applyFixtureSync`, start/stop, diff-before-write, per-fixture try/catch, audit logging) is provider-agnostic and reusable. The fetch/match/extract-score functions (`fetchSportmonksFixture`, `pickMatchingFixture`, `extractCurrentScore`) are SportMonks-specific and must be rewritten for the new shape.
- `lib/sportmonks-team-map.js` — repurposable concept (team name -> id) but values are useless (SportMonks ids, not worldcup2026 ids). New table needed: Spanish name -> worldcup2026 `home_team_name_en`/`away_team_name_en` equivalent (or just normalize and compare English names directly without persisting ids, since `/get/games` already returns names alongside scores — no id resolution needed at all if matching by name+date against the bulk list).
- `lib/sportmonks-states.js` — entirely obsolete. Replaced by `finished`/`time_elapsed` parsing logic.
- `server.js` wiring — same `writeJson`/`recordAuditLog` pattern stays; only the env var gate changes (no `SPORTMONKS_API_TOKEN` needed; could gate on a new `WORLDCUP_SYNC_ENABLED` flag or just always run since no token is required, with a feature flag to disable for local dev).

## Other facts confirmed

- Rate limit 500 req/60s server-side — fetching `/get/games` once per 60s cycle (1 request) is trivially within budget; far simpler than the SportMonks per-fixture-per-cycle approach.
- No new dependency needed — built-in Node `fetch` (already proven in the SportMonks code) covers this too.
- `finished` and scores are strings, not native booleans/numbers — must `JSON.parse`/coerce (`"TRUE"|"FALSE"` string compare, `Number(home_score)`) rather than relying on JS truthiness.
- Data source reliability: unofficial/community project (292 stars, ~30 commits, no accuracy disclaimer) — same category of risk as before, mitigated by the existing unprotected manual `PUT /api/fixtures/:id` override.

## Open questions for proposal/design

1. Exact `time_elapsed` value set during live play — unconfirmed (no live match observed). Must be treated defensively: anything that's not `"notstarted"` or `"finished"` should likely map to `"live"`, rather than enumerating exact live-state strings.
2. Team-name matching: build a Spanish-name -> English-name static table (32-48 entries, same effort as the abandoned SportMonks team-id table) since `/get/games` returns `home_team_name_en` directly — no provider-side id resolution required.
3. Whether to fetch `/get/games` (bulk, 1 request, simplest) every cycle vs trying `/get/game/{id}` per match (broken in this session) — recommend bulk fetch.
4. Knockout-stage fixtures (our m-073..m-104 with placeholder names like "2A", "W74") — same scope exclusion as before, skip until admin resolves real team names.

Engram topic: `sdd/worldcup2026-integration/explore` (observation, see engram)
