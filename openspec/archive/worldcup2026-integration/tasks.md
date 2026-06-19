# Tasks: worldcup2026 fixture sync (issue #43)

Source artifacts: `spec.md` (engram #2908), `design.md` (engram #2909), orchestrator live-API correction (this session). Manual verification only — no automated test framework in this repo (per `CLAUDE.md`).

## Design correction applied in this task list

Orchestrator fetched `https://worldcup26.ir/get/games` live and confirmed the authoritative 48-name EN team list. Two entries in design.md's `TEAM_NAME_EN_BY_ES` table are WRONG and corrected below:

| ES key | design.md (wrong) | Corrected (verified live) |
|--------|--------------------|----------------------------|
| `Curazao` | `'Curacao'` | `'Curaçao'` (cedilla — exact provider string) |
| `República Democrática del Congo` | `'DR Congo'` | `'Democratic Republic of the Congo'` |

All other 46 ES->EN pairs in design.md were rechecked against the authoritative live list and confirmed correct, including the two design previously flagged as highest-risk (`Corea del Sur` -> `South Korea`, `Costa de Marfil` -> `Ivory Coast` — both correct as written).

## Product decisions baked into these tasks

1. The team-name-map is sync-internal only. `fixtures.json` `homeTeam`/`awayTeam` stay in Spanish, unchanged, in all UI/API responses. The EN values exist solely for matching against the provider payload inside `lib/worldcup-sync.js` and must never be written back to `fixtures.json` or surfaced to the frontend.
2. Audit volume mitigation is accepted as designed in `design.md` section 5: per-fixture in-memory `Set` (`warnedUnmatchedFixtureIds`), first miss per fixture = `console.warn` + `recordAuditLog('fixture_sync_unmatched', ...)`, every subsequent miss for that same fixture (same process lifetime) = `console.warn` only.

---

## Task list

### 1. `lib/team-name-map.js` (new file) — Spec req 1

Create the file with the full corrected 48-entry table. Reuse design.md's structure (`TEAM_NAME_EN_BY_ES` object + `getEnglishTeamName` helper + module exports), substituting the two corrected values.

```js
// Static translation table: fixtures.json team name (homeTeam/awayTeam) -> the
// worldcup26.ir provider's English team name (home_team_name_en / away_team_name_en).
//
// SYNC-INTERNAL ONLY. This table exists purely to match local fixtures against the
// provider payload inside lib/worldcup-sync.js. The EN values here must never be
// written back to data/fixtures.json or surfaced in any API response/UI — fixtures.json
// homeTeam/awayTeam stay in Spanish, unchanged, always.
//
// Only real group-stage team names are listed here. Knockout-stage placeholder names
// ("2A", "W74", "1E", "L101", etc.) are deliberately absent — their absence is what makes
// isSyncCandidate() in lib/worldcup-sync.js skip them as expected, non-failure exclusions.
//
// Comparison against the provider is case-insensitive + trimmed (see findMatchingProviderRecord
// in lib/worldcup-sync.js), so exact casing here only needs to be readable/correct, not byte-exact.
// EXCEPTION: Curazao -> 'Curaçao' must keep the exact cedilla character — case-insensitive
// compare does NOT fix missing/extra diacritics, only case differences.
const TEAM_NAME_EN_BY_ES = {
  Alemania: 'Germany',
  'Arabia Saudita': 'Saudi Arabia',
  Argelia: 'Algeria',
  Argentina: 'Argentina',
  Australia: 'Australia',
  Austria: 'Austria',
  'Bosnia y Herzegovina': 'Bosnia and Herzegovina',
  Brasil: 'Brazil',
  Bélgica: 'Belgium',
  'Cabo Verde': 'Cape Verde',
  Canadá: 'Canada',
  Catar: 'Qatar',
  Chequia: 'Czech Republic',
  Colombia: 'Colombia',
  'Corea del Sur': 'South Korea',
  'Costa de Marfil': 'Ivory Coast',
  Croacia: 'Croatia',
  Curazao: 'Curaçao',
  Ecuador: 'Ecuador',
  Egipto: 'Egypt',
  Escocia: 'Scotland',
  España: 'Spain',
  'Estados Unidos': 'United States',
  Francia: 'France',
  Ghana: 'Ghana',
  Haití: 'Haiti',
  Inglaterra: 'England',
  Irak: 'Iraq',
  Irán: 'Iran',
  Japón: 'Japan',
  Jordania: 'Jordan',
  Marruecos: 'Morocco',
  México: 'Mexico',
  Noruega: 'Norway',
  'Nueva Zelanda': 'New Zealand',
  Panamá: 'Panama',
  Paraguay: 'Paraguay',
  'Países Bajos': 'Netherlands',
  Portugal: 'Portugal',
  'República Democrática del Congo': 'Democratic Republic of the Congo',
  Senegal: 'Senegal',
  Sudáfrica: 'South Africa',
  Suecia: 'Sweden',
  Suiza: 'Switzerland',
  Turquía: 'Turkey',
  Túnez: 'Tunisia',
  Uruguay: 'Uruguay',
  Uzbekistán: 'Uzbekistan'
};

function getEnglishTeamName(teamNameEs) {
  return Object.prototype.hasOwnProperty.call(TEAM_NAME_EN_BY_ES, teamNameEs)
    ? TEAM_NAME_EN_BY_ES[teamNameEs]
    : null;
}

module.exports = { TEAM_NAME_EN_BY_ES, getEnglishTeamName };
```

- [ ] 1.1 Create `lib/team-name-map.js` with the exact table above (48 entries, corrected Curazao/RDC Congo values).
- [ ] 1.2 `node -e "console.log(Object.keys(require('./lib/team-name-map').TEAM_NAME_EN_BY_ES).length)"` confirms `48`.
- [ ] 1.3 `node -e "console.log(require('./lib/team-name-map').getEnglishTeamName('Curazao'))"` confirms output is `Curaçao` (cedilla visible, not `Curacao`).
- [ ] 1.4 `node -e "console.log(require('./lib/team-name-map').getEnglishTeamName('República Democrática del Congo'))"` confirms output is `Democratic Republic of the Congo`.
- [ ] 1.5 `node --check lib/team-name-map.js`.

**Can run in parallel with**: task 2 (independent file, no shared state).

### 2. `lib/match-status-map.js` (new file) — Spec req 4

- [ ] 2.1 Create `lib/match-status-map.js` exactly per `design.md` section 3 (`parseProviderStatus({ finished, time_elapsed })`, precedence: `finished === 'TRUE'` -> `'final'`, else `time_elapsed === 'notstarted'` -> `'scheduled'`, else `'live'`).
- [ ] 2.2 `node --check lib/match-status-map.js`.
- [ ] 2.3 Manual sanity check: `node -e "const {parseProviderStatus}=require('./lib/match-status-map'); console.log(parseProviderStatus({finished:'TRUE',time_elapsed:'45'}), parseProviderStatus({finished:'FALSE',time_elapsed:'notstarted'}), parseProviderStatus({finished:'FALSE',time_elapsed:'56'}))"` confirms `final scheduled live`.

**Can run in parallel with**: task 1.

### 3. `lib/worldcup-sync.js` (new file) — Spec reqs 2, 3, 5, 6, 7, 8, 9, 10

Depends on tasks 1 and 2 (imports `getEnglishTeamName` from `lib/team-name-map.js` and `parseProviderStatus` from `lib/match-status-map.js`).

- [ ] 3.1 Create `lib/worldcup-sync.js` per `design.md` section 4.3 in full: `fetchAllMatches`, `findMatchingProviderRecord` (bidirectional name+date match, never by provider `id` — spec req 3), `parseScore` (string->number coercion), `providerLocalDateToYmd`, `namesMatch`, `isSyncCandidate` (status != final AND both team names resolve via map), `applyFixtureSync` (diff-before-write + `fixture_synced` audit, reused unchanged from sportmonks-sync.js shape), `recordUnmatched` (dual-channel: console.warn every cycle + `fixture_sync_unmatched` audit only on first miss per fixture id via `warnedUnmatchedFixtureIds` Set), `syncSingleFixture`, `runSyncCycle` (single bulk fetch per cycle, per-fixture try/catch), `startWorldcupSync`/`stopWorldcupSync` (interval lifecycle, gated by `process.env.WORLDCUP_SYNC_ENABLED === 'true'` — no `apiToken` field).
- [ ] 3.2 Confirm module exports match design.md's list: `startWorldcupSync, stopWorldcupSync, runSyncCycle, isSyncCandidate, syncSingleFixture, findMatchingProviderRecord, parseScore, fetchAllMatches, applyFixtureSync`.
- [ ] 3.3 `node --check lib/worldcup-sync.js`.
- [ ] 3.4 Confirm `applyFixtureSync` writes/reads only `homeTeam`/`awayTeam` in Spanish from the existing fixture record — no EN team name is ever assigned to a fixture field (verify by reading the function body: it only reassigns `status`, `homeScore`, `awayScore`).

**Sequential after**: tasks 1, 2. **Can run in parallel with**: nothing meaningful (this is the core integration file).

### 4. Delete dead SportMonks modules — Design section 8 deletion checklist

- [ ] 4.1 `git rm lib/sportmonks-sync.js`
- [ ] 4.2 `git rm lib/sportmonks-team-map.js`
- [ ] 4.3 `git rm lib/sportmonks-states.js`

**Can run in parallel with**: tasks 1, 2, 3 (no shared files). Must complete **before** task 6's final grep check.

### 5. `server.js` wiring — Design section 7

Sequential after task 3 (needs `lib/worldcup-sync.js` to exist before importing it) and task 4 (removes the old import this replaces).

- [ ] 5.1 Remove line 8: `const { startSportmonksSync } = require('./lib/sportmonks-sync');`
- [ ] 5.2 Add equivalent require near other requires: `const { startWorldcupSync } = require('./lib/worldcup-sync');`
- [ ] 5.3 Remove lines 671-676 (`startSportmonksSync({ readJson, writeJson, recordAuditLog, apiToken: process.env.SPORTMONKS_API_TOKEN });`)
- [ ] 5.4 Add in the same position: `startWorldcupSync({ readJson, writeJson, recordAuditLog });` — note: no `apiToken` field, gating happens inside `startWorldcupSync` via `WORLDCUP_SYNC_ENABLED`.
- [ ] 5.5 `node --check server.js`.

### 6. Zero-residue grep check — Spec req 11

Sequential after tasks 4 and 5.

- [ ] 6.1 `rg -i sportmonks server.js` — must return zero matches.
- [ ] 6.2 `rg -i sportmonks lib/` — must return zero matches (confirms deletion in task 4 was complete and no other lib file references the dead modules).
- [ ] 6.3 `rg -i sportmonks public/` — must return zero matches (sanity check; design doesn't expect frontend references but confirm).
- [ ] 6.4 Confirm `rg -i sportmonks openspec/changes/sportmonks-integration/` still finds matches (historical record, untouched, must NOT be deleted — this confirms the grep tool itself works and the exclusion scope is correct, not a false "everything's clean" result).

### 7. Manual verification — no automated test framework (per `CLAUDE.md`)

Sequential after task 5 (server.js must be wired).

- [ ] 7.1 `node --check server.js && node --check lib/worldcup-sync.js && node --check lib/team-name-map.js && node --check lib/match-status-map.js` — all pass with no syntax errors.
- [ ] 7.2 Boot test, sync disabled: start server with `WORLDCUP_SYNC_ENABLED` **unset** (`pnpm start` or `node server.js`). Confirm console prints `[worldcup-sync] WORLDCUP_SYNC_ENABLED not set to "true", sync disabled.` and the server otherwise boots normally with no crash, no interval running.
- [ ] 7.3 **PROMINENT — first real opportunity for live end-to-end verification.** Unlike SportMonks (paywalled, never actually testable), `worldcup26.ir` has no token/paywall blocking access. Boot test with `WORLDCUP_SYNC_ENABLED=true` and let at least one real 60s sync cycle run against the live provider. Confirm console prints `[worldcup-sync] starting sync, polling every 60s.` and no uncaught errors/crashes during the cycle.
- [ ] 7.4 After a live cycle completes, spot-check `data/fixtures.json` for a few in-progress or recently-finished real fixtures (group-stage, non-placeholder team names) and confirm `status`/`homeScore`/`awayScore` actually updated to plausible live values matching what's publicly known about those matches.
- [ ] 7.5 Inspect `data/audit-log.json` for `fixture_synced` entries (and `fixture_sync_unmatched` entries if any real-team fixture fails to match) confirming the audit shape matches design.md section 5's payload.
- [ ] 7.6 If any real-team fixture produces a `fixture_sync_unmatched` audit entry, treat that as a live signal the team-name-map has an error for that specific pair — cross-check the failing fixture's ES names against `lib/team-name-map.js` and the live provider response, fix the EN value if wrong (only `lib/team-name-map.js` needs changing, no other file).
- [ ] 7.7 Stop the server; confirm `data/fixtures.json`/`data/audit-log.json` runtime dirt from this manual testing is NOT committed (see task 8).

### 8. Git hygiene

Sequential, last.

- [ ] 8.1 `git status` — confirm only intended source files are staged: `lib/team-name-map.js` (new), `lib/match-status-map.js` (new), `lib/worldcup-sync.js` (new), `lib/sportmonks-sync.js` (deleted), `lib/sportmonks-team-map.js` (deleted), `lib/sportmonks-states.js` (deleted), `server.js` (modified).
- [ ] 8.2 Explicitly exclude `data/*.json` changes from this commit unless a change was intentionally required by the task (it is not — runtime dirt from manual testing in task 7 must be reverted or left unstaged).
- [ ] 8.3 `git diff --cached --check` (or `git diff --check` if unstaged) — confirm no trailing whitespace/conflict markers.
- [ ] 8.4 Commit with conventional commit message, e.g. `feat(sync): replace SportMonks with worldcup26.ir provider`.

---

## Task dependency graph

```
1 (team-name-map)  ─┐
2 (match-status-map)─┼─> 3 (worldcup-sync) ─> 5 (server.js wiring) ─> 6 (grep check) ─> 7 (manual verify) ─> 8 (git hygiene)
4 (delete sportmonks files) ──────────────────^ (must precede task 6, can run anytime before)
```

- Tasks 1, 2, 4 are mutually independent — parallelizable.
- Task 3 requires 1 and 2 complete (imports both modules).
- Task 5 requires 3 complete (new require target must exist) and benefits from 4 being done first (clean removal, no leftover dead require).
- Task 6 requires 4 and 5 complete.
- Task 7 requires 5 complete (server.js must be wired to test boot behavior).
- Task 8 is last, after 7 confirms the change works.

---

## Review Workload Forecast (delivery_strategy: ask-on-risk)

| File | Type | Estimated lines |
|------|------|------------------|
| `lib/team-name-map.js` | new | ~70 (48 table entries + comments + helper) |
| `lib/match-status-map.js` | new | ~25 (small parser + comments) |
| `lib/worldcup-sync.js` | new | ~195 (per design.md section 4.3 full skeleton) |
| `server.js` | modified | ~10 lines changed (1 require swap, ~6-line call block swap) |
| `lib/sportmonks-sync.js` | deleted | -173 |
| `lib/sportmonks-team-map.js` | deleted | (not read this session — historically small, estimate -30 to -60) |
| `lib/sportmonks-states.js` | deleted | (not read this session — historically small, estimate -20 to -40) |

**Estimated net diff**: ~300 lines added (3 new files + server.js edit), ~230-275 lines removed (3 deletions). Total changed-lines footprint (additions + deletions combined) is roughly **530-575 lines** — this exceeds the 400-line single-PR comfort budget.

- **Chained PRs recommended: Yes** — the deletions are mechanical/zero-risk (dead code removal) and could ship as PR #1 (small, trivial review) followed by PR #2 for the three new files + server.js wiring (the actual reviewable logic).
- **400-line budget risk: High** — combined diff is well above 400 lines even though no single file is large in isolation; the bulk is the new `worldcup-sync.js` (~195 lines) plus full deletion of three old files.
- **Decision needed before apply: Yes** — per `delivery_strategy: ask-on-risk`, this should be surfaced to the user before `sdd-apply` starts: split into 2 PRs (deletions first, then new sync engine + wiring) or proceed as a single PR with `size:exception`.

---

## Notes carried from design/spec for `sdd-apply`

- No automated test suite exists (per `CLAUDE.md`) — all verification in task 7 is manual.
- The team-name-map's two highest-risk entries design previously flagged (`Corea del Sur`/South Korea, `Costa de Marfil`/Ivory Coast) are confirmed CORRECT against the live authoritative list — no further action needed on those two, contrary to design.md section 9 item 1's caution (that caution is now resolved).
- `República Democrática del Congo` and `Curazao` required correction (this session) — design.md is stale on those two values; this tasks.md is the source of truth going forward.
- Provider `id` field must never be used for matching (spec req 3) and never persisted on fixture records (design + spec non-goals).
- `lib/sportmonks-sync.js`, `lib/sportmonks-team-map.js`, `lib/sportmonks-states.js` deletions are git-tracked removals (`git rm`), not just filesystem deletes — ensures the removal is staged for commit.
