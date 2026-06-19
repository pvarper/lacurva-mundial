# Tasks: SportMonks Fixture Sync (issue #43)

Single implementer (sdd-apply), single sitting assumed feasible but flagged for
PR-splitting review below (see Review Workload Forecast).

Legend: [S] sequential / blocking, [P] can run in parallel with siblings in
same group once its own prerequisites are met. This is a solo-agent apply, so
[P] mainly means "order between these two doesn't matter," not literal
concurrency.

---

## Group 0 — Pre-implementation data gates (BLOCKING, do first)

### Task 0.1 — Resolve real SportMonks state_id -> status mapping [S]
- Satisfies: spec "Requirement: state_id to Status Mapping (Pre-Implementation Gate)"
- Action: using `SPORTMONKS_API_TOKEN` from `process.env`, call SportMonks'
  `GET /football/states` (or `include=state` on a couple of sample fixtures)
  against the real API to confirm numeric `state_id` values for: not started,
  every live sub-state (1st half, half-time, 2nd half, extra time, penalties,
  etc.), and finished/full-time-equivalent states.
- Requires network access to the real SportMonks API during this task. Do not
  invent or guess values — if the token is unavailable or the call fails,
  STOP this task group and report blocked status rather than hardcoding
  guessed ids.
- Output: a written-down confirmed `{state_id: status}` table to be embedded
  in `lib/sportmonks-states.js` (Task 1.2).
- Estimate: ~0 lines of app code (research/discovery only), 1 API call (or a
  couple), no diff.

### Task 0.2 — Resolve real SportMonks team ids for the team-map table [S]
- Satisfies: spec "Requirement: Team-ID Mapping Table"
- Action: using the real `SPORTMONKS_API_TOKEN`, resolve SportMonks `teamId`
  for every real (non-placeholder) `homeTeam`/`awayTeam` string present in
  `data/fixtures.json` group-stage fixtures (m-001 to m-072 per design scope;
  knockout fixtures m-073-m-104 stay placeholder/skipped, no ids needed for
  those slots). Use SportMonks team search/reference endpoint, not guesses.
- Requires network access to the real SportMonks API. ~32-48 team entries
  expected. If the token is unavailable, STOP and report blocked rather than
  inventing ids.
- Output: confirmed `{nombreLocal: teamId}` pairs to embed in
  `lib/sportmonks-team-map.js` (Task 1.1).
- Estimate: 0 lines of app code (research/discovery only).

**Gate**: Do not proceed to Group 1 file creation with placeholder/fake
values. If 0.1 or 0.2 cannot be completed live, deliver the files with
placeholder constants explicitly marked `// TODO: confirm via live SportMonks
API call` and flag this clearly in the final summary — do not silently ship
guessed numeric ids as if confirmed.

---

## Group 1 — New library files

### Task 1.1 — Create `lib/sportmonks-team-map.js` [P]
- Satisfies: spec "Requirement: Team-ID Mapping Table"
- Depends on: Task 0.2 (real ids) — but file structure can be scaffolded in
  parallel with Task 1.2/1.3 scaffolding; final values depend on 0.2.
- Content: plain object/module exporting `nombreLocal -> teamId`, one entry
  per real team name appearing in `data/fixtures.json` group stage. Comment
  header noting "fixed for the tournament, no runtime mutation."
- Estimate: ~40-55 lines (mostly data, low complexity).

### Task 1.2 — Create `lib/sportmonks-states.js` [P]
- Satisfies: spec "Requirement: state_id to Status Mapping"
- Depends on: Task 0.1 (real state ids).
- Content: `STATE_ID_TO_STATUS` object + exported `mapStateIdToStatus(stateId)`
  function returning `'scheduled' | 'live' | 'final' | null` (null for
  unrecognized ids, per spec scenario "Unrecognized state_id received" — no
  silent default).
- Estimate: ~20-30 lines.

### Task 1.3 — Create `lib/sportmonks-sync.js` (sync engine) [S]
- Satisfies: spec requirements "Polling Cycle", "Score and Status Diffing",
  "Audit Logging on Transition", "Scope Boundary — Eligible Fixtures Only",
  "Manual Override Remains Unprotected".
