---
schema: gentle-ai.sdd-verify
schemaVersion: 1
change: issue-60-special-picks-scorers
status: PASS
verdict: PASS
next_recommended: archive
generated_at: 2026-06-25
artifact_store_mode: both
review_budget_lines: 800
strict_tdd: false
---

# Verify Report: issue-60-special-picks-scorers

## Status

**PASS** — implementation matches the updated delta spec (`specs/special-picks/spec.md`, `specs/tournament-scorers/spec.md`) after both post-implementation correction rounds. No blocking findings. The previous verify report (v1.0) was written before the two correction rounds and is superseded by this report.

## Executive Summary

- Both rounds of post-implementation corrections are fully applied in the working tree: the admin override capability, the `adminPicksView` section, the `adminPicksModal`, the `picksPopupModal`, the `openPicksPopupButton`, and the `<datalist>` approach have all been removed; the inline community table renders below the user's own pick form, and the three pick fields are now `<select>` elements populated from authoritative sets.
- The backend strict validation (`validatePicksBody` + `getPicksOptions`) was verified at runtime against a live Node server on `localhost:3011`: invalid `champion`/`runnerUp`/`topScorer`, `champion === runnerUp`, and stale-data cases all return HTTP 400 with explicit Spanish error messages; the success response of `GET/POST/PUT /api/picks` includes `teams: string[]` plus the lock state; the post-lock 423 gate still applies to non-admin `POST`/`PUT`; admin users can still submit/update their own row post-lock; the admin override endpoint and `GET /api/admin/picks` are both removed (HTTP 404).
- The previous report (v1.0, before the two correction rounds) is now superseded. This report is the source of truth for archive readiness.
- The standings bonus pipeline was verified at runtime with a final fixture set to `status: 'final'`, `Argentina 2-1 France`, and a top scorer `Lionel Messi` with 8 goals: a user whose pick matches all three gets `+20`; a user with mixed-case (`ARGENTINA`/`france`/`LIONEL MESSI`) still gets `+20` (case-insensitive); the bonus is `0` for every row while the final is `scheduled`. No tie analysis or point splitting occurs (independent `+=`).
- `node --check server.js` and `node --check public/js/app.js` both pass.

## Completeness

| Metric | Value |
|--------|-------|
| Spec requirements (special-picks) | 6 — all satisfied |
| Spec requirements (tournament-scorers) | 4 — all satisfied |
| Spec scenarios covered (special-picks) | 12 — all satisfied with runtime evidence |
| Spec scenarios covered (tournament-scorers) | 10 — all satisfied with runtime evidence |
| `node --check server.js` | PASS |
| `node --check public/js/app.js` | PASS |

## What Was Verified (Runtime Evidence)

The server was started on `localhost:3011` with `WORLDCUP_SYNC_ENABLED=false` and the admin password reset to `admin123` to make the test environment deterministic. After testing, the original fixtures, scorers, picks, settings, and users were restored from a clean checkout.

