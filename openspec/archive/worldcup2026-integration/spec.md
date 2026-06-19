# Spec: worldcup2026-integration (issue #43)

Delta spec for replacing the dead-end SportMonks fixture-sync integration with the
`worldcup2026` provider (`https://worldcup26.ir`). This document describes WHAT must be
true after the change is applied. It does not prescribe internal implementation details
beyond what's needed to make a requirement verifiable.

No automated test framework exists in this repo. Each scenario below must be verifiable
by a human through one of: reading the code, running the server with controlled env vars,
inspecting `data/fixtures.json` / `data/audit-log.json` after a cycle, or `rg`/`grep`-style
repo search. Verification notes are included per requirement.

---

## Requirement 1: Team-name mapping table (ES -> EN, no ids)

The system MUST provide a Spanish-to-English team name lookup covering all group-stage
teams (approximately 32-48 entries depending on confirmed qualifiers), with no team-id
concept anywhere in the table. An unmapped team name MUST NOT crash the sync cycle; it
MUST be skipped, logged via `console.warn`, and recorded as an audit log entry (see
Requirement 7).

### Scenario 1.1: Known team name resolves
- **Given** a local fixture with `homeTeam: "España"`
- **When** the mapping table is queried for `"España"`
- **Then** it returns the English name `"Spain"` (or the provider's exact English string for that team), with no id field involved at any point.

### Scenario 1.2: Unmapped team name does not crash the cycle
- **Given** a local fixture with a team name not present in the mapping table (e.g. a future qualifier added to fixtures.json before the map is updated)
- **When** `runSyncCycle` processes that fixture
- **Then** the cycle does not throw or abort, the fixture is skipped, a `console.warn` line identifying the unmapped name and fixture id is emitted, and an audit log entry is recorded (per Requirement 7) — and processing continues for all other fixtures in the same cycle.

**Verification**: read `lib/team-name-map.js` for entry count and structure (no id fields); temporarily remove or rename one entry, run the server with `WORLDCUP_SYNC_ENABLED=true`, and confirm the warn line + audit entry appear without a server crash, and other fixtures still sync.

---

## Requirement 2: Bulk polling cycle (60s, single GET, isolated failures)

The system MUST poll `GET https://worldcup26.ir/get/games` exactly once per 60-second
cycle (not once per fixture). A failure while processing one fixture's match record MUST
NOT prevent the remaining fixtures in the same cycle from being processed. A failure in
the cycle as a whole (e.g. the HTTP request itself throws) MUST be caught by a top-level
safety net so the interval keeps running on the next tick.

### Scenario 2.1: Single bulk request per cycle
- **Given** the sync is enabled and running
- **When** one 60-second interval tick fires
- **Then** exactly one HTTP request is made to `GET https://worldcup26.ir/get/games`, and all local sync-candidate fixtures are matched against the single returned list — not one request per fixture.

### Scenario 2.2: Per-fixture error isolation
- **Given** the bulk response was fetched successfully, and one fixture's match/parse logic throws (e.g. malformed score string)
- **When** `runSyncCycle` iterates over sync-candidate fixtures
- **Then** the error for that one fixture is caught and logged (`console.error`, mirroring the existing per-fixture try/catch pattern), and the loop continues to process all remaining fixtures in the same cycle.

### Scenario 2.3: Top-level cycle failure does not kill the interval
- **Given** the `GET /get/games` request itself fails (network error, non-2xx status)
- **When** that cycle's `runSyncCycle` call rejects
- **Then** the rejection is caught at the interval-callback level (`console.error`, same convention as the existing `startSportmonksSync`/equivalent wiring), and the `setInterval` continues to fire on subsequent ticks — the sync does not permanently stop because of one bad cycle.

**Verification**: read `lib/worldcup-sync.js` for a single `fetch` call per `runSyncCycle` invocation, a try/catch around each per-fixture sync call inside the loop, and a `.catch()` (or equivalent) wrapping the `runSyncCycle(deps)` call passed to `setInterval`. Optionally run locally with a forced bad fixture (e.g. inject a malformed local fixture record) and confirm the rest of `data/fixtures.json` still updates on the next cycle.

---

## Requirement 3: Name + date matching (never by provider id)

Each local fixture MUST be matched against the provider's bulk list using translated
team name (ES->EN) plus date — the provider's `id` field MUST NOT be used at any point
in the matching logic, since it is confirmed not to correspond to local `matchNumber`.

### Scenario 3.1: Match succeeds by name+date, ignoring id
- **Given** a local fixture for "Arabia Saudita" vs "Uruguay" on a known date, and the provider's bulk response contains a match record with `home_team_name_en: "Saudi Arabia"`, `away_team_name_en: "Uruguay"`, `local_date` equal to that date, and some `id` value unrelated to the local `matchNumber`
- **When** the matching function runs
- **Then** it finds this record using only translated team name + date, and the provider's `id` field is never read or compared anywhere in the matching code path.

### Scenario 3.2: id mismatch does not cause a false match or a missed match
- **Given** the provider's `id` for a given record numerically coincides with an unrelated local `matchNumber` (the confirmed real-world case: provider id=13 is Iran/New Zealand, local matchNumber 13 is Saudi Arabia/Uruguay)
- **When** the sync processes local fixture matchNumber 13
- **Then** it matches against the provider record for Saudi Arabia vs Uruguay by name+date (not the Iran/New Zealand record with id=13), proving id is irrelevant to the outcome.

### Scenario 3.3: Ambiguous same-day same-name-pair match (documented assumption)
- **Given** the World Cup 2026 group stage is a single round-robin format where two teams play each other at most once during the group stage on a given matchday
- **When** designing the matching function
- **Then** the system assumes at most one provider record will match a given (translated-name-pair, date) combination; if a future data anomaly produces two or more candidate records for the same name-pair + date, the matching function MUST NOT silently pick an arbitrary one — it MUST treat this as a failed/ambiguous match, `console.warn`, and audit-log it the same way as an unmatched fixture (Requirement 7), rather than guessing.

**Verification**: read `lib/worldcup-sync.js` matching function — confirm no reference to `fixture.id`/`game.id`/provider `id` field anywhere in comparison logic; confirm the function signature/logic keys only on translated name fields + date fields. For 3.3, confirm there's an explicit guard (e.g. `candidates.length !== 1` check) rather than `.find()` silently returning the first of several matches with no detection.

---

## Requirement 4: finished/time_elapsed -> status parsing

The provider's `finished` field (string `"TRUE"`/`"FALSE"`) and `time_elapsed` field MUST
be parsed into the local three-value status enum: `scheduled`, `live`, `final`. The only
confirmed `time_elapsed` values are `"notstarted"` and `"finished"`; any other string
value MUST be defensively treated as `"live"` — this is a stated assumption, not a
confirmed live-state mapping, since no live match was observed during exploration.

### Scenario 4.1: Not started maps to scheduled
- **Given** a provider record with `finished: "FALSE"` and `time_elapsed: "notstarted"`
- **When** the status parser runs
- **Then** it returns local status `"scheduled"`.

### Scenario 4.2: Finished maps to final
- **Given** a provider record with `finished: "TRUE"` and `time_elapsed: "finished"`
- **When** the status parser runs
- **Then** it returns local status `"final"`.

### Scenario 4.3: Any unrecognized time_elapsed value defaults to live (defensive assumption)
- **Given** a provider record with `finished: "FALSE"` and `time_elapsed` equal to any value other than `"notstarted"` or `"finished"` (e.g. a minute-clock string, half-time marker, or any other in-play signal not seen during exploration)
- **When** the status parser runs
- **Then** it returns local status `"live"`, and this behavior is documented in `lib/match-status-map.js` as a defensive assumption pending observation of a real in-play match from this provider.

**Verification**: read `lib/match-status-map.js` for a parser function covering exactly these three branches (exact match on `"notstarted"`, exact match on `"finished"`, default/else branch returning `"live"`); confirm no numeric state-id table exists (per the proposal, this provider has no state ids, unlike SportMonks).

---

## Requirement 5: Score string-to-number coercion

The provider's `home_score`/`away_score` fields (returned as strings, possibly `null` or
absent for not-yet-started matches) MUST be coerced to numbers (or `null`) before being
compared against locally stored scores or written to `data/fixtures.json`. String values
MUST NOT be written directly, and string-vs-number comparison bugs (e.g. `"2" !== 2`)
MUST NOT cause spurious diffs or missed diffs.

