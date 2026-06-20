# Design: Sync Pending Match Status (#50)

## Technical Approach

Single guard clause inside `applyFixtureSync()` in `lib/worldcup-sync.js`, placed after status/score are received as parameters but before the unchanged-check and the write. No new modules, no schema changes, no change to `parseScore()`'s signature or responsibility. The backfill is a direct one-time edit to `data/fixtures.json` for the two currently-polluted records (`m-033`, `m-034`).

This mirrors the existing precedent in `server.js`: `parseFixtureScore()` (line 240-244) stays a pure parser (parses a raw value to a number or `null`/`NaN`), while the status-aware enforcement ("live/final require non-null scores", line 479) lives at the call site, not inside the parser. The fix for #50 follows the same separation: `parseScore()` in `worldcup-sync.js` stays a pure provider-field parser; the status-aware null-forcing guard lives in `applyFixtureSync()`, the function that actually owns the persistence decision.

## Architecture Decisions

### Decision: Guard placement — inside `applyFixtureSync()`, after the defensive re-read, before the unchanged-check

**Choice**: Insert immediately after `current` is resolved (line 100, after the `if (!current) return;` guard) and before the `unchanged` computation (currently line 102):

```js
async function applyFixtureSync({ match, status, homeScore, awayScore, deps }) {
  const { readJson, writeJson } = deps;

  // Defensive re-read: avoid clobbering a write that happened between fetch and now.
  const fixtures = await readJson('fixtures.json');
  const current = fixtures.find((candidate) => candidate.id === match.id);
  if (!current) return;

  // Scheduled (not-started) matches must never carry a score. The provider sends "0"
  // placeholders for not-yet-started matches; parseScore() turns that into a real 0,
  // indistinguishable from an actual 0-0 result. Force null here, at the single
  // persistence decision point, so no call path can bypass it.
  if (status === 'scheduled') {
    homeScore = null;
    awayScore = null;
  }

  const unchanged = current.status === status && current.homeScore === homeScore && current.awayScore === awayScore;
  if (unchanged) return;

  current.status = status;
  current.homeScore = homeScore;
  current.awayScore = awayScore;

  await writeJson('fixtures.json', fixtures);
}
```

**Why this exact position relative to the `unchanged` check matters**: the guard must run *before* `unchanged` is computed, not after. If it ran after, the comparison would still use the un-corrected `homeScore`/`awayScore` (`0`/`0` from `parseScore()`), and the assignment to `current.homeScore = homeScore` afterward would write the corrected `null` — but only if `unchanged` was false, which it would be in that ordering anyway since `current.homeScore` (currently `0`, polluted data) `!== null` (forced value) once written once... The critical case is the *steady state* after backfill: once `data/fixtures.json` has `current.homeScore === null` for a scheduled match, and the provider keeps reporting `notstarted`/`0`, every subsequent sync cycle must recognize "no real change" and skip the write (avoid needless I/O every 10s). Placing the guard before `unchanged` ensures the comparison is `current.homeScore (null) === homeScore (corrected to null)` → `true` → skip. If the guard ran after the comparison (comparing against raw `0`), every cycle would see `null !== 0` and rewrite the file every 10 seconds for every scheduled match — a correctness-neutral but wasteful bug.

**The pre-backfill transient case**: before the backfill is applied, `current.homeScore` is `0` (polluted) and the guard-corrected `homeScore` is `null`. `0 !== null`, so `unchanged` is `false`, and the write proceeds, persisting `null`. This means the code fix alone — even without a manual backfill — self-heals on the next sync cycle for any fixture currently being polled. The manual backfill (see below) is still done immediately rather than waiting, per proposal intent ("correct the currently polluted data immediately rather than waiting for the next sync cycle").