- Depends on: Tasks 1.1 and 1.2 (imports both maps).
- Content per design:
  - `startSportmonksSync(deps)` / `stopSportmonksSync()` exports.
  - `runSyncCycle(deps)` — iterates fixtures from `readJson('fixtures.json')`,
    calls `isSyncCandidate` per fixture, then `syncSingleFixture` per
    candidate inside a per-fixture try/catch (errors logged + isolated, do
    not abort the cycle — spec "Polling Cycle" scenarios).
  - `isSyncCandidate(match, teamMap)` — true only if both `homeTeam` and
    `awayTeam` have entries in the team map (skips placeholders like `"2A"`,
    `"W74"` per spec "Scope Boundary"), and status is not already `final`
    (design also adds: skip fixtures >1 day in future — confirm this doesn't
    contradict spec; spec doesn't mention a future-date skip explicitly, so
    keep it as a non-functional optimization, not a hard requirement).
  - `syncSingleFixture(match, deps)` — calls
    `GET /football/fixtures/teams/{homeTeamId}/between/{date}/{date}?include=scores;participants`
    with `Authorization` header using `apiToken`. Verify the exact v3 endpoint
    path against the live account's subscription tier during this task (per
    design note) — adjust path if the live API rejects it.
  - `pickMatchingFixture` — sanity-check both home+away participants present
    in the response before treating it as a match for this fixture.
  - `extractCurrentScore` — uses `scores[].description === 'CURRENT'` as the
    sole authoritative score source (even for ET/penalties per design); falls
    back to existing match score if a side's CURRENT entry is missing.
  - `applyFixtureSync(match, newStatus, newHomeScore, newAwayScore, deps)` —
    re-reads `fixtures.json` defensively (avoid stale overwrite if something
    else wrote in between), diffs `status`/`homeScore`/`awayScore` against
    current values, writes via `writeJson` only on diff (spec "Score and
    Status Diffing"), and on write calls
    `recordAuditLog({ session: {}, ip: 'sportmonks-sync' }, 'fixture_synced', {...})`
    mirroring the exact `fixture_updated` payload shape (matchId,
    matchNumber, homeTeam, awayTeam, previousValue, homeScore, awayScore,
    status) — see server.js:465-474 for the exact shape to mirror.
  - No "manually edited" flag check anywhere (spec "Manual Override Remains
    Unprotected" — sync must always overwrite on diff, no exceptions).
  - Top-level `.catch` on the interval callback as a second safety net beyond
    per-fixture try/catch (design's stated double safety net).
  - Uses built-in global `fetch` (Node >=18 confirmed available, no new
    dependency).
- Estimate: ~110-150 lines. This is the core complexity of the change.

---

## Group 2 — Server wiring

### Task 2.1 — Wire sync into `server.js` [S]
- Satisfies: spec overall activation requirement (polling starts when server
  boots); design's gating on `SPORTMONKS_API_TOKEN`.
- Depends on: Task 1.3.
- Action:
  - Add `const { startSportmonksSync } = require('./lib/sportmonks-sync');`
    near existing requires (~line 7).
  - After `app.listen(PORT, () => {...});` (currently lines 666-668), add a
    guarded call: only start the sync if `process.env.SPORTMONKS_API_TOKEN`
    is set (opt-in, same convention as `SESSION_SECRET` — log a clear message
    if the token is absent rather than silently doing nothing, so an admin
    notices misconfiguration in production).
  - Pass `{ readJson, writeJson, recordAuditLog, apiToken: process.env.SPORTMONKS_API_TOKEN }`
    as `deps`.
  - No changes to `PUT /api/fixtures/:id` route — confirm it remains fully
    intact (spec "Manual Override Remains Unprotected" applies to the route
    too, not just the sync side — this task is a no-op verification + the
    wiring addition only).
- Estimate: ~10-15 lines added to server.js. Low complexity, high blast-radius
  awareness (touches the main server file, but the diff itself is small and
  additive only — no existing lines change).

---

## Group 3 — Manual verification (no test framework exists)

### Task 3.1 — Static checks [S]
- `node --check server.js`
- `node --check lib/sportmonks-sync.js`
- `node --check lib/sportmonks-team-map.js`
- `node --check lib/sportmonks-states.js`
- Estimate: 0 lines, mechanical.

### Task 3.2 — Manual boot test without token [S]
- Run `pnpm start` with `SPORTMONKS_API_TOKEN` unset.
- Confirm server boots normally, logs the "sync disabled / token not set"
  message, no crash, existing routes (login, fixtures, predictions) still
  work as before.
- Estimate: 0 lines, manual run.

### Task 3.3 — Manual boot test with real token, observe one sync cycle [S]
- Depends on: Tasks 0.1, 0.2 having produced real values (or explicitly
  flagged placeholders).
- Run `pnpm start` with a real `SPORTMONKS_API_TOKEN` set.
- Watch logs for ~60-120s, confirm at least one sync cycle runs without
  throwing, confirm skip-logging fires correctly for knockout/placeholder
  fixtures (m-073 to m-104) and for any team-map misses.
- If a live match exists with a real score difference, confirm
  `data/fixtures.json` updates and `data/audit-log.json` gains a
  `fixture_synced` entry with the correct payload shape (compare against an
  existing `fixture_updated` entry for shape parity).
- If no live match is available at test time, this step degrades to
  "confirm no crash + skip-logging is correct" — full diff/write/audit path
  verification gets deferred to first live usage post-merge; note this
  explicitly in the apply report, do not block on it.
- Estimate: 0 lines, manual run + log/file inspection.

### Task 3.4 — Manual regression check on `PUT /api/fixtures/:id` [S]
- Manually exercise the admin manual-edit endpoint while the sync is running,
  confirm it still works exactly as before (no new validation, no "manually
  edited" flag), and confirm a subsequent sync cycle can still overwrite that
  manual edit per spec ("Manual Override Remains Unprotected").
- Estimate: 0 lines, manual run.

---

## Group 4 — Git hygiene / commit

### Task 4.1 — Review diff and commit [S]
- `git status`, review diff for `data/audit-log.json`/`data/fixtures.json`
  dirtiness from manual testing (per CLAUDE.md gotcha) — do NOT commit
  runtime-dirty `data/audit-log.json` unless the task explicitly requires it;
  revert/exclude test-generated entries if testing dirtied these files.
- Conventional commit message, e.g.
  `feat(sync): add SportMonks fixture polling sync (#43)`.
- Estimate: 0 lines beyond what's already authored.

---

## Review Workload Forecast

- Estimated total new/changed lines: ~180-250
  - `lib/sportmonks-team-map.js`: ~40-55
  - `lib/sportmonks-states.js`: ~20-30
  - `lib/sportmonks-sync.js`: ~110-150
  - `server.js` wiring: ~10-15
- **400-line budget risk: Low.** Total estimate sits well under 400 even with
  generous padding on the sync engine.
- **Chained PRs recommended: No**, based on line count alone. However, flag
  one risk factor: Group 0 (live API discovery for team ids and state ids) is
  the one part of this work that cannot be fully scripted/predicted ahead of
  time — if the live SportMonks API turns out to require a different v3 path,
  different auth scheme, or additional pagination for team search, Group 1.3
  could grow beyond the estimate. This is a research-uncertainty risk, not a
  size risk per se.
- **Decision needed before apply: No** for plain size reasons. Per
  `delivery_strategy: ask-on-risk`, no STOP is triggered by line count. The
  one thing worth surfacing to the user before apply: Group 0 requires a live
  `SPORTMONKS_API_TOKEN` and real network access during the apply session —
  if that's not available right now, apply should stop after scaffolding with
  explicit placeholder markers rather than inventing ids, and a follow-up
  apply pass will be needed once the token/network access is available.
- **chain_strategy: not needed** — recommend single PR, single commit (or a
  couple of small work-unit commits: one for Group 0+1 data/library files,
  one for Group 2 wiring) given the low line count and tight coupling between
  the sync engine and its two data tables.

## Task Dependency Summary

```
0.1 ──┐
      ├─> 1.2 ──┐
0.2 ──┤         ├─> 1.3 ──> 2.1 ──> 3.1 ──> 3.2 ──> 3.3 ──> 3.4 ──> 4.1
      └─> 1.1 ──┘
```
