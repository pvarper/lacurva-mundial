# Tasks: Audit Log Retention and Daily View (#47)

## Resolved Contract Override (read first)

**FINAL CONTRACT** (overrides proposal.md and spec.md wherever they conflict):

`GET /api/audit-log`:
- `date` omitted or invalid format → defaults to **today** (`America/La_Paz`, computed server-side)
- `date=all` → explicit opt-out, returns full history (reversed, newest first)
- `date=YYYY-MM-DD` → returns entries matching that Bolivia-local day (reversed)

This matches `design.md`'s "Decision: `date` query param semantics" section, NOT proposal.md line 36 ("omitting `date` returns full history") or `specs/audit-log-date-filtering/spec.md` lines 20-25 and line 41 (both currently describe absent-date-returns-full-history). Task 6 below fixes that stale wording. `sdd-apply` MUST implement the today-default/`all`-opt-out behavior regardless of what the uncorrected spec text says at apply time.

## Task List

### 1. `server.js` — remove retention cap
- **Spec**: `audit-log-retention` / Requirement: Unbounded Audit Log Persistence
- **Action**: In `recordAuditLog()` (~line 139), change `writeJson('audit-log.json', logs.slice(-1000))` to `writeJson('audit-log.json', logs)`.
- **Parallel**: yes (independent of tasks 2-3)

### 2. `server.js` — add `date` query param handling to `GET /api/audit-log`
- **Spec**: `audit-log-date-filtering` / Requirement: Server-Side Date Query Parameter (with the Task 0 override applied instead of the literal scenario text)
- **Action**:
  - Add/reuse a Bolivia-date helper (`Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' })`) to compute `todayBoliviaDate()` server-side and to convert a log entry's `timestamp` to its Bolivia-local date.
  - In the `GET /api/audit-log` handler (~line 322-325):
    - If `req.query.date === 'all'` → return all logs reversed, no date filtering.
    - Else if `req.query.date` matches `/^\d{4}-\d{2}-\d{2}$/` → filter logs to that Bolivia-local date, reversed.
    - Else (absent or invalid format) → default to server-computed today's Bolivia date, filter, reversed.
- **Depends on**: none (independent of Task 1, but same file — sequence after Task 1 to avoid edit overlap in the same function block)
- **Parallel**: sequential with Task 1 (same file), parallel with Task 3 (different file)

### 3. `lib/worldcup-sync.js` — remove sync audit log calls
- **Spec**: `audit-log-sync-noise-suppression` / Requirement: Fixture Sync Events Excluded From Audit Log
- **Action**:
  - Remove `await recordAuditLog(SYNC_REQUEST_CONTEXT, 'fixture_synced', {...})` in `applyFixtureSync` (~line 112) and its destructured `recordAuditLog` reference (~line 96) if no longer used elsewhere in that function.
  - Remove `await recordAuditLog(SYNC_REQUEST_CONTEXT, 'fixture_sync_unmatched', {...})` in `recordUnmatched` (~line 131) and its destructured `recordAuditLog` reference (~line 125) if no longer used elsewhere in that function.
  - Keep `console.warn` in `recordUnmatched` unchanged.
  - Check `server.js`'s `startWorldcupSync({...})` call (~line 675): if `recordAuditLog` is passed in the `deps` object and nothing in the sync module's call chain (`runSyncCycle` → `syncSingleFixture` → `applyFixtureSync`/`recordUnmatched`) uses it anymore, remove it from `deps` there too.
- **Parallel**: yes (independent file from Tasks 1-2)

### 4. `public/js/app.js` — server-filtered date wiring
- **Spec**: `audit-log-date-filtering` / Requirement: Bitácora Default Date On Load + Requirement: Client-Side Filters Remain Independent of Date
- **Action**:
  - `loadAuditLog()` (~885-888): if `elements.auditDateFilter.value` is empty, set it to `todayBoliviaDate()` first (mirror `loadPredictions()` pattern). Call `api('/api/audit-log?date=' + elements.auditDateFilter.value)`.
  - Wire the date filter's "clear" UX (if one exists) to explicitly send `date=all` rather than omitting the param — confirm during implementation whether a dedicated "clear" control exists or whether clearing the input should re-default to today instead. Either is acceptable; do not let clearing silently omit the param and rely on server default unless that is in fact the desired clear-to-today behavior.
  - `filteredAuditLogs()` (~890-906): remove date-matching logic entirely; keep `username`/`action` filters only, operating on the server-already-filtered set.