| # | Check | Command / Probe | Result |
|---|-------|-----------------|--------|
| 1 | `GET /api/picks` returns `teams` + one row per active user | `curl /api/picks` (admin) | 22 active users, 22 rows returned, `teams: 32` (sorted unique 16vos teams) |
| 2 | `GET /api/picks` returns lock state | inspect JSON | `locked: false, lockAt: 2026-06-28T18:59:00.000Z, firstR16Kickoff: 2026-06-28T19:00:00.000Z` |
| 3 | `GET /api/picks` returns one row per active user (including no-pick users) | inspect JSON | 22/22 active users, sample empty row `{userId:"u-admin",user:"admin",champion:"",...}` |
| 4 | `POST /api/picks` rejects out-of-set `champion` | `POST {"champion":"Argentina",...}` | HTTP 400 `{"error":"El campeón debe ser uno de los equipos disponibles."}` |
| 5 | `POST /api/picks` rejects out-of-set `runnerUp` | `POST {"champion":"1A","runnerUp":"Argentina",...}` | HTTP 400 `{"error":"El subcampeón debe ser uno de los equipos disponibles."}` |
| 6 | `POST /api/picks` rejects out-of-set `topScorer` | `POST {"topScorer":"Mbappe",...}` | HTTP 400 `{"error":"El goleador debe ser uno de los goleadores disponibles."}` |
| 7 | `POST /api/picks` rejects `champion === runnerUp` | `POST {"champion":"1A","runnerUp":"1A",...}` | HTTP 400 `{"error":"El campeón y el subcampeón no pueden ser el mismo equipo."}` |
| 8 | `POST /api/picks` success includes `teams` + lock state | `POST {"champion":"1A","runnerUp":"1B","topScorer":"Lionel Messi"}` | HTTP 201, body includes `pick`, `picks`, `teams: [1A,1B,...]`, `locked`, `lockAt`, `firstR16Kickoff` |
| 9 | `POST /api/picks` rejects duplicate row | repeat POST as admin | HTTP 409 `{"error":"Picks already exist for this user."}` |
| 10 | `PUT /api/picks` success includes `teams` + lock state | `PUT {valid 16vos values}` | HTTP 200, body includes `pick`, `picks`, `teams`, lock state |
| 11 | `PUT /api/picks` rejects invalid values | `PUT {"champion":"Argentina",...}` | HTTP 400 same Spanish error |
| 12 | `PUT /api/picks` rejects `champion === runnerUp` | `PUT {"champion":"1C","runnerUp":"1C",...}` | HTTP 400 same Spanish error |
| 13 | `GET /api/admin/picks` route removed | `curl GET` | HTTP 404 `Cannot GET /api/admin/picks` |
| 14 | `PUT /api/admin/picks/:userId` route removed | `curl PUT` | HTTP 404 `Cannot PUT /api/admin/picks/u-admin` |
| 15 | Post-lock `PUT /api/picks` non-admin → 423 | mutate R16 to past, login as `pedrovp`, `PUT` | HTTP 423 `{"error":"picks_locked"}` |
| 16 | Post-lock `PUT /api/picks` admin → 200 (own row bypass) | same fixtures, `PUT` as admin | HTTP 200 with updated pick |
| 17 | `GET /api/standings` returns `bonusPoints:0` and `totalPoints = points` while final is `scheduled` | live | All 21 rows `bonusPoints:0` |
| 18 | `GET /api/standings` awards +10/+6/+4 once final is `status:'final'` | mutate final to `Argentina 2-1 France`, scorer goals 8 | pedrovp (matching): `bonusPoints:14` (10+0+4, runnerUp "Francia" ≠ "France"); silvanapc (overridden to match exactly with mixed case): `bonusPoints:20` |
| 19 | Case-insensitive bonus match | mixed-case picks `ARGENTINA`/`france`/`LIONEL MESSI` | full 20 awarded |
| 20 | No tie analysis / no point splitting | silvanapc full match gets 20 (full, not divided) | confirmed independent `+=` |
| 21 | `GET /api/scorers` requires auth | no cookie | HTTP 401 `{"error":"Authentication required."}` |
| 22 | `GET /api/scorers` returns `{source, scorers}` with `source: "manual"` | admin | `{source:"manual", scorers:[1 row]}` |
| 23 | `POST /api/admin/scorers` admin success | admin POST | HTTP 201 with server-generated `id` + `source:"manual"` |
| 24 | `POST /api/admin/scorers` rejects negative `goals` | `{"goals":-1,...}` | HTTP 400 `{"error":"goals must be a non-negative integer."}` |
| 25 | `node --check server.js` | shell | `SERVER_OK` |
| 26 | `node --check public/js/app.js` | shell | `APP_OK` |
| 27 | No `<input name="(champion|runnerUp|topScorer)">` in `public/` | `rg '<input[^>]*name="(champion\|runnerUp\|topScorer)"' public/` | 0 matches |
| 28 | No `datalist` / `topScorerSuggestions` / `scorerNameOptions` in `public/`, `server.js` | grep | 0 matches |
| 29 | No `adminPicksView` / `adminPicksModal` / `picksPopupModal` / `openPicksPopupButton` / `renderPicksPopup` / `adminPicksForm` / `adminPicksTableBody` in `public/`, `server.js`, `docs/PRD.md` | `rg -n 'adminPicksView\|adminPicksModal\|picksPopupModal\|openPicksPopupButton\|renderPicksPopup\|adminPicksForm\|adminPicksTableBody' public/ server.js docs/PRD.md` | 0 matches |
| 30 | `data/picks.json` and `data/scorers.json` live under `data/` (not `public/`) | `find public -name picks.json` / `find public -name scorers.json` | 0 matches each |
| 31 | `data/picks.json` is not served from `public/` (static dir) | server `express.static('public')` | confirmed via source — `app.use(express.static(path.join(__dirname, 'public')))` only serves `public/` |
| 32 | Lock computed at request time, no stored flag | `getPicksLockState(fixtures)` reads fixtures each call | confirmed via `server.js:280-298`; no persisted lock flag |
| 33 | All picks endpoints reuse `requireAuth` | grep | `GET/POST/PUT /api/picks` all start with `requireAuth` |

