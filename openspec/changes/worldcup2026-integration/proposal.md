# Proposal: switch fixture-sync provider to worldcup2026 (issue #43)

## Intent

The prior SportMonks integration (branch `feat/sportmonks-integration-43`) is a dead end: the active SportMonks account is on the Football Free Plan, which does not include World Cup data. As a result `lib/sportmonks-team-map.js` has every team id hardcoded to `null`, making `isSyncCandidate` a permanent no-op — fixtures never sync, defeating the purpose of the integration.

`worldcup2026` (hosted at `https://worldcup26.ir`) is a free, no-API-key REST API that already returns all 104 World Cup 2026 matches in a single bulk call (`GET /get/games`), including scores and a finished/in-play signal, for matches that have occurred. Swapping providers unblocks the original goal of issue #43: automatic fixture score/status updates without manual admin entry, while keeping the existing manual `PUT /api/fixtures/:id` override as the safety net for data the provider gets wrong or hasn't covered (knockout-stage placeholder fixtures, in particular).

Success looks like: live and finished World Cup matches reflect correct scores and status (`scheduled`/`live`/`final`) in `data/fixtures.json` within about 60 seconds of the provider updating, without requiring any secret/API key, and without admins needing to manually enter group-stage results.

## Scope

### In scope

- Rewrite the sync engine to call `GET https://worldcup26.ir/get/games` once per 60s cycle (bulk fetch, not per-fixture), matching the existing `POLL_INTERVAL_MS` cadence and `runSyncCycle`/diff-before-write/per-fixture-try-catch/audit-logging skeleton already proven in `lib/sportmonks-sync.js`.
- Match each local fixture to a provider match by **translated team name (Spanish to English) + date** against the bulk list returned by `/get/games`. Never match by provider `id` — confirmed live that provider `id` does not correspond to our `matchNumber` (provider id=13 is Iran/New Zealand; our matchNumber 13 is Saudi Arabia/Uruguay).
- Parse provider `finished` ("TRUE"/"FALSE" string) and `time_elapsed` ("notstarted", "finished", or any other value defensively treated as "live") into our three-value `status` enum: `scheduled` / `live` / `final`.
- Parse `home_score`/`away_score` (returned as strings) into numbers before comparing/writing.
- Keep the existing diff-before-write behavior: only write to `data/fixtures.json` and append an audit entry when status or score actually changed versus the current stored value (mirrors `fixture_updated` shape from `server.js:440-477`, using the distinct `fixture_synced` action, as already implemented).
- Replace `lib/sportmonks-team-map.js` content with a Spanish-to-English team name lookup table (no ids — the provider returns names directly, so no id resolution step exists in the new flow).
- Replace `lib/sportmonks-states.js` content with a `time_elapsed`/`finished` string parser (no state-id table — this provider has no numeric state ids).
- Rewire `server.js` to start the new sync module instead of `startSportmonksSync`, with an activation mechanism that doesn't depend on an API token (see Decision 2 below).
- Recommended renames for clarity (see Decision 1): `lib/sportmonks-sync.js` -> `lib/worldcup-sync.js`, `lib/sportmonks-team-map.js` -> `lib/team-name-map.js`, `lib/sportmonks-states.js` -> `lib/match-status-map.js`.

### Out of scope (non-goals)

Carried over unchanged from the original SportMonks proposal:
- Lineups, player stats, odds, news, or any data beyond score + status.
- UI changes — sync writes to the same `fixtures.json` shape the UI already renders.
- Historical backfill of already-played matches outside the live World Cup window.
- A multi-provider abstraction layer (adapter pattern, provider registry, etc.) — this is a direct swap, not a pluggable system.
- Removing or restricting the manual `PUT /api/fixtures/:id` override — it remains the admin fallback when the automated sync is wrong, missing, or not yet applicable (knockout placeholders).

New for this change:
- **No persisted external id of any kind.** Neither the old `sportmonksFixtureId` concept nor a new `worldcup2026Id` field gets stored on our fixture records. Matching is recomputed by name + date every cycle, since the provider's own ids are unstable/unreliable for our purposes (confirmed: id does not map to matchNumber, and there's no guarantee ids stay stable across provider updates).
- Knockout-stage fixtures (`m-073`..`m-104`, currently holding placeholder names like "2A", "W74") are not synced. They have no resolvable real team name yet, so name-matching cannot succeed; they remain admin-managed via the manual override exactly as they are today, until an admin resolves the real team names post-group-stage.