- **Depends on**: Task 2 (server endpoint contract must exist first, but can be implemented in parallel and verified together)
- **Parallel**: can be written in parallel with Tasks 1-3; verify together at the end

### 5. Verify `recordAuditLog` deps cleanup didn't break other callers
- **Action**: After Task 3, grep `server.js` and `lib/worldcup-sync.js` for any remaining `recordAuditLog` references to confirm no dangling/unused imports or destructured names remain, and that admin/user-action calls to `recordAuditLog` elsewhere in `server.js` are untouched.
- **Depends on**: Task 3
- **Parallel**: sequential after Task 3

### 6. Correct stale "omit date = full history" wording in proposal.md and spec.md
- **Spec**: cross-cutting — documentation accuracy
- **Action**:
  - `proposal.md` line 36: change "omitting `date` returns full history (admin 'view all' still works)" → "omitting `date` defaults to today's entries (Bolivia time); `date=all` returns full history (admin 'view all' opt-out)".
  - `specs/audit-log-date-filtering/spec.md`:
    - Scenario "Omitting the date parameter returns full history" (lines 20-25): rewrite to "Omitting the date parameter defaults to today" — GIVEN/WHEN/THEN should assert default-to-today behavior, not full-history.
    - Add a new scenario: "Explicit `date=all` returns full history" mirroring the removed scenario's intent but gated on the explicit `all` value.
    - Line 41 ("date filter input MUST be pre-populated with today's date") is already consistent with the override — no change needed there, just confirm after editing the other scenario.
- **Depends on**: none, but should land in the same PR as Tasks 1-4 so docs and code never diverge
- **Parallel**: yes, independent of code tasks, but bundle into the same commit/PR per `single-pr` delivery strategy

### 7. Static verification
- **Action**: Run `node --check server.js && node --check lib/worldcup-sync.js`. Both must exit 0.
- **Depends on**: Tasks 1, 2, 3
- **Parallel**: sequential, run after code tasks complete

### 8. Manual verification checklist (no automated test framework exists)
- **Action**, execute and confirm each:
  1. Seed/append >1000 entries to `data/audit-log.json` (or simulate via repeated `recordAuditLog` calls), confirm the file retains all entries after a new write (Task 1 / `audit-log-retention` spec).
  2. `GET /api/audit-log` with no `date` param → confirm response contains only today's (Bolivia time) entries.
  3. `GET /api/audit-log?date=all` → confirm response contains full unfiltered history, reversed.
  4. `GET /api/audit-log?date=2026-06-18` (or any valid past date with seeded entries) → confirm only that day's entries return.
  5. `GET /api/audit-log?date=not-a-date` → confirm it falls back to today's default rather than erroring or returning everything.
  6. Open bitácora view in browser → confirm date filter input pre-populates with today's date and the list shows only today's entries.
  7. Change the date filter to a past date → confirm the list updates to that day only.
  8. Apply username/action filters on top of a date-filtered set → confirm they still narrow correctly.
  9. Run the World Cup sync cycle locally (or trigger `applyFixtureSync`/`recordUnmatched` paths) → confirm no `fixture_synced` or `fixture_sync_unmatched` entries appear in `data/audit-log.json`, and `console.warn` still fires for unmatched cases.
  10. Confirm admin/user actions (e.g., submitting a prediction, editing a user) still write audit log entries normally.
- **Depends on**: Tasks 1-4, 7
- **Parallel**: sequential, final gate before PR

## Parallelization Summary

- **Parallel group A** (can run concurrently): Task 1, Task 3, Task 6
- **Sequential within `server.js`**: Task 1 → Task 2 (same file, same function area)
- **Task 4** can be written in parallel with Tasks 1-3 but its manual verification (Task 8) depends on Task 2's endpoint contract being live
- **Task 5** sequential after Task 3
- **Task 7** sequential after Tasks 1, 2, 3 (static check needs final file state)
- **Task 8** sequential, last — depends on everything

## Review Workload Forecast

- **Estimated changed lines**: ~70-100 total (server.js ~30-40 across two edits, lib/worldcup-sync.js ~15-20 deletions, app.js ~15-25, proposal.md/spec.md doc wording ~10-15)
- **Chained PRs recommended**: No
- **400-line budget risk**: Low
- **Decision needed before apply**: No (delivery_strategy is `single-pr`, confirmed; contract ambiguity is resolved in this document, no further stakeholder input required before `sdd-apply`)