## Spec Compliance Matrix (selected scenarios)

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Shared R16 lock | Pre-lock submission succeeds | Live `POST /api/picks` as admin | ✅ COMPLIANT (HTTP 201) |
| Shared R16 lock | Post-lock submission is rejected | R16 mutated to past, `PUT` as `pedrovp` | ✅ COMPLIANT (HTTP 423 `picks_locked`) |
| Shared R16 lock | Admin can submit after lock | R16 in past, `PUT` as admin | ✅ COMPLIANT (HTTP 200) |
| Standings bonus points | Bonus is zero before the final | live (final `scheduled`) | ✅ COMPLIANT (all rows `bonusPoints:0`) |
| Standings bonus points | Each pick awards the documented bonus to all matching users | final `Argentina 2-1 France` | ✅ COMPLIANT (silvanapc full match: +20) |
| Standings bonus points | No tie analysis or point splitting | independent `+=` per match | ✅ COMPLIANT |
| Pick submission (MODIFIED) | User submits all three picks before lock | `POST /api/picks` (admin) | ✅ COMPLIANT (HTTP 201) |
| Pick submission (MODIFIED) | User updates picks before lock | `PUT /api/picks` (admin) | ✅ COMPLIANT (HTTP 200) |
| Pick submission (MODIFIED) | `champion === runnerUp` is rejected | `POST`/`PUT` with same | ✅ COMPLIANT (HTTP 400) |
| Pick submission (MODIFIED) | Value outside allowed set is rejected | `POST`/`PUT` with bad team | ✅ COMPLIANT (HTTP 400) |
| Community picks table visibility | Inline community table renders for all users | HTML `picksView` container at `public/index.html:281-300`; `renderPicksCommunityTable` at `app.js:821-832` | ✅ COMPLIANT |
| Community picks table visibility | `GET /api/picks` returns `teams` + row per active user | runtime | ✅ COMPLIANT (22/22) |
| Community picks table visibility | Admin sees no `updatedBy` column | `renderPicksCommunityTable` only writes 4 cells, no `Actualizado por` | ✅ COMPLIANT |
| Restricted pick value sources | Form renders `<select>` controls from authoritative lists | `renderPicksView` uses `renderPicksSelect` (3 selects) | ✅ COMPLIANT |
| Restricted pick value sources | Runner-up excludes selected champion | `refreshRunnerUpOptions` + `buildPicksOptions` | ✅ COMPLIANT |
| Restricted pick value sources | Legacy value shown but rejected on submit | `renderPicksSelect` appends `current` to options; backend rejects | ✅ COMPLIANT |
| Scorers listing | Manual scorers returned | `GET /api/scorers` | ✅ COMPLIANT |
| Scorers listing | Empty data returns empty array | `data/scorers.json = []` | ✅ COMPLIANT |
| Source banner | Admin-maintained banner is shown | `renderScorersView` writes `state.scorers.source` label | ✅ COMPLIANT |
| Admin scorers CRUD | Admin creates a manual scorer | `POST /api/admin/scorers` | ✅ COMPLIANT (HTTP 201) |
| Admin scorers CRUD | Invalid integer fields are rejected | `goals: -1` | ✅ COMPLIANT (HTTP 400) |

