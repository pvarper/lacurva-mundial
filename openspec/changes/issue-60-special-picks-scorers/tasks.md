# Tasks: Special Picks & Tournament Scorers

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~850–1100 across 7 files (server.js ~300, app.js ~240, index.html ~180, styles.css ~150, PRD ~50, +2 new data files) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | 5 chained PRs (table below) |
| Delivery strategy | ask-always |
| Chain strategy | pending — user must choose |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units (chained PRs)

| Unit | Slices | Goal | PR | Base |
|------|--------|------|----|------|
| 1 | 1+2 | Data files, `getPicksLockState`, `GET/POST/PUT /api/picks` with 423 gate | PR 1 | `main` (stacked) or `feature/issue-60` (chain) |
| 2 | 3 | `GET /api/admin/picks` + `PUT /api/admin/picks/:userId` (audit `pick_override`) | PR 2 | previous PR branch / `main` |
| 3 | 4+7 | Standings 10/6/4 bonus + scorers endpoints + admin CRUD (`scorer_manual_*` audit) | PR 3 | previous PR branch / `main` |
| 4 | 5+6 | Frontend `picksView` (cards + Save + eye-icon popup + lock banner) + `adminPicksView` | PR 4 | previous PR branch / `main` |
| 5 | 8+9 | Frontend `scorersView` (table + banner + admin CRUD) + `docs/PRD.md` + smoke | PR 5 | previous PR branch / `main` |

## Phase 1: Backend picks foundation (PR 1)

- [x] 1.1 Create `data/picks.json` as `[]` and `data/scorers.json` as `[]`.
- [x] 1.2 In `server.js` add `getPicksLockState(fixtures)` → `{ locked, lockAt, firstR16Kickoff }` from `phase === '16vos'`.
- [x] 1.3 Add `validatePicksBody(body)`: trim, non-empty, ≤80 chars; 400 on fail.
- [x] 1.4 `GET /api/picks` (requireAuth): caller's row + lock state + all rows for popup.
- [x] 1.5 `POST /api/picks` (requireAuth): append `updatedBy:"user"`; reject 423 `picks_locked` for non-admin when locked.
- [x] 1.6 `PUT /api/picks` (requireAuth): in-place update, refresh `updatedAt`; same 423 gate.
- [x] 1.7 Audit `pick_created` / `pick_updated`; `node --check server.js`.

## Phase 2: Backend admin picks (PR 2)

- [x] 2.1 `GET /api/admin/picks` (requireAdmin): all rows + lock state.
- [x] 2.2 `PUT /api/admin/picks/:userId` (requireAdmin): 404 on miss; bypasses lock; `updatedBy:"admin:<id>"`.
- [x] 2.3 Append `pick_override` audit with `previousValue` + `newValue` + `updatedBy`; `node --check server.js`.

## Phase 3: Backend standings bonus + scorers (PR 3)

- [x] 3.1 In `/api/standings`, compute `bonusPoints` from `picks.json` only when a final fixture is `status:"final"`; +10/+6/+4 case-insensitive, independent.
- [x] 3.2 Add `bonusPoints` + `totalPoints = points + bonusPoints` to each row; rank stays on `points`.
- [x] 3.3 `GET /api/scorers` (requireAuth): returns `{ source:"manual", scorers }`.
- [x] 3.4 `POST /api/admin/scorers` (requireAdmin): integer validation 400s on `goals`/`matchesPlayed`; audit `scorer_manual_create`.
- [x] 3.5 `PUT /api/admin/scorers/:id` (requireAdmin): 404 on miss; in-place; audit `scorer_manual_update`.
- [x] 3.6 `DELETE /api/admin/scorers/:id` (requireAdmin): 404 on miss; audit `scorer_manual_delete`.
- [ ] 3.7 `node --check server.js`; smoke final fixture → 10/6/4 in standings; non-admin 403; `goals:-1` 400.

## Phase 4: Frontend picks + admin picks (PR 4)

- [ ] 4.1 In `public/index.html`, add `#picksView` (3 input cards + Save + eye-icon + lock banner) and `#adminPicksView` (table + override modal).
- [ ] 4.2 Add sidebar + bottom-nav buttons; gate admin with `.admin-only hidden`.
- [ ] 4.3 In `public/js/app.js`, add `state.picks`/`state.adminPicks`; extend `showView()` whitelist; add `loadPicks`/`loadAdminPicks`.
- [ ] 4.4 `renderPicksView`: cards with `<datalist>` from scorers; lock-aware Save; eye-icon popup table; admin sees `updatedBy`.
- [ ] 4.5 `renderAdminPicksView`: all-rows table; override modal pre-fills 3 fields; submit calls `PUT /api/admin/picks/:userId`.
- [ ] 4.6 In `public/css/styles.css`, add `.picks-card`, `.picks-lock-banner`, `.picks-eye-popup`, `.admin-picks-modal`.

## Phase 5: Frontend scorers + docs + smoke (PR 5)

- [ ] 5.1 In `public/index.html`, add `#scorersView` (table + `Admin-maintained` banner + admin CRUD form) and nav button.
- [ ] 5.2 In `public/js/app.js`, add `state.scorers`; `loadScorers`; `renderScorersView` with POST/PUT/DELETE handlers.
- [ ] 5.3 In `public/css/styles.css`, add `.scorers-table`, `.scorers-banner`, `.scorers-admin-form`.
- [ ] 5.4 In `docs/PRD.md`, add sections: shared R16 lock, 10/6/4 bonus (gated on final), scorers V1 manual, admin override.
- [ ] 5.5 Full smoke at `http://localhost:3001`: submit picks, eye-icon popup, admin override, scorers CRUD, seed final fixture → 10/6/4 in standings.
- [ ] 5.6 `git status` (skip dirty `data/audit-log|fixtures|predictions|users.json`); `git diff --check`; per-work-unit commit with conventional message.

## Notes for Apply

- Dirty runtime files in `data/` MUST NOT be committed; pre-existing `package.json` and `public/css/tailwind.output.css` are out of scope unless a slice needs them.
- `node --check server.js` is the only automated check; everything else is manual smoke per `openspec/config.yaml`.
- User requested commit after each change → 9 work-unit commits inside the 5-work-unit PR chain.