### Scenario 5.1: String scores are coerced to numbers before writing
- **Given** a provider record with `home_score: "2"`, `away_score: "1"`
- **When** the sync extracts and applies the score
- **Then** the values written to `data/fixtures.json` are the numbers `2` and `1`, not the strings `"2"` and `"1"`.

### Scenario 5.2: finished string comparison does not rely on truthiness
- **Given** a provider record with `finished: "FALSE"` (a non-empty, truthy JS string)
- **When** the status logic evaluates this field
- **Then** it explicitly string-compares against `"TRUE"`/`"FALSE"` rather than using JS truthiness (`if (finished)` would incorrectly evaluate `"FALSE"` as truthy) — confirming the known gotcha from exploration does not regress.

**Verification**: read the score-extraction and status-parsing code for explicit `Number(...)` calls on score fields and explicit string equality checks (`=== 'TRUE'`, `=== 'notstarted'`, etc.) rather than bare truthiness checks. Optionally instrument a manual test: feed a mock provider record with string scores into the relevant function and confirm `typeof result.homeScore === 'number'`.

---

## Requirement 6: Diff-before-write (only write/audit on actual change)

The sync MUST only write to `data/fixtures.json` and append an audit entry when the
fixture's `status`, `homeScore`, or `awayScore` actually differ from the currently stored
values after coercion. Cycles where the provider returns the same already-stored values
MUST NOT produce a write or an audit entry.

