# SportMonks Fixture Sync Specification

## Purpose

Automated background sync of fixture status/scores from SportMonks API into `data/fixtures.json`, reducing manual admin entry during live matches. New capability, no existing spec to delta against.

## Requirements

### Requirement: Team-ID Mapping Table

The system MUST maintain a static translation table mapping each `nombreLocal` (the exact `homeTeam`/`awayTeam` string used in `data/fixtures.json`) to a SportMonks `teamId`. The table lives in a dedicated module (e.g. `lib/sportmonks-team-map.js`) separate from `lib/sportmonks-sync.js`, committed to the repo, fixed for the tournament (no runtime mutation).

The sync MUST NOT crash when a fixture's team name has no mapping entry. It MUST skip that fixture for the current cycle and log a warning identifying the unmapped team name and fixture id.

#### Scenario: Team has a mapping entry
- GIVEN a fixture with `homeTeam: "Argentina"` and the mapping table has `"Argentina" -> 123`
- WHEN the sync cycle processes this fixture
- THEN it resolves teamId 123 and proceeds to query SportMonks

#### Scenario: Team has no mapping entry
- GIVEN a fixture with `homeTeam: "2A"` (placeholder, unresolved knockout slot)
- WHEN the sync cycle processes this fixture
- THEN it logs a warning (e.g. `[sportmonks-sync] no team mapping for "2A", skipping fixture m-073`) and continues to the next fixture without throwing

### Requirement: Polling Cycle

The system MUST poll SportMonks every 60 seconds via `setInterval` (or equivalent timer) started when the server process boots. Each cycle MUST iterate eligible fixtures (see Scope Boundary requirement) and call `GET /football/fixtures/teams/{teamId}/between/{date}/{date}?include=scores` per match, using each team's resolved id and the fixture's match date.

On API error, non-2xx response, network failure, or timeout for an individual fixture's request, the system MUST catch the error, log it, and continue processing remaining fixtures in the same cycle. A failed request for one fixture MUST NOT abort the cycle or crash the server process. The next scheduled cycle (60s later) MUST still fire regardless of prior-cycle failures.

#### Scenario: SportMonks API returns 500 for one fixture
- GIVEN cycle N is running and fixture m-010's request returns HTTP 500
- WHEN the sync processes m-010
- THEN it logs the error, skips updating m-010 this cycle, and continues to fixture m-011
- AND cycle N+1 still starts 60s later

#### Scenario: SportMonks API request times out
- GIVEN a fetch call to SportMonks hangs beyond a reasonable timeout
- WHEN the timeout fires
- THEN the sync aborts that single request, logs it, and the server process remains responsive (no unhandled rejection, no process exit)

### Requirement: state_id to Status Mapping (Pre-Implementation Gate)

The system MUST map SportMonks fixture `state_id` (or equivalent state field) to the app's `status` vocabulary: `scheduled`, `live`, `final` (per `FIXTURE_STATUSES`, server.js:18).

**Pre-implementation task (blocking, MUST complete before coding the mapping)**: the exact numeric `state_id` values for "not started", "in play" (all live sub-states: 1st half, half-time, 2nd half, extra time, etc.), and "finished" MUST be confirmed against SportMonks' official state reference (e.g. `GET /football/states` or current docs) — explore did not pin these values. Do not hardcode guessed IDs.

#### Scenario: Confirmed state_id maps cleanly
- GIVEN the SportMonks state reference has been confirmed and a mapping table exists (e.g. `{1: 'scheduled', 2: 'live', 5: 'final', ...}`)
- WHEN a fixture response contains a known `state_id`
- THEN the sync resolves the correct app status

#### Scenario: Unrecognized state_id received
- GIVEN SportMonks returns a `state_id` not present in the confirmed mapping table
- WHEN the sync processes that fixture
- THEN it logs a warning with the unrecognized `state_id` and fixture id, and skips updating that fixture's status this cycle (does not guess or default silently)

### Requirement: Score and Status Diffing

The system MUST only write to `data/fixtures.json` when the incoming SportMonks data differs from the fixture's current `status`, `homeScore`, or `awayScore`. If all three values are unchanged, the sync MUST skip the write and skip the audit log for that fixture this cycle.