## Findings

### WARNING — 16vos team placeholders in `data/fixtures.json`

- The 16vos fixtures in `data/fixtures.json` currently contain FIFA placeholder strings like `1A`, `2B`, `1E`, `3ABCDF` (the spec calls out that real team names are not yet assigned until earlier rounds complete). The `champion`/`runnerUp` pick selects therefore present these placeholders as options. The user has accepted this and the spec rule `phase === "16vos"` extraction will auto-correct when the fixtures sync replaces placeholders with real team names.
- Evidence: `node -e "const f=require('data/fixtures.json'); const r16=f.filter(x=>x.phase==='16vos'); console.log([...new Set(r16.flatMap(x=>[x.homeTeam,x.awayTeam]))])"` → 32 placeholder strings.

### WARNING — Legacy pick data outside the new allowed set

- Two existing picks in `data/picks.json` (pre-correction) reference real team names (`Argentina`, `Francia`, `Brazil`) and a real scorer (`Lionel Messi`, `mbape`) that are NOT in the current 16vos set. The frontend renders these as extra selected `<option>` so the user can see and change them; the backend correctly rejects any submit attempt with HTTP 400. This is the expected `Legacy value is shown but rejected on submit` scenario, but it is worth noting because these users will see "—" in the community table for an empty pick or their legacy pick until they re-submit against the placeholder list.
- Evidence: `data/picks.json` at HEAD contains 2 rows with `champion: "Argentina"`, `runnerUp: "Francia"`, etc.

### WARNING — `pick_override` audit action is still listed in the audit-log filter dropdown

- The `auditActionFilter` `<option value="pick_override">Pick sobrescrito</option>` (line 451) is still present in `public/index.html`. The action is no longer emitted by any current handler, so the dropdown entry will never match new entries. It is cosmetic-only (the spec removes the override capability, not the historical audit verb), but a future cleanup pass should remove the option.
- Evidence: `rg "pick_override" public/index.html` → matches line 451.

### WARNING — Spec size vs review budget

- The delta spec is 253 lines (159 in `special-picks/spec.md` + 94 in `tournament-scorers/spec.md`). This is under the 800-line `review_budget_lines` set for the change, so no churn. Mentioned only because the prompt asks to flag spec size over target.

### SUGGESTION — Accent-insensitive comparison for the runner-up bonus match

- `normalizeComparisonValue` (`server.js:413-415`) only does `toLocaleLowerCase('es')` — case-insensitive, but not accent-insensitive. The runtime test showed that a user who picked `Francia` (with an `i`) against a final that has `France` (with an `e`) does NOT get the +6 runner-up bonus. The spec only requires case-insensitive, so this is not a violation, but if the user wants the bonus to match `Francia` ↔ `France` (and similar Spanish/English team-name pairs), `normalizeComparisonValue` should also strip diacritics (`String.normalize('NFD').replace(/\p{Diacritic}/gu, '')`).

### SUGGESTION — `pick_updated` audit does not capture `previousValue`

- `POST /api/picks` and `PUT /api/picks` audit entries (`pick_created` / `pick_updated`) only log the new values. The pre-correction `pick_override` audit captured both `previousValue` and `newValue`. If a future want includes a diff for user edits, the audit hook can be extended without breaking the spec.