### Scenario 6.1: No-op cycle when nothing changed
- **Given** a local fixture already has `status: "final"`, `homeScore: 2`, `awayScore: 1` stored, and the provider's record (after coercion) resolves to the identical values
- **When** the sync cycle processes this fixture
- **Then** no write to `data/fixtures.json` occurs for this fixture and no `fixture_synced` audit entry is recorded.

### Scenario 6.2: Write + audit occurs only when a value actually changed
- **Given** a local fixture has `status: "live"`, `homeScore: 1`, `awayScore: 0` stored, and the provider's record (after coercion) resolves to `status: "final"`, `homeScore: 2`, `awayScore: 1`
- **When** the sync cycle processes this fixture
- **Then** `data/fixtures.json` is updated with the new values, and exactly one `fixture_synced` audit entry is recorded capturing both the previous and new values.

**Verification**: run the server with `WORLDCUP_SYNC_ENABLED=true` against live or mocked provider data across two consecutive cycles where nothing changes between them; confirm `data/audit-log.json` gains no new `fixture_synced` entries for unchanged fixtures, and confirm `data/fixtures.json`'s file mtime / git diff shows no spurious rewrites when values are identical.

---

## Requirement 7: Audit logging for successful syncs and failed matches

Two distinct audit-worthy events MUST be logged, both via `console.warn`/`console.error`
AND an audit log entry (not console-only):

1. **Successful sync** (existing behavior, restated): action `fixture_synced`, recorded when a real diff was applied (Requirement 6, Scenario 6.2), with `matchId`, `matchNumber`, `homeTeam`, `awayTeam`, `previousValue`, new `homeScore`/`awayScore`/`status` — same shape as the existing `fixture_updated` action used by the manual PUT route.
2. **Failed match for a real (non-placeholder) team**: a new audit action (e.g. `fixture_sync_unmatched`) recorded when a fixture that IS a valid sync candidate (real team names, not knockout placeholders) could not be matched against the provider's bulk list this cycle, for any reason — unmapped team name (Requirement 1), ambiguous match (Requirement 3.3), or simply absent from the provider's response.

### Scenario 7.1: Successful sync produces fixture_synced audit entry
- **Given** Scenario 6.2's setup (a real diff applied)
- **When** the write completes
- **Then** `data/audit-log.json` contains a new entry with action `fixture_synced` and the fields listed above.

### Scenario 7.2: Unmatched real-team fixture produces console.warn AND an audit entry
- **Given** a local fixture with real (non-placeholder) team names that has no corresponding record in the provider's bulk response this cycle (e.g. provider temporarily omits a match, or the team name mapping is stale)
- **When** the sync cycle attempts to match this fixture
- **Then** a `console.warn` line identifies the fixture and the reason (no match found), AND a new audit log entry with the unmatched-fixture action is recorded — both must happen, console-only is not sufficient (this is an explicit upgrade from the original SportMonks console-only-warn behavior).

### Scenario 7.3: Unmatched audit entries are visible through the existing audit UI/API
- **Given** one or more `fixture_sync_unmatched` (or equivalently named) entries exist in `data/audit-log.json`
- **When** an admin views the audit log through the existing audit API/UI
- **Then** these entries appear alongside other audit actions (e.g. `fixture_updated`, `fixture_synced`) using the existing audit log rendering — no separate admin surface needs to be built for this requirement to be satisfied.

