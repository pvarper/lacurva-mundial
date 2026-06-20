# Tasks: Sync Pending Match Status (#50)

## Scope Note (read before starting)

The design doc assumed only `m-033` and `m-034` were affected. Direct inspection of
`data/fixtures.json` at task-planning time (2026-06-20) found **40 fixtures**
(`m-033` through at least `m-076`+, confirmed via grep) with `status: "scheduled"` and
`homeScore: 0, awayScore: 0`. The design's own caveat ("re-verify at apply time in case
state drifted") applies — the backfill task below replaces the hardcoded "m-033/m-034"
scope with "all currently-polluted scheduled fixtures, re-enumerated at apply time."
This does not change the code-guard task at all; it only widens task 2's data-edit surface.

## 1. Code guard in `lib/worldcup-sync.js` (sequential, blocks 3)

- [x] 1.1 In `applyFixtureSync()` (around line 94-110), insert the guard immediately
      after `if (!current) return;` (line 100) and before the `unchanged` computation
      (line 102):
      ```js
      if (status === 'scheduled') {
        homeScore = null;
        awayScore = null;
      }
      ```
      Include the inline comment from design.md explaining why (provider sends "0"
      placeholders for not-yet-started matches).
      - Satisfies: spec Requirement "Scheduled Fixtures Persist Null Scores",
        scenarios "Provider sends placeholder score", "Unchanged-check still
        short-circuits", "Scheduled-to-live transition", "Guard does not affect
        non-scheduled statuses".
- [x] 1.2 Confirm no signature change is needed — `homeScore`/`awayScore` are already
      reassignable function parameters (per design's "Interfaces / Contracts" section).
      - Satisfies: spec contract stability (no API/signature change implied).

## 2. Backfill `data/fixtures.json` (sequential, can run in parallel with task 1 — independent files)

- [x] 2.1 Re-enumerate (do not trust the design's "only m-033/m-034" claim) every
      fixture currently matching `status: "scheduled"` AND (`homeScore !== null` OR
      `awayScore !== null`). At planning time this was 40 records (`m-033`–onward);
      re-run the check at apply time since the file may have changed.

      **Deviation (resolved, not a gap):** re-enumeration found the "40 polluted
      fixtures" had no historical footprint — `git log --follow -- data/fixtures.json`
      shows every committed snapshot already had `homeScore: null` for these records.
      The pollution was a live runtime artifact from an already-running `node server.js`
      process polling with the OLD unguarded code. No data backfill commit exists or is
      needed. Old process was killed and restarted with the fixed code; confirmed via
      `node -e` that 0 scheduled fixtures have non-null scores after one sync cycle.
- [x] 2.2 ~~For each matched record, set `homeScore: null` and `awayScore: null`.~~
      N/A — no committed record required edits (see 2.1).
- [x] 2.3 Confirmed no fixture with `status` other than `scheduled` was touched (no
      backfill commit was made at all), and live runtime state now matches the spec.
      - Satisfies: spec Requirement "Existing Scheduled Fixtures With Polluted Scores
        Are Backfilled", scenarios "Known polluted fixtures corrected", "Frontend
        renders backfilled fixtures as pending" — satisfied via runtime self-heal
        rather than a data commit, since git history was never actually polluted.

## 3. Verification (sequential, depends on 1 and 2)

- [x] 3.1 `node --check server.js` and `node --check lib/worldcup-sync.js` — syntax
      sanity per project convention (no test harness exists).
- [x] 3.2 Manually inspect `data/fixtures.json`: grep for `"status": "scheduled"` and
      confirm zero matches have a non-null `homeScore`/`awayScore` alongside them.
- [x] 3.3 Manual/code-path check of `applyFixtureSync()` behavior (no test harness, so
      reason through or exercise via a throwaway script if convenient):
      - scheduled + raw 0/0 in → written record has `null`/`null`.
      - called twice in a row with same scheduled status → second call is a no-op
        (no `writeJson` call), confirming the unchanged-check still short-circuits
        post-fix.
      - status `live` with real scores → scores pass through unmodified.
- [x] 3.4 Load the frontend fixtures view (or reason from `public/js/app.js`'s
      existing `homeScore !== null` convention) and confirm previously-polluted
      fixtures now render "Pendiente", not "0 - 0".
- [x] 3.5 `git diff --check` before committing — confirm only `lib/worldcup-sync.js`
      and `data/fixtures.json` changed, and the diff is the guard + backfill only.

## Review Workload Forecast

- Estimated changed lines: ~10-20 in `lib/worldcup-sync.js` (one guard clause + comment),
  ~80-120 in `data/fixtures.json` (2 lines × ~40 records, data-only diff, low review
  cognitive load — every line is `0` → `null`).
- Total estimated: well under 150 changed lines, comfortably under the 400-line budget.
- Chained PRs recommended: No.
- 400-line budget risk: Low.
- Decision needed before apply: No — single PR, no `size:exception` needed.
- Note for `sdd-apply`: re-verify the exact polluted-fixture count/IDs in task 2.1
  before editing, since the design's hardcoded "m-033/m-034 only" assumption was
  already found stale during task planning (40 affected at last check, not 2).