#### Scenario: No change since last poll
- GIVEN fixture m-005 has `status: "live", homeScore: 1, awayScore: 0` and SportMonks returns the same values
- WHEN the sync processes m-005
- THEN no write to fixtures.json occurs and no audit entry is created

#### Scenario: Score changed since last poll
- GIVEN fixture m-005 has `status: "live", homeScore: 1, awayScore: 0` and SportMonks now returns `homeScore: 2, awayScore: 0`
- WHEN the sync processes m-005
- THEN fixtures.json is updated with the new score and an audit entry is recorded

### Requirement: Audit Logging on Transition

The system MUST log a `fixture_synced` audit action (distinct from `fixture_updated`) only when a sync-driven write actually occurs (per the Diffing requirement). The payload MUST mirror the shape used by `fixture_updated` (server.js:465-474): `matchId`, `matchNumber`, `homeTeam`, `awayTeam`, `previousValue` (`{status, homeScore, awayScore}` before the change), `homeScore`, `awayScore`, `status` (new values).

#### Scenario: Status transitions from scheduled to live
- GIVEN fixture m-002 is `status: "scheduled"` and SportMonks reports it has kicked off (`status: "live", homeScore: 0, awayScore: 0`)
- WHEN the sync detects the transition
- THEN it writes the update and records an audit entry with action `fixture_synced`, `previousValue: {status: "scheduled", homeScore: null, awayScore: null}`, and new values reflecting `live`/0/0

#### Scenario: No audit entry on unchanged poll
- GIVEN a poll cycle where diffing finds no changes for any fixture
- WHEN the cycle completes
- THEN zero `fixture_synced` audit entries are written for that cycle

### Requirement: Scope Boundary — Eligible Fixtures Only

The sync MUST skip any fixture whose `homeTeam` or `awayTeam` is a placeholder string (non-real team name, e.g. `"2A"`, `"W74"`, or any value without a team-mapping entry) rather than a resolved real team name. This applies to knockout-stage fixtures (ids m-073 through m-104) until an admin manually resolves the real team names into `fixtures.json`.

#### Scenario: Knockout fixture with unresolved placeholder
- GIVEN fixture m-080 has `awayTeam: "W74"`
- WHEN the sync cycle runs
- THEN m-080 is skipped (logged as unmapped, per Team-ID Mapping requirement) and not queried against SportMonks

#### Scenario: Knockout fixture resolved by admin
- GIVEN fixture m-080's `awayTeam` has been updated by an admin to a real team name present in the mapping table
- WHEN the next sync cycle runs
- THEN m-080 becomes eligible and is processed normally

### Requirement: Manual Override Remains Unprotected

`PUT /api/fixtures/:id` MUST remain fully functional and unchanged in behavior. The sync process MUST NOT check for, set, or respect any "manually edited" flag on a fixture. A sync cycle following a manual edit MUST overwrite the manually-entered `status`/`homeScore`/`awayScore` if SportMonks data differs, exactly as it would for any other fixture.

#### Scenario: Admin manually corrects a score, then sync runs
- GIVEN an admin sets fixture m-003 via PUT to `homeScore: 3, awayScore: 1` and SportMonks data for m-003 says `homeScore: 2, awayScore: 1`
- WHEN the next sync cycle runs
- THEN fixtures.json is overwritten to `homeScore: 2, awayScore: 1` and a `fixture_synced` audit entry is recorded, with no protection or warning about overwriting a manual edit

## Out of Scope

The following are explicitly NOT requirements of this change:
- Lineups, player stats, betting odds, or news feed integration from SportMonks.
- Any UI changes (no new admin controls, no sync-status indicator, no manual "trigger sync now" button).
- Historical backfill of past fixture results.
- Multi-provider abstraction layer (SportMonks-specific code is acceptable).
- Removing or restricting the existing manual `PUT /api/fixtures/:id` path.
- Persisting any `sportmonksFixtureId` per fixture in `data/fixtures.json` (team-id mapping only, per proposal decision 3).
- Resolving knockout-stage placeholder team names (m-073 to m-104) — that remains a manual admin task outside this sync.

Engram topic: `sdd/sportmonks-integration/spec` (observation #2901)