**Verification**: force an unmatched scenario (rename a local fixture's team to something absent from `lib/team-name-map.js`, or run with a fixture whose date doesn't match any provider record), run a cycle, then inspect `data/audit-log.json` for the new action and check the running server's stdout for the corresponding `console.warn`. Separately confirm the existing audit log viewer in the app renders the new action without special-casing (or note here if it requires a minimal label/icon addition — that's a design-phase concern, not a spec violation either way as long as the entry is visible/readable).

---

## Requirement 8: Scope boundary — knockout placeholders skipped silently

Knockout-stage fixtures (`m-073`..`m-104`, currently holding placeholder team names such
as `"2A"`, `"W74"`) MUST be excluded from sync candidacy entirely. This exclusion MUST
NOT produce any `console.warn`, `console.error`, or audit log entry — it is expected,
not a failure, and must be clearly distinguished from Requirement 7's failed-match case
(which applies only to fixtures with real, resolvable team names that nonetheless fail
to match this cycle).

### Scenario 8.1: Placeholder-named fixtures are filtered out before matching is attempted
- **Given** a fixture `m-073` with `homeTeam: "2A"` (a placeholder, not a real team name)
- **When** `runSyncCycle` builds its list of sync candidates
- **Then** `m-073` is excluded from the candidate list before any name-matching, lookup, or warn/audit logic runs — no warn line and no audit entry are produced for this fixture, this cycle or any cycle, until an admin replaces the placeholder with a real team name.

### Scenario 8.2: Distinguishing placeholder-skip from real-team-unmatched
- **Given** one knockout placeholder fixture (`m-073`, name `"2A"`) and one group-stage fixture with a real but currently-unmappable team name in the same cycle
- **When** the cycle runs
- **Then** only the real-team-unmatched fixture produces a `console.warn` + audit entry (per Requirement 7); the placeholder fixture produces neither, confirming the candidate filter (not the matching/warn logic) is what excludes placeholders.

**Verification**: read the sync-candidate filter function (the new equivalent of `isSyncCandidate`) and confirm it excludes `m-073`..`m-104` (or equivalently, excludes any fixture whose team name fails a "looks like a placeholder" or "is in the known group-stage fixture id range" check) before the name-matching/lookup code executes. Run a cycle and confirm `data/audit-log.json` and stdout show zero mentions of these fixture ids.

---

## Requirement 9: Manual override remains the unprotected fallback (unchanged)

The existing `PUT /api/fixtures/:id` route MUST remain unchanged in behavior: an admin
can manually set status/score for any fixture at any time, and the sync (when enabled)
MUST overwrite that manual value on its next diff cycle if the provider's data for that
fixture differs from what was manually set. There is no "locked after manual edit" state.

### Scenario 9.1: Manual edit is preserved until the next differing sync cycle
- **Given** an admin manually sets a fixture's score via `PUT /api/fixtures/:id` to a value that currently matches the provider's data
- **When** the next sync cycle runs and the provider's data still resolves to the same value
- **Then** no overwrite occurs (per Requirement 6, this is a no-diff no-op) and the manually set value remains exactly as the admin left it.

### Scenario 9.2: Manual edit is overwritten if the provider's data later differs
- **Given** an admin manually sets a fixture's score to a value that differs from what the provider currently reports
- **When** the next sync cycle runs
- **Then** the sync overwrites the admin's manual value with the provider's value (treated as a normal diff per Requirement 6), and this is expected behavior, not a bug — the manual override is a temporary correction, not a permanent lock.

**Verification**: manually `PUT` a fixture to a value known to differ from the live/mocked provider response, wait for one sync cycle (or trigger `runSyncCycle` directly), and confirm the manual value is overwritten with the provider's value and a `fixture_synced` audit entry is recorded for that overwrite.

---

## Requirement 10: Activation gated by WORLDCUP_SYNC_ENABLED

The sync MUST NOT start unless the environment variable `WORLDCUP_SYNC_ENABLED` is set
to the exact string `"true"`. Any other value (absent, `"false"`, `"1"`, empty string,
etc.) MUST result in the sync not starting, with a clear log message explaining why.

### Scenario 10.1: Sync starts when the flag is exactly "true"
- **Given** the server starts with `WORLDCUP_SYNC_ENABLED=true` in the environment
- **When** the server boots
- **Then** the sync module starts its 60-second polling interval, logging a clear "starting sync" message.