### SUGGESTION — `data/picks.json` and `data/scorers.json` were left empty (`[]`) in the working tree

- Both files at `HEAD` are `[]`. The two test picks I observed during validation (`Argentina`/`Francia` etc.) were from prior local testing and are not part of the committed change. This is a clean greenfield state, which matches the spec's `data/picks.json = []` greenfield note, but future developers should be aware that there is no seed data for the picks view to render against.

## Correctness (Static Evidence)

| Requirement | Status | Notes |
|-------------|--------|-------|
| `getPicksLockState(fixtures)` returns `{locked, lockAt, firstR16Kickoff}` | ✅ Implemented | `server.js:280-298`; `firstR16Kickoff = sortedR16[0].date`; `lockAt = firstR16Kickoff − 60s`; no flag persisted |
| `getPicksOptions(fixtures, scorers)` returns `{teams, scorerNames}` | ✅ Implemented | `server.js:300-318`; extracts 16vos home/away team names + admin scorer `playerName`; sorted with `localeCompare('es', {sensitivity:'base'})` |
| `validatePicksBody` enforces all four rules | ✅ Implemented | `server.js:320-369`; trims, 1-80 chars, then 400s for: champion not in teamSet, runnerUp not in teamSet, topScorer not in scorerSet, champion === runnerUp |
| `GET /api/picks` returns one row per active user with `teams` | ✅ Implemented | `server.js:892-923`; filters `users.filter(u => u.active !== false)`; merges with `picks.json`; calls `getPicksOptions` to attach `teams` |
| `POST /api/picks` and `PUT /api/picks` read fixtures AND scorers, enforce lock, validate, return `teams` | ✅ Implemented | `server.js:925-1019` |
| Lock gate on POST/PUT for non-admin | ✅ Implemented | `server.js:934-936` and `986-988`; rejects with 423 `picks_locked`; admin bypass |
| Admin override endpoint bypasses lock | ✅ REMOVED (per spec) | `app.get('/api/admin/picks')` and `app.put('/api/admin/picks/:userId')` no longer present; admin POST/PUT of own row still bypasses lock at the 423 gate |
| Picks persisted to `data/picks.json` (not under `public/`) | ✅ Implemented | `data/picks.json` at repo root under `data/`, not under `public/` |
| Standings include `bonusPoints` + `totalPoints`; rank on `points` | ✅ Implemented | `server.js:469-510`; `compareRank` ranks purely on match points + tiebreakers |
| Bonus gated on `final.status === 'final'` | ✅ Implemented | `server.js:417-452` `getFinalBonusOutcome` returns `isFinalComplete: false` unless final is `status: 'final'` |
| 10/6/4 case-insensitive, independent | ✅ Implemented | `server.js:454-467` `calculatePickBonus`; `normalizeComparisonValue` lowercases via `toLocaleLowerCase('es')`; awards are independent `+=` operations |
| Scorer endpoints under `/api/scorers` (auth) and `/api/admin/scorers[/:id]` (admin) | ✅ Implemented | `server.js:1051, 1057, 1083, 1115`; reuse existing `requireAuth`/`requireAdmin` |
| Server-generated `id`, `source: "manual"`, audit timestamps on scorers | ✅ Implemented | `server.js:1060-1067` and `1095-1101` |
| `goals`/`matchesPlayed` non-negative integer validation | ✅ Implemented | `server.js:332-338` returns 400 with explicit message |
| `data/scorers.json` lives under `data/` | ✅ Implemented | `server.js:18` `DATA_DIR = path.join(__dirname, 'data')`; `data/scorers.json` is not under `public/` |
| Pick validation: trim, non-empty, ≤80 chars | ✅ Implemented | `server.js:326-334` |
| Frontend `picksView` with 3 `<select>` cards + Save | ✅ Implemented | `public/js/app.js:834-867`; 3 `<article class="picks-card">` selects via `renderPicksSelect` + lock-aware save |
| Frontend `renderPicksCommunityTable` with 4 columns | ✅ Implemented | `public/js/app.js:821-832`; 4 cells per row, NO `Actualizado por` column |
| Delegated `change` listener on `picksFormContainer` for champion | ✅ Implemented | `public/js/app.js:1346-1349`; calls `refreshRunnerUpOptions` |
| `renderPicksSelect` builds `<select>` with `current` (legacy) as extra option | ✅ Implemented | `public/js/app.js:792-802`; appends `current` if not in allowed and not excluded |
| `buildPicksOptions` excludes `exclude` value | ✅ Implemented | `public/js/app.js:771-790`; uses `Set` for dedup + `exclude` filter |
| `renderPicksView` initial render uses `exclude: pick.champion` for runner-up | ✅ Implemented | `public/js/app.js:852`; passes `exclude: championValue` so the loaded pick renders correctly |
| `docs/PRD.md` describes inline community table, no admin override | ✅ Implemented | `docs/PRD.md:38, 87`; explicit inline community table, "no edit or override column" |

