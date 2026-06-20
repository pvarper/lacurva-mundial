# Tasks: Fix prediction lock to respect match status

## 1. Update `isPredictionLocked` (server.js:210-212)
- [x] Change the function body to return `true` when `match.status !== 'scheduled'`
      OR the existing date-buffer condition holds, per the spec
      (`Prediction lock MUST consider match status`,
      `Prediction lock MUST preserve existing date-buffer behavior for scheduled matches`).
- Sequential. No parallelism — single function, single file.

## 2. Static verification
- [x] Run `node --check server.js` and confirm it passes (spec: "`node --check server.js` passes").
- Depends on Task 1. Sequential.

## 3. Manual API verification (no test framework in repo)
- [x] Start the app (`pnpm start`) and exercise `POST /api/predictions`:
  - a match with `status: 'live'` and a future `date` → expect HTTP 423
    (spec: "Submitting a prediction for a live match").
  - a match with `status: 'final'` and a future `date` → expect HTTP 423.
  - a match with `status: 'scheduled'` and kickoff >60s away → expect success (unchanged behavior).
  - a match with `status: 'scheduled'` and kickoff within 60s/past → expect HTTP 423 (unchanged behavior).
- Depends on Task 1. Sequential.

## 4. Diff review and commit
- [x] Confirm `git diff` touches only `server.js` (the `isPredictionLocked` function),
      no frontend files modified (spec constraint: "No frontend files are modified").
- [x] Commit with conventional commit message, e.g.
      `fix(predictions): lock predictions when match status is live or final`.
- Depends on Tasks 1-3. Sequential.

## Review Workload Forecast

- Estimated changed lines: ~5 (one function body, 1 file)
- Chained PRs recommended: No
- 400-line budget risk: Low
- Decision needed before apply: No
