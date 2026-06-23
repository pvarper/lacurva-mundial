# Tasks: Standings Live Header

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~110 net across 5 files |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR (5 work-unit commits) |
| Delivery strategy | ask-on-risk |
| Chain strategy | single-pr |
| Session budget (800) | Within budget |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: single-pr
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Commit | Notes |
|------|------|--------|-------|
| 1 | Pure 3-letter helper | `feat(standings): add 3-letter team abbreviation helper` | `lib/team-abbrev.js` new; repl-test collisions + placeholders. |
| 2 | Server selects ≤2 live | `feat(standings): expose up to 2 live matches with pre-computed abbreviations` | `server.js` /api/standings; remove legacy `liveMatch`; per-row `livePredictions`. |
| 3 | UI 0/1/2 live columns | `feat(ui): render 0/1/2 live columns in Tabla Acumulada header` | `public/js/app.js` loadStandings; one-pass header+body. |
| 4 | Compact monospace style | `feat(ui): style standings live columns as compact monospace` | `public/css/styles.css`; new `.standings-live-*`. |
| 5 | PRD one-liner | `docs(standings): note up to 2 live matches in PRD` | `docs/PRD.md` "Accumulated Table". |

## Phase 1: Foundation (helper)

- [x] 1.1 Create `lib/team-abbrev.js` exporting `abbreviateTeamName(name)` (pure, no I/O).
- [x] 1.2 Implement placeholder passthrough (digit-led or ≤3 chars) before any rule.
- [x] 1.3 Implement multi-word (first letter of ≤3 words) and single-word (first 3 chars) rules; uppercase.
- [x] 1.4 `node --check lib/team-abbrev.js`.
- [x] 1.5 Repl loop over 48 fixture team names + `1A`/`2B`/`W73`/`L101`; confirm collisions exist and placeholders pass through.

## Phase 2: Backend (selection + shape)

- [x] 2.1 In `server.js` `/api/standings`, replace `liveMatch` with `liveMatches` (date asc, slice 0..2).
- [x] 2.2 Map each entry to `{ id, date, homeTeam, awayTeam, homeTeamShort, awayTeamShort, homeScore, awayScore }` using helper from 1.1.
- [x] 2.3 Replace per-row `livePrediction` with `livePredictions` keyed by `matchId` (value = prediction or `null`).
- [x] 2.4 Remove legacy `liveMatch` from response payload (single consumer: `loadStandings`).
- [x] 2.5 `node --check server.js`.

## Phase 3: Frontend (rendering)

- [ ] 3.1 In `public/js/app.js` `loadStandings`, single map over `liveMatches` builds N `<th>` AND N `<td>` per row.
- [ ] 3.2 Header text: `${homeTeamShort} vs ${awayTeamShort}`; `title` carries full names; escapeHtml on every dynamic string.
- [ ] 3.3 Body cell: `homeScore — awayScore` (em-dash when `livePredictions[matchId]` is `null`).
- [ ] 3.4 When `liveMatches.length === 0`, render baseline header `Posición | Usuario | Puntos | Opciones` and 4-cell rows.

## Phase 4: Styling (scope discipline)

- [ ] 4.1 In `public/css/styles.css`, add `.standings-live-th` and `.standings-live-td`: narrow, monospace, live-accent, reduced padding.
- [ ] 4.2 Confirm selectors do not reuse `.score-display` or `.match-card`; visual check of fixtures view unchanged.

## Phase 5: Manual verification

- [ ] 5.1 `node --check server.js` and `node --check lib/team-abbrev.js`.
- [ ] 5.2 `curl -b cookies /api/standings` with 0 live → `liveMatches: []`; legacy `liveMatch` absent.
- [ ] 5.3 Flip 1 match to `status: 'live'` in `data/fixtures.json` → one `MEX vs SUD` column in Tabla Acumulada.
- [ ] 5.4 Flip 2 matches (different kickoffs) → two columns in date order; header/body cell counts match.
- [ ] 5.5 Flip 3+ matches → only 2 columns (earliest two).
- [ ] 5.6 Trigger `ARG`/`ARG` collision (Argentina + Argelia both live) → full names on `title` hover; column order correct.
- [ ] 5.7 Knockout placeholder set to `live` (`1A` vs `W73`) → placeholders pass through unchanged in header.
- [ ] 5.8 Restore `data/fixtures.json` to pre-test state; confirm `data/audit-log.json` untouched.

## Phase 6: Docs + commit hygiene

- [ ] 6.1 Add one-line note to `docs/PRD.md` "Accumulated Table" section: up to 2 concurrent live matches with 3-letter codes.
- [ ] 6.2 `git status`; ensure `data/audit-log.json` is not staged.
- [ ] 6.3 `git diff --check` before each commit; commit per work unit (5 commits on `feat/55-live-standings-header`).