**Alternatives considered**:
- *Guard inside `parseScore()`*: rejected — `parseScore()` only receives the raw provider `record`, not the already-computed `status` string (computed separately via `parseProviderStatus(record)` in `syncSingleFixture`). Moving status-awareness into `parseScore()` would require passing `status` into a function whose name and existing contract ("parse provider score fields") doesn't suggest status logic, and would entangle two independently-testable concerns (parsing vs. persistence policy).
- *Guard inside `syncSingleFixture()`, before calling `applyFixtureSync()`*: rejected — `applyFixtureSync()` is exported and usable independently (it's in `module.exports`); a future caller invoking it directly would bypass the guard. Putting it inside `applyFixtureSync()` itself makes it impossible to bypass, consistent with the proposal's stated rationale ("single persistence decision point... can't be bypassed by any other call path").
- *Guard after the `unchanged` check, right before the field assignments*: rejected per the steady-state analysis above — would cause a write on every poll cycle for every scheduled match, every 10 seconds, indefinitely.

**Rationale**: `applyFixtureSync()` is the sole function that writes to `fixtures.json` (confirmed via `module.exports` and the one call site in `syncSingleFixture`). Enforcing the invariant ("scheduled implies null score") at this single chokepoint, before any comparison or write, guarantees correctness regardless of what `parseScore()` returns and avoids the unchanged-check false-negative storm described above.

### Decision: Backfill via direct JSON edit, not a script or sync-cycle wait

**Choice**: Manually edit `data/fixtures.json`, setting `homeScore: null, awayScore: null` for `m-033` (line 618-619) and `m-034` (line 637-638), leaving all other fields untouched.

**Confirmed current state** (read directly from `data/fixtures.json`):
```json
// m-033 (line 611-625): "homeScore": 0, "awayScore": 0, "status": "scheduled"
// m-034 (line 630-644): "homeScore": 0, "awayScore": 0, "status": "scheduled"
```
No other fixture in the file currently has `status: "scheduled"` with a non-null score — these two are the only affected records at design time (re-verify at apply time in case state drifted).

**Alternatives considered**:
- *Run one sync cycle and let the code fix self-heal the data*: rejected as the sole remedy — requires `WORLDCUP_SYNC_ENABLED=true` and a live network call to `worldcup26.ir` succeeding within the apply/verify window, plus correct team-name/date matching for these two fixtures. This is an indirect, network-dependent, non-deterministic way to fix two known field values when a direct edit is trivial, deterministic, and reviewable in a diff. It also doesn't fix the data if sync is disabled in the apply/CI environment (sync is opt-in per `WORLDCUP_SYNC_ENABLED`).
- *Write a tiny one-off script (`scripts/backfill-50.js`)*: rejected — proposal explicitly scopes this as "a manual data correction, not a script/migration"; for exactly 2 records this would be more code to write, review, and then discard than the fix itself. A script earns its cost when the record count or condition logic is non-trivial; here it is not.

**Rationale**: Two records, known IDs, known target values, no conditional logic needed. A direct edit is the smallest, most auditable change (visible in `git diff`) and has zero runtime dependency. Matches the proposal's explicit instruction.

## Data Flow

    runSyncCycle (every 10s, opt-in via WORLDCUP_SYNC_ENABLED)
        │
        ▼
    syncSingleFixture(match, providerGames, deps)
        │  status = parseProviderStatus(record)        // e.g. "scheduled" | "live" | "final"
        │  { homeScore, awayScore } = parseScore(record) // raw Number(), "0" placeholder → 0
        ▼
    applyFixtureSync({ match, status, homeScore, awayScore, deps })
        │
        ├─ readJson('fixtures.json') → current  (defensive re-read)
        ├─ if (status === 'scheduled') { homeScore = null; awayScore = null; }   ← NEW GUARD
        ├─ unchanged = current.status === status
        │             && current.homeScore === homeScore   // null === null after backfill+guard
        │             && current.awayScore === awayScore
        ├─ if (unchanged) return;                            // no-op, no write
        └─ else: current.{status,homeScore,awayScore} = ...; writeJson('fixtures.json', fixtures)

    Frontend (unaffected, already correct):
    public/js/app.js → renders "Pendiente" when homeScore === null, else shows the score.

## File Changes

| File | Action | Description |
|------|--------|--------------|
| `lib/worldcup-sync.js` | Modify | `applyFixtureSync()` (~line 94-110): add `if (status === 'scheduled') { homeScore = null; awayScore = null; }` immediately after the `if (!current) return;` guard (line 100) and before the `unchanged` computation (line 102). No signature change — `homeScore`/`awayScore` are already function parameters (reassignable `let`-like params), no destructuring restructure needed. |
| `data/fixtures.json` | Modify (data) | `m-033` (line 618-619): `homeScore`/`awayScore` `0` → `null`. `m-034` (line 637-638): `homeScore`/`awayScore` `0` → `null`. Re-check for any other `status: "scheduled"` fixture with non-null score at apply time before finalizing the edit list. |

## Interfaces / Contracts

No API or function-signature changes. `applyFixtureSync({ match, status, homeScore, awayScore, deps })` keeps its existing call contract; callers (`syncSingleFixture`) pass the same arguments as before — the guard is internal to the function body and transparent to callers.

Implicit data invariant now enforced (previously only enforced for the manual admin route, not for sync):
```
status === 'scheduled'  ⇒  homeScore === null AND awayScore === null   (in data/fixtures.json, written by applyFixtureSync)
```
This mirrors the existing manual-route invariant in `server.js` (line 479): `(status === 'live' || status === 'final') ⇒ homeScore !== null AND awayScore !== null`. The two invariants are complementary but enforced in two different code paths (admin PUT route vs. sync), which is acceptable per the proposal's explicit out-of-scope note ("`PUT /api/fixtures/:id` admin route does not enforce 'scheduled implies null score' — a pre-existing, separate gap. Not touched here").

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit/manual | `applyFixtureSync()` forces null for scheduled | Call directly with `{ status: 'scheduled', homeScore: 0, awayScore: 0, ... }` against a fixture whose current `homeScore` is non-null; assert written record has `homeScore: null, awayScore: null`. |
| Unit/manual | Unchanged-check still short-circuits correctly post-fix | Call twice in a row with the same `scheduled` status/scores (e.g. `0`/`0` raw, corrected to `null`/`null`); assert `writeJson` is called once, not twice (second call is a no-op since `current` is now `null`/`null`). |
| Unit/manual | Scheduled → live transition unaffected | Call with `status: 'live', homeScore: 1, awayScore: 0`; assert real scores pass through untouched (guard only fires for `status === 'scheduled'`). |
| Integration | Backfilled data renders correctly | After editing `data/fixtures.json`, load the frontend fixtures view; confirm `m-033` and `m-034` show "Pendiente", not "0 - 0". |
| Static | Syntax | `node --check server.js`, `node --check lib/worldcup-sync.js`. |

No automated test harness exists in this project (`package.json` has no test script — confirmed project gotcha); testing is manual/script-based per existing project convention.

## Migration / Rollout

One-time backfill of `data/fixtures.json` (`m-033`, `m-034`) ships alongside the code fix in the same change — not deferred to a separate migration step, since the dataset is small and the affected records are already identified. No other migration needed; the code fix is backward compatible with all other existing data (the guard only changes behavior for `status === 'scheduled'` paths, which by definition should not have had a real score in the first place).

## Open Questions

None. Scope, fix location, and backfill values are all confirmed against current source and data state.