### Scenario 10.2: Sync does not start when the flag is absent or any other value
- **Given** the server starts with `WORLDCUP_SYNC_ENABLED` unset, or set to any value other than the exact string `"true"` (e.g. `"false"`, `"1"`, `"yes"`)
- **When** the server boots
- **Then** the sync module does not start its interval, and a clear log message states the sync is disabled and why (mirroring the existing `SPORTMONKS_API_TOKEN not set, sync disabled` convention, adapted to the new boolean-flag gate).

**Verification**: start the server with and without the env var set (and with a wrong value like `WORLDCUP_SYNC_ENABLED=1`) and confirm via stdout logs and absence/presence of any sync-cycle activity (no `GET /get/games` requests, no audit entries) whether the sync actually started.

---

## Requirement 11: Zero SportMonks residue in the repository

After this change, no file, import statement, comment, variable name, environment
variable reference, or any other string containing `sportmonks`, `SportMonks`, or
`SPORTMONKS` (case-insensitive) MUST remain anywhere in the repository's active source
tree — this includes but is not limited to `lib/sportmonks-sync.js`,
`lib/sportmonks-team-map.js`, `lib/sportmonks-states.js` (all deleted), the `server.js`
import/wiring lines, and any code comments referencing the old provider. This requirement
applies to the live source tree (`server.js`, `lib/`, `public/`, root config files); it
does not require deleting historical OpenSpec change records for the prior
`sportmonks-integration` change, which remain as an audit trail of past work, not active
source.

### Scenario 11.1: No sportmonks files remain in lib/
- **Given** the change is applied
- **When** `lib/` is listed
- **Then** `sportmonks-sync.js`, `sportmonks-team-map.js`, and `sportmonks-states.js` do not exist; `worldcup-sync.js`, `team-name-map.js`, and `match-status-map.js` exist in their place.

### Scenario 11.2: server.js has no sportmonks references
- **Given** the change is applied
- **When** `server.js` is searched (case-insensitive) for `sportmonks`
- **Then** zero matches are found — the import and wiring now reference the new `worldcup-sync` module exclusively.

### Scenario 11.3: Repo-wide case-insensitive search of active source returns zero matches
- **Given** the change is applied
- **When** a case-insensitive search for `sportmonks` is run across `server.js`, `lib/`, `public/`, and root-level config/docs files (`package.json`, `README.md`, `CLAUDE.md`, `docs/`)
- **Then** zero matches are found in any of those locations. (Pre-existing historical artifacts under `openspec/changes/sportmonks-integration/` are explicitly out of scope for this requirement — they document past work and are not part of the active source tree.)

**Verification**: run a case-insensitive repo search (e.g. `rg -i sportmonks` excluding `openspec/changes/sportmonks-integration/`) and confirm zero results. This is the literal acceptance check the user explicitly demanded.

---

## Requirement 12: Out of scope (non-goals, restated for completeness)

The following are explicitly NOT required by this change and MUST NOT be treated as
missing requirements during verification:

- Lineups, player stats, odds, news, or any data beyond score + status.
- Any UI changes — the sync writes to the same `fixtures.json` shape the UI already renders; no new admin screens, badges, or views are required.
- Historical backfill of matches that occurred before this sync was enabled.
- A multi-provider abstraction layer (adapter pattern, provider registry, pluggable sync sources) — this is a direct one-to-one provider swap.
- Removing or restricting the manual `PUT /api/fixtures/:id` override (it remains, per Requirement 9).
- Persisting any external id (`sportmonksFixtureId`, `worldcup2026Id`, or equivalent) on fixture records — matching is recomputed by name+date every cycle (per Requirement 3), nothing is cached or persisted.

### Scenario 12.1: No external id field appears on fixture records
- **Given** the change is applied and the sync has run at least one cycle
- **When** `data/fixtures.json` is inspected
- **Then** no fixture record contains any new id-like field referencing the provider (no `worldcup2026Id`, no `externalId`, no `providerId`) — the only persisted fields are the pre-existing ones (`id`, `matchNumber`, `homeTeam`, `awayTeam`, `homeScore`, `awayScore`, `status`, date fields, etc.).

**Verification**: diff `data/fixtures.json`'s schema before and after the sync runs; confirm no new fields were added to any fixture record.
