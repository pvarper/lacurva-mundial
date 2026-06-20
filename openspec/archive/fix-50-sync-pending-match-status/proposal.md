# Proposal: Sync Pending Match Status (#50)

## Problem Statement

Matches that have not started yet ("scheduled" / `time_elapsed: "notstarted"` from the provider) display "0 - 0" in the frontend instead of "Pendiente". The provider sends placeholder score strings (`"0"`) for not-yet-started matches; `parseScore()` in `lib/worldcup-sync.js` calls `Number(record.home_score)` unconditionally, turning that placeholder into a real `0`, indistinguishable from an actual 0-0 result. `applyFixtureSync()` then writes that `0`/`0` straight into `data/fixtures.json` with no status-aware guard. The frontend (`public/js/app.js`) decides "Pendiente" vs. showing a score purely by `homeScore !== null` — it never checks `status` — so once a `0` lands in the data, the UI shows it as a finished/live score.

This is already live and visible: fixtures `m-033` and `m-034` in `data/fixtures.json` have `status: "scheduled"` with `homeScore: 0, awayScore: 0`, showing "0 - 0" to users for matches that haven't kicked off.

## Intent

Ensure scheduled (not-started) matches always have `homeScore: null` and `awayScore: null`, so the existing frontend convention (`homeScore !== null` → show score, else "Pendiente") works correctly without any frontend changes. Fix the sync pipeline going forward, and correct the currently polluted data immediately rather than waiting for the next sync cycle to (possibly) overwrite it.

## Scope

**In scope:**
- Add a guard inside `applyFixtureSync()` (`lib/worldcup-sync.js`): when the computed `status === 'scheduled'`, force `homeScore = null` and `awayScore = null` before the unchanged-check and before writing to `data/fixtures.json`.
- One-time manual backfill of `data/fixtures.json`: for every fixture currently `status: "scheduled"` with non-null `homeScore`/`awayScore` (confirmed: `m-033`, `m-034`), set both to `null`.

**Out of scope:**
- `PUT /api/fixtures/:id` admin route does not enforce "scheduled implies null score" — a pre-existing, separate gap. Not touched here.
- `parseScore()` stays a pure provider-field parser; no change to its signature or responsibility.
- Any frontend change — `homeScore !== null` is already the correct display convention everywhere score state is rendered.
- The pre-existing "unchanged" dedup bug in `applyFixtureSync` (tracked separately, see #47 follow-up note).

## Approach

1. **Guard in `applyFixtureSync()`** — immediately after `status` is determined (via `parseProviderStatus`) and before the unchanged-check / write:
   ```js
   if (status === 'scheduled') {
     homeScore = null;
     awayScore = null;
   }
   ```
   This is the single persistence decision point in the sync pipeline (confirmed via exploration), so the fix can't be bypassed by any other call path. The existing unchanged-check (`current.homeScore === homeScore`) is safe with `null === null` comparisons, so no further change is needed there.

2. **One-time backfill** — directly edit `data/fixtures.json`, setting `homeScore: null, awayScore: null` for `m-033` and `m-034` (and any other `status: "scheduled"` fixture found with a non-null score at apply time). This is a manual data correction, not a script/migration — the dataset is small and the affected records are already identified.

## Acceptance Criteria

- `applyFixtureSync()` never writes a non-null `homeScore`/`awayScore` for a fixture whose computed status is `scheduled`.
- After backfill, no fixture in `data/fixtures.json` has `status: "scheduled"` with a non-null `homeScore` or `awayScore`.
- Fixtures `m-033` and `m-034` show "Pendiente" in the frontend (verified via `homeScore === null` in the data, which the existing display logic already handles).
- The scheduled → live transition is unaffected: once the provider reports a non-`notstarted` status, real scores flow through normally.
- `node --check server.js` and `node --check lib/worldcup-sync.js` pass.