## Coherence (Design Decisions)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Lock = `firstR16Kickoff − 60s`, computed at request time, no flag | ✅ Yes | `getPicksLockState` re-reads fixtures on every picks request |
| Bonus seam inside `/api/standings`, gated on `final.status === 'final'`; rank on match points | ✅ Yes | `getFinalBonusOutcome` + `calculatePickBonus` invoked from `buildStandingsRows`; `compareRank` ignores `bonusPoints` |
| `champion` and `runnerUp` from `phase === "16vos"` (unique, non-empty) | ✅ Yes | `getPicksOptions` filters `fixtures.filter(f => f.phase === '16vos')` and unions `homeTeam`/`awayTeam` |
| `topScorer` from admin scorers `playerName` (unique, non-empty) | ✅ Yes | `getPicksOptions` extracts `scorer.playerName` from `scorers.json` |
| `champion !== runnerUp` enforced | ✅ Yes | `validatePicksBody` returns 400 with explicit Spanish error; frontend `buildPicksOptions` excludes the selected champion from runner-up options |
| Comboboxes (`<select>`) replace free-text inputs | ✅ Yes | All three fields are `<select>` via `renderPicksSelect`; no `<input>` with those names in `public/`; no `<datalist>` references |
| Admin override removed; admins manage only their own row | ✅ Yes | `GET /api/admin/picks` and `PUT /api/admin/picks/:userId` removed; admin still gets bypass on their own row's `POST`/`PUT` |
| Inline community table replaces popup; no `updatedBy` column | ✅ Yes | `renderPicksCommunityTable` writes 4 cells, no `Actualizado por`; `picksPopupModal`, `adminPicksModal`, `openPicksPopupButton` all removed |
| All picks endpoints include `teams: string[]` | ✅ Yes | `GET/POST/PUT /api/picks` all include `teams: options.teams` in their response |
| No top-level `pick_override` emission; `pick_created`/`pick_updated` remain | ✅ Yes | Audit hook only emits `pick_created` / `pick_updated` from `POST`/`PUT`; `pick_override` is no longer emitted (legacy audit entries preserved) |
| `data/picks.json` and `data/scorers.json` live under `data/` | ✅ Yes | Both files at `data/`, not in `public/` |
| `requireAuth` middleware reused on all picks endpoints | ✅ Yes | `GET/POST/PUT /api/picks` all use `requireAuth` |

## Graceful Dimensions

- Strict TDD is **disabled** for this project (`openspec/config.yaml` `strict_tdd: false`, no test framework). No TDD compliance section is needed; verification relies on direct HTTP evidence + code inspection per the project config.
- All four artifacts (proposal, design, tasks, specs) are present; the previous report was rendered against the **pre-correction** delta spec, this report is rendered against the **post-correction** delta spec which is the source of truth.

## Coherence vs Pre-Correction Stale Apply-Progress

