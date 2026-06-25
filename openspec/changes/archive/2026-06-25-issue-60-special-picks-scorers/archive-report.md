---
schema: gentle-ai.sdd-archive
schemaVersion: 1
change: issue-60-special-picks-scorers
status: PASS
verdict: PASS
next_recommended: none
generated_at: 2026-06-25
artifact_store_mode: both
review_budget_lines: 800
strict_tdd: false
---

# Archive Report: issue-60-special-picks-scorers

## Change

- **Name**: `issue-60-special-picks-scorers`
- **Branch**: `feat/issue-60-special-picks-scorers`
- **Capabilities**:
  - `special-picks` (new, then corrected mid-cycle)
  - `tournament-scorers` (new)
- **Archived on**: 2026-06-25
- **Archived to**: `openspec/changes/archive/2026-06-25-issue-60-special-picks-scorers/`
- **Engram cross-refs**: spec `sdd/issue-60-special-picks-scorers/spec` (#3087), verify `sdd/issue-60-special-picks-scorers/verify-report` (#3118), apply-progress `sdd/issue-60-special-picks-scorers/apply-progress` (#3103), correction round 1 `corrections/admin-picks-to-picks-especiales` (#3114), correction round 2 `corrections/picks-especiales-combos` (#3116).

## Status

**PASS — closed**

- All 29/29 implementation tasks complete in `tasks.md` and reflected in the engram `apply-progress` observation (#3103). `gentle-ai sdd-status` reports `taskProgress: { completed: 29, pending: 0, allComplete: true }`.
- `verify-report.md` is parseable, has `status: PASS`, `verdict: PASS`, `next_recommended: archive`, and 33 runtime probes (live HTTP against `localhost:3011`) with 0 CRITICAL findings.
- No CRITICAL issues, no stale unchecked tasks, no missing artifacts.
- The change went through two post-implementation correction rounds (admin picks removal + comboboxes/strict validation). The delta spec was rewritten to reflect the corrections; the canonical spec reflects the final, post-correction shape.
- `gentle-ai sdd-status issue-60-special-picks-scorers` after the archive move now reports the change as not-active (`Active OpenSpec change not found: issue-60-special-picks-scorers`), which is the expected terminal state — the change is closed and the SDD cycle is complete.

## Specs Synced

| Domain / Capability | Action | Details |
|---------------------|--------|---------|
| `special-picks` | **Created** (new capability, merged delta) | Wrote `openspec/specs/special-picks/spec.md` in final form (no `## MODIFIED/ADDED/REMOVED` headers). The 5 merged requirements are: (1) Shared R16 lock for normal users (kept from base, 3 scenarios), (2) Standings bonus points (kept from base, 3 scenarios), (3) Pick submission (MODIFIED — allowed-set membership + `champion !== runnerUp` with HTTP 400, 4 scenarios), (4) Community picks table visibility (ADDED — inline table, `teams` in API response, one row per active user, 3 scenarios), (5) Restricted pick value sources (ADDED — `<select>` controls, runner-up excludes champion, legacy value handling, 3 scenarios). The REMOVED `Admin pick override` and `Eye-icon popup visibility` requirements are NOT in the canonical. The new `Constraints` block captures the contract: no admin override endpoint, no free-text inputs, `champion` and `runnerUp` from the 16vos set, `topScorer` from admin scorers, `teams: string[]` in every picks response, case-insensitive bonus match. |
| `tournament-scorers` | **Created** (new capability, no delta changes in this change) | Wrote `openspec/specs/tournament-scorers/spec.md` from the unchanged delta. 4 requirements: (1) Scorers listing, (2) Source banner (Admin-maintained label), (3) Admin scorers CRUD (non-negative integer validation, 403 for non-admin), (4) Forward-compatible ADMIN override (no V1 automatic source; constrains future extensions). All 10 scenarios preserved. |

## Archive Contents

- `proposal.md` ✅ (original — predates both correction rounds, preserved verbatim for audit trail)
- `design.md` ✅ (original — predates both correction rounds, preserved verbatim for audit trail)
- `tasks.md` ✅ (29/29 tasks complete; the 27 original tasks + 2 correction rounds consolidated in 29 total checkboxes; no unchecked boxes)
- `specs/special-picks/spec.md` ✅ (post-correction delta)
- `specs/tournament-scorers/spec.md` ✅ (unchanged delta)
- `verify-report.md` ✅ (parseable, `status: PASS`, `verdict: PASS`, `next_recommended: archive`)
- `archive-report.md` ✅ (this file)

The `apply-progress` artifact lives only in Engram (id #3103) for this change; there was no filesystem `apply-progress.md` in the active change directory (the `gentle-ai sdd-status` artifactPaths `applyProgress: []` confirmed this). The observation is preserved in Engram and cross-referenced from this report; it is not duplicated to the filesystem archive per the project's hybrid persistence convention.

## Source of Truth Updated

The following canonical specs now reflect the final, post-correction behavior:

- `openspec/specs/special-picks/spec.md` — new capability for pre-tournament picks with shared R16 lock, comboboxes sourced from authoritative sets, inline community table visible to all users, no admin override, 10/6/4 bonus in standings gated on `final.status === 'final'`.
- `openspec/specs/tournament-scorers/spec.md` — new capability for the scorers view with manual V1, admin CRUD, source banner, and a forward-compatible contract for a future automatic source.

Both canonicals are in the final merged form: `# Spec: <Name>`, `## Purpose`, `## Requirements` (with all `### Requirement:` blocks merged, no `## MODIFIED/ADDED/REMOVED Requirements` headers), `## Constraints`.

## What the Change Delivered

### Backend (Phase 1–3)

- `data/picks.json` — new file, `[]` at HEAD. Schema: `{ userId, username, champion, runnerUp, topScorer, submittedAt, updatedAt, updatedBy }`.
- `data/scorers.json` — new file, `[]` at HEAD. Schema: `{ id, playerName, team, goals, matchesPlayed, source:"manual", lastUpdated, updatedBy }`.
- `server.js`:
  - `getPicksLockState(fixtures)` (`server.js:280-298`) — returns `{ locked, lockAt, firstR16Kickoff }` from `phase === "16vos"`, computed at request time, no stored flag.
  - `getPicksOptions(fixtures, scorers)` (`server.js:300-318`) — returns `{ teams, scorerNames }` for the 16vos teams set (sorted, unique) and the admin scorers' `playerName` values.
  - `validatePicksBody(body)` (`server.js:320-369`) — trims, 1–80 chars, then 400s for: `champion` not in `teamSet`, `runnerUp` not in `teamSet`, `topScorer` not in `scorerSet`, `champion === runnerUp`. Returns clear Spanish `error` messages.
  - `GET /api/picks` (`server.js:892-923`) — `requireAuth`; returns `{ pick, picks, teams, locked, lockAt, firstR16Kickoff }`; `picks` is one row per active user (no-pick users render as empty).
  - `POST /api/picks` (`server.js:925+`) and `PUT /api/picks` — `requireAuth`; 423 `picks_locked` for non-admin when locked; admin bypass on admin's own row; 400 on validation failure; 201/200 success responses include `teams`.
  - `getFinalBonusOutcome` + `calculatePickBonus` (`server.js:417-467`) — `final.status === 'final'` gate; `+10/+6/+4` case-insensitive (`normalizeComparisonValue` uses `toLocaleLowerCase('es')`); independent `+=` (no tie analysis, no splitting).
  - `GET /api/standings` extended with `bonusPoints` + `totalPoints` per row; rank stays on `points` + tiebreakers.
  - `GET /api/scorers` (`server.js:1051+`) — `requireAuth`; returns `{ source:"manual", scorers }`.
  - `POST /api/admin/scorers`, `PUT /api/admin/scorers/:id`, `DELETE /api/admin/scorers/:id` — `requireAdmin`; 400 on negative `goals`/`matchesPlayed`; 404 on missing id; audit `scorer_manual_create | _update | _delete`.
- **Removed by correction**: `GET /api/admin/picks` and `PUT /api/admin/picks/:userId` (admin override endpoints) are NOT present in the shipped code; `pick_override` audit action is no longer emitted by any current handler.

### Frontend (Phase 4–5)

- `public/index.html`:
  - `#picksView` (`public/index.html:281-300`) — 3 `<select>` cards (champion / runner-up / top scorer) populated from authoritative sets, Save button, lock-aware UI, and an inline community table with columns `Usuario | Campeón | Subcampeón | Goleador`. No `Actualizado por` column for any user.
  - `#scorersView` — table, "Admin-maintained" banner sourced from `state.scorers.source`, admin CRUD form.
  - Sidebar + bottom-nav buttons for both views; admin scorers CRUD gated by `.admin-only hidden`.
  - **Removed by correction**: `#adminPicksView`, `#adminPicksModal`, `#picksPopupModal`, `#openPicksPopupButton`, the `<datalist>` autofill, the `<input name="(champion|runnerUp|topScorer)">` free-text inputs — all confirmed absent in shipped code (grep `rg` returns 0 matches in `public/`, `server.js`, `docs/PRD.md`).
- `public/js/app.js`:
  - `state.picks`, `state.scorers` added.
  - `loadPicks`, `loadScorers`, `renderPicksView` (`app.js:834-867`), `renderScorersView`, `renderPicksCommunityTable` (`app.js:821-832`).
  - `picksTeams` + `uniqueScorerNames` (`app.js:757-769`), `buildPicksOptions` (`app.js:771-790`, uses `Set` for dedup + `exclude` for the champion filter), `renderPicksSelect` (`app.js:792-802`, appends legacy `current` as an extra `<option>` when the value is not in the allowed set), `refreshRunnerUpOptions` (`app.js:804-819`).
  - Delegated `change` listener on `picksFormContainer` for `select[name="champion"]` (`app.js:1346-1349`) that calls `refreshRunnerUpOptions` and rebuilds the runner-up `<select>`.
  - `showView()` whitelist extended to include `picksView` and `scorersView` for all authenticated users.
- `public/css/styles.css` — `.picks-card`, `.picks-card select`, `.picks-lock-banner`, `.picks-community-table`, `.scorers-table`, `.scorers-banner`, `.scorers-admin-form`. The pre-correction `.picks-eye-popup-card`, `.admin-picks-modal-card`, `.admin-picks-modal-form` rules are NOT present.
- `docs/PRD.md` — Special Picks section now describes the inline community table, the `<select>` controls, the strict validation, the "no admin override" rule, the 10/6/4 bonus, and the shared R16 lock.

## Verification Evidence

- `node --check server.js` ✅
- `node --check public/js/app.js` ✅
- Live HTTP against `localhost:3011` with `WORLDCUP_SYNC_ENABLED=false` and a reset admin password (`admin123`); runtime data restored from a clean checkout after the test session.
- 33 numbered probes in the verify report cover: API contract (teams in response, lock state, one row per active user, no-pick users render as empty), all four strict validation rules (`champion` in set, `runnerUp` in set, `topScorer` in set, `champion === runnerUp`), 423 lock gate, admin bypass on own row, removed admin override endpoints returning 404, standings `bonusPoints:0` while final `scheduled`, `+20` for a fully matching user once final is `final`, case-insensitive bonus match, no point splitting, scorers endpoint auth + structure, scorers CRUD success + 400 + 403, `node --check`, and grep absence checks for every removed symbol (no `adminPicksView`, no `adminPicksModal`, no `picksPopupModal`, no `openPicksPopupButton`, no `renderPicksPopup`, no `adminPicksForm`, no `adminPicksTableBody`, no `<datalist>`, no `topScorerSuggestions`, no `scorerNameOptions`, no `<input name="(champion|runnerUp|topScorer)">`).
- The previous v1.0 verify report (pre-correction) is superseded by the post-correction verify report; the current report is the source of truth.

## Deviations from Design

The `proposal.md` and `design.md` are the **original** artifacts (predating both correction rounds). The change's effective design is the **post-correction delta spec** (`specs/special-picks/spec.md`); the design.md is preserved verbatim in the archive for audit purposes. The two correction rounds are documented in the engram `corrections/admin-picks-to-picks-especiales` (#3114) and `corrections/picks-especiales-combos` (#3116) observations, and the verify report records the full list of removed symbols.

- **Correction round 1** (admin override removed): dropped `adminPicksView`, `adminPicksModal`, `picksPopupModal`, `openPicksPopupButton`, `GET /api/admin/picks`, `PUT /api/admin/picks/:userId`, the `pick_override` audit action emission, and the `Actualizado por` column. Replaced with an inline community table in `picksView` visible to all users.
- **Correction round 2** (comboboxes + strict validation): replaced `<input>` with `<datalist>` autofill by `<select>` controls populated from authoritative sets (16vos teams for champion/runner-up, admin scorers for top scorer). Added strict backend validation (allowed-set membership for all three fields, `champion !== runnerUp`, HTTP 400 on violation). Runner-up `<option>` list excludes the currently selected champion; legacy pick values are rendered as an extra selected `<option>` so the user can see and change them.

## Non-Blocking Suggestions (for future work)

Carried over from the verify report:

- **WARNING — 16vos placeholders in `data/fixtures.json`**: the 16vos fixtures use FIFA placeholders (`1A`, `2B`, `1E`, `3ABCDF`). The validation pipeline is correct against the current placeholder set; once `worldcup-sync` replaces placeholders with real team names, the same pipeline validates against real names without code change. User-accepted.
- **WARNING — Legacy pick data outside the new allowed set**: two pre-existing picks in `data/picks.json` reference real team names (`Argentina`, `Francia`, `Brazil`) and a real scorer (`Lionel Messi`, `mbape`) that are not in the current 16vos set. The frontend renders these as extra selected `<option>` so the user can see and change them; the backend correctly rejects any submit attempt with HTTP 400. Spec-correct behavior; the user may want a future data migration to clear or remap these rows.
- **WARNING — `pick_override` audit action still in the filter dropdown**: `<option value="pick_override">Pick sobrescrito</option>` (`public/index.html:451`) is still present. The action is no longer emitted by any current handler, so the dropdown entry will never match new entries. Cosmetic only; future cleanup should remove the option.
- **SUGGESTION — Accent-insensitive comparison for the runner-up bonus match**: `normalizeComparisonValue` (`server.js:413-415`) only lowercases (`toLocaleLowerCase('es')`), not accent-insensitive. A user who picked `Francia` (with an `i`) against a final that has `France` (with an `e`) does not get the +6 runner-up bonus. The spec only requires case-insensitive; if the user wants `Francia` ↔ `France` (and similar Spanish/English pairs) to match, the helper should also strip diacritics (`String.normalize('NFD').replace(/\p{Diacritic}/gu, '')`).
- **SUGGESTION — `pick_updated` audit does not capture `previousValue`**: `POST` / `PUT /api/picks` audit entries only log the new values. The pre-correction `pick_override` audit captured both `previousValue` and `newValue`. If a future want includes a diff for user edits, the audit hook can be extended without breaking the spec.

## Workload / PR Boundary

- Single branch run: `feat/issue-60-special-picks-scorers`.
- Delivery mode: size:exception (maintainer-approved single branch run, recorded in engram `Approved size exception for issue 60 apply`).
- Commits already on the branch (per the engram `apply-progress` observation, #3103): `feat(picks): add special picks user endpoints`, `feat(picks): add admin special picks overrides`, `feat(standings): add special pick bonuses and scorers api`, `feat(ui): add special picks and scorers views`, plus the corrective rounds (admin picks removal + comboboxes).
- The archive move itself has NOT been committed; the user controls commits per the project convention. A `git add openspec/changes/archive/2026-06-25-issue-60-special-picks-scorers/ openspec/changes/issue-60-special-picks-scorers openspec/specs/special-picks/ openspec/specs/tournament-scorers/ && git rm openspec/changes/issue-60-special-picks-scorers/tasks.md` (if the user wants it under archive) — followed by a `chore(sdd): archive issue-60-special-picks-scorers` commit — is the expected next step. Spec moves from the active change directory to `openspec/specs/` are content-preserving (delta → canonical merge) and CAN be a single commit.

## SDD Cycle

**Closed.** The change is planned, implemented, verified, and archived. Both new capabilities (`special-picks`, `tournament-scorers`) are now part of the source of truth in `openspec/specs/`. The `gentle-ai sdd-status` reports the change as not-active. The next recommended action is `none` — the change is closed and ready for `sdd-new` when the user is ready to start the next change.