## Approach

1. **Bulk fetch over per-fixture fetch.** The `/get/game/{id}` singular endpoint is confirmed broken/unreliable; `/get/games` returns the full 104-match list in one request, trivially within the provider's 500 req/60s rate limit at a 60s cadence. This is also structurally simpler than SportMonks' per-fixture-per-cycle approach, since one fetch per cycle replaces N fetches.
2. **Name+date matching, not id matching**, because the two datasets (ours from fixturedownload, theirs independently assigned) do not share match ordering. This is the only viable approach, not a defensive fallback — id matching is confirmed wrong, not just risky.
3. **Reuse the proven sync skeleton** (`runSyncCycle`, diff-before-write, per-fixture try/catch, `fixture_synced` audit action) from `lib/sportmonks-sync.js` rather than rewriting the operational plumbing from scratch — only the fetch/match/extract-score/parse-status functions are provider-specific and need rewriting.
4. **String coercion is explicit and required.** The provider returns `finished`, `home_score`, and `away_score` as strings. The new code must `Number()` the scores and string-compare `finished`/`time_elapsed` rather than relying on JS truthiness — this was a known gotcha from exploration and must not regress.
5. **Sync always overwrites on diff**, same policy as the original proposal — there's no "locked after manual edit" semantics. This keeps the mental model simple (provider is source of truth on diff, admin override is a temporary correction that the next sync cycle may overwrite if the provider's data changes). See Decision/Assumption A below — this is carried over unchanged but worth re-confirming given the new provider's unofficial/community-sourced nature (292 stars, ~30 commits, no accuracy disclaimer — same risk category as SportMonks would have been).

## Decisions — resolved

1. **File/branding renaming**: rename to provider-neutral names: `lib/worldcup-sync.js` (engine), `lib/team-name-map.js` (ES->EN names, no ids), `lib/match-status-map.js` (`finished`/`time_elapsed` parser). Old `lib/sportmonks-*.js` files are **deleted**, not kept as references.
2. **Activation/env-var gating**: explicit opt-in flag `WORLDCUP_SYNC_ENABLED=true`. Sync does not start unless this is set, regardless of environment. Logs a clear "sync disabled" message when absent, same convention as the old token gate (boolean flag instead of secret).
3. **Disposition of dead SportMonks code**: **delete completely**. User explicitly required zero remaining SportMonks traces ("asegurate que no quede nada de sportmonks") — this means `lib/sportmonks-sync.js`, `lib/sportmonks-team-map.js`, `lib/sportmonks-states.js` must be removed, AND apply phase must grep the full repo for any other `sportmonks`/`SportMonks`/`SPORTMONKS` string (server.js import line, comments, openspec docs referencing file paths that no longer exist) and clean up all of them as part of this change.

## Assumptions — confirmed by user

- **A. Sync-always-overwrites policy** — **confirmed unchanged**. An admin's manual correction via `PUT /api/fixtures/:id` can be overwritten by the next sync cycle if the provider's data differs. No "locked after manual edit" state.
- **B. Match-failure visibility** — **upgraded from silent-warn-only**: when a fixture's team name can't be matched against the provider's data this cycle, the sync MUST both `console.warn` (for server-side debugging) AND write a new audit log entry (action e.g. `fixture_sync_unmatched`, design phase to define exact name/payload) so admins can see unmatched fixtures from the existing audit UI, not just server logs.
- **C. Knockout fixtures fully out of scope** — **confirmed unchanged**. No sync attempted on `m-073`..`m-104` until admins fill in real team names; no errors/audit entries logged for these (filtered out before matching is attempted, same as today's `isSyncCandidate` pattern — this is an expected exclusion, not a failure).

## Proposal question round — resolved

All 5 questions answered by the user in conversation:
1. Manual-override durability: keep sync-always-overwrites (Assumption A confirmed).
2. Knockout scope: confirmed out of scope (Assumption C confirmed).
3. Match-failure visibility: both console.warn AND audit log entry (Assumption B upgraded).
4. Dead SportMonks code: delete completely, zero traces left (Decision 3).
5. Env-var gating: explicit opt-in flag `WORLDCUP_SYNC_ENABLED` (Decision 2).