The user's prompt noted that the `sdd/issue-60-special-picks-scorers/apply-progress` engram observation is partially stale (it predates both correction rounds). The delta spec is the source of truth. This report is built against the delta spec; the original 27-task apply-progress is not in scope for re-verification.

## Next Recommended

- Proceed to `sdd-archive` for the change.
- Optional cleanup follow-up (non-blocking): remove the `<option value="pick_override">Pick sobrescrito</option>` line in `public/index.html:451` to keep the audit-log filter dropdown in sync with the current spec; consider adding accent-insensitive comparison to `normalizeComparisonValue` if the user wants `Francia` ↔ `France` (and similar Spanish/English team-name pairs) to award the runner-up bonus.

## Risks

- The 16vos placeholders in `data/fixtures.json` mean real pick UX is currently unexercised against real team names. The validation pipeline is correct against the current placeholder set; once the fixtures sync replaces placeholders, the same pipeline will validate against real team names without code change. This is the user-accepted behavior.
- Two pre-existing picks in `data/picks.json` (real team names like `Argentina`, `Francia`, scorer `Lionel Messi`) will not pass the new strict validation. They render as legacy `<option>` values and submission of them is rejected with HTTP 400, which is the spec-correct behavior. The user may want to clear or migrate these rows in a future data migration.
- The audit-log `pick_override` action has historical entries (the data file contains them). The audit log endpoint is read-only, so historical entries are preserved, and the `pick_override` filter option is cosmetic-only. Not a correctness issue.
- The current dev environment leaves the `data/` runtime files (`audit-log.json`, `fixtures.json`, `predictions.json`) dirty after the test session. This is expected and the AGENTS.md doc explicitly notes that `data/audit-log.json` is runtime state that may change while running the app; no committed files were modified by the test (all test mutations were restored from the original checkout).

## Relevant Files

- `server.js` — backend routes, lock helper, validation, standings bonus, scorers CRUD
- `public/js/app.js` — `state.picks`, `loadPicks`, `renderPicksView`, `renderPicksCommunityTable`, `uniqueScorerNames`, `picksTeams`, `buildPicksOptions`, `renderPicksSelect`, `refreshRunnerUpOptions`, delegated `change` listener
- `public/index.html` — `picksView` (form + inline community table), no `picksPopupModal`/`adminPicksModal`/`openPicksPopupButton`/`adminPicksView`/`adminPicksMenu`
- `public/css/styles.css` — `.picks-card select` styling; removed `.picks-eye-popup-card`/`.admin-picks-modal-card`/`.admin-picks-modal-form`
- `data/picks.json` — `[]` at HEAD
- `data/scorers.json` — `[]` at HEAD
- `data/fixtures.json` — 16vos fixtures use FIFA placeholders (`1A`, `2B`, etc.) at HEAD
- `data/users.json` — 22 active users (1 admin, 21 non-admin)
- `docs/PRD.md` — Special Picks section updated to describe the inline community table, "no admin override" rule
- `openspec/changes/issue-60-special-picks-scorers/specs/special-picks/spec.md` — post-correction delta spec (159 lines)
- `openspec/changes/issue-60-special-picks-scorers/specs/tournament-scorers/spec.md` — post-correction delta spec (94 lines)
- `openspec/changes/issue-60-special-picks-scorers/proposal.md` — original proposal (107 lines, NOT updated; predates corrections)
- `openspec/changes/issue-60-special-picks-scorers/design.md` — original design (75 lines, NOT updated; predates corrections)
- `openspec/changes/issue-60-special-picks-scorers/tasks.md` — original task list (77 lines, NOT updated; predates corrections)

## Verdict

**PASS**

All hard requirements of the post-correction delta spec are met with runtime evidence (live HTTP responses, in-place code inspection, and grep). No blocking findings. WARNINGs are about cosmetic UI cleanup, the 16vos placeholder data, and legacy pick data — all user-accepted or expected. The change is ready for `sdd-archive`.
