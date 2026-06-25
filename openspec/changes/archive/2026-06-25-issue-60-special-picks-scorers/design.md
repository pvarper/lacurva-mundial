# Design: Special Picks & Tournament Scorers

## Technical Approach

Two new capabilities on the existing Express + JSON backend and the vanilla JS SPA:

1. **Special picks** — one row per user (`champion`, `runnerUp`, `topScorer`), all three locked together at `firstR16Kickoff − 60s`, admin override allowed, 10/6/4 bonus in standings once the final is `status: 'final'`.
2. **Tournament scorers** — manual admin-maintained list with a source banner, CRUD endpoints, and a forward-compatible merge hook for a future automatic source.

Both reuse `requireAuth`/`requireAdmin`, `readJson`/`writeJson`, and `recordAuditLog`. The standings handler is extended read-time to add `bonusPoints` and `totalPoints` per row; match-scoring math stays untouched.

The exploration plan (`docs/plans/special-picks-and-scorers.md`) had two **corrected** assumptions this design does NOT follow: (a) per-field lock triggers → single shared R16 lock (specs); (b) auto-computed scorers from fixtures → V1 manual-only with a banner (specs).

## Architecture Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Lock policy + storage | Shared R16 lock = `firstR16Kickoff − 60s`, computed on read from `data/fixtures.json`; no flag | Spec is explicit; auto-updates if sync moves a kickoff |
| Bonus seam | Inside `GET /api/standings`, gated on `final.status === 'final'`; rank stays on match points | Read-time, no recompute job; preserves tiebreak rules |
| Pick file shape | Top-level array (matches `users.json`, `predictions.json`, `audit-log.json`) | Codebase convention — wrappers only for multi-section files |
| Top-scorer input | Free-text `<input>` + `<datalist>` autofill from current scorers | Spec: no external roster validation in V1 |
| Scorer source banner | Top-level `source: "manual"` in `/api/scorers`; view reads it | Future `computed` source relabels without view change |
| Future auto-source merge | Manual wins on `playerName` (case-insensitive); V1 has no merge step, just the contract | Forward-compatible without committing to V2 |

## File Changes

| File | Action | Description |
|---|---|---|
| `data/picks.json` | Create | `[]` — per user: `{userId, username, champion, runnerUp, topScorer, submittedAt, updatedAt, updatedBy}`. |
| `data/scorers.json` | Create | `[]` — manual: `{id, playerName, team, goals, matchesPlayed, source:"manual", lastUpdated, updatedBy}`. |
| `server.js` | Modify | `getPicksLockState(fixtures)`, picks/scorers helpers, 8 endpoints, standings bonus, 6 audit actions. |
| `public/index.html` | Modify | 3 new `<section class="view">`; sidebar + bottom-nav buttons; picker/scorer/popup markup. |
| `public/js/app.js` | Modify | `state.picks/scorers/adminPicks`, loaders/renderers, admin override modal, eye-icon popup, submission handlers, navigation whitelist. |
| `public/css/styles.css` | Modify | Pick cards, lock banner, scorers table, admin override modal, eye-icon popup. |
| `docs/PRD.md` | Modify | New section: shared R16 lock, 10/6/4 bonus, scorers V1 (manual), admin override. |

## Interfaces / Contracts

```js
function getPicksLockState(fixtures) {
  const r16 = fixtures.filter(f => f.phase === '16vos')
    .sort((a, b) => a.date.localeCompare(b.date));
  const lockAt = r16.length
    ? new Date(new Date(r16[0].date).getTime() - 60_000) : null;
  return { locked: lockAt ? Date.now() >= lockAt.getTime() : false,
           lockAt: lockAt ? lockAt.toISOString() : null,
           firstR16Kickoff: r16[0]?.date || null };
}
```

`/api/standings` reads `picks.json` and the `Final` fixture; if `final.status !== 'final'` return `bonusPoints: 0`; else add `+10` (champion), `+6` (runnerUp), `+4` (topScorer), case-insensitive, independent. `totalPoints = points + bonusPoints`.

Endpoints: `GET/POST/PUT /api/picks` (requireAuth; 423 `picks_locked` for non-admin when locked); `GET /api/admin/picks` + `PUT /api/admin/picks/:userId` (requireAdmin; override bypasses lock, audits `pick_override` with `previousValue`+`newValue`); `GET /api/scorers` returns `{ source:"manual", scorers }`; `POST/PUT/DELETE /api/admin/scorers[/:id]` (requireAdmin, integer-only validation, audit `scorer_manual_*`); `/api/standings` adds `{ bonusPoints, totalPoints }` per row; rank stays on `points`. Validation: picks text fields trimmed non-empty ≤80 chars; scorer `goals`/`matchesPlayed` non-negative integers (400 on bad input); PUT/DELETE 404 if id missing. Audit verbs added: `pick_created`, `pick_updated`, `pick_override`, `scorer_manual_create`, `scorer_manual_update`, `scorer_manual_delete`.

## Testing Strategy

`node --check server.js` after every commit. Manual smoke at `http://localhost:3001`: submit/update picks and verify lock-rejection at R16−60s; admin override writes `pick_override` audit; admin scorers CRUD writes `scorer_manual_*` audit; scorers view shows "Admin-maintained" banner; eye-icon popup lists all users and shows `updatedBy` for admin; seed a Final fixture `status:"final"` and confirm 10/6/4 in `/api/standings`. No test framework (`openspec/config.yaml`).

## Migration / Rollout

No migration. Both JSON files start as `[]` (greenfield). Rollback = revert commits + delete the two data files; standings returns to match-points-only. `worldcup-sync` keeps writing `data/fixtures.json`; the lock helper re-reads fixtures on every picks request, so a synced kickoff change shifts the lock automatically.

## Implementation Slices (committable units)

1. Data files + `getPicksLockState()` in `server.js`. `node --check` passes.
2. `GET/POST/PUT /api/picks` with lock enforcement.
3. `GET /api/admin/picks` + `PUT /api/admin/picks/:userId` with audit.
4. Standings bonus: `/api/standings` adds `bonusPoints` + `totalPoints`; update `standingsView` and `standingsDetailView` cells.
5. Frontend `picksView`: cards + Save + eye-icon popup + lock banner; whitelist extended.
6. Frontend `adminPicksView`: admin table + override modal; submit handler.
7. Scorers endpoints: `GET /api/scorers` (with `source:"manual"`), admin CRUD with audit.
8. Frontend `scorersView`: table + banner + admin CRUD UI; bottom nav button.
9. `docs/PRD.md` update + smoke.

Each slice leaves the app runnable.
