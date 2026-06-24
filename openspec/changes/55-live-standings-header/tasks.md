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
| 3 | UI 0/1/2 live columns | `feat(ui): render 0/1/2 live columns in Tabla Acumulada header` | `public/js/app.js` loadStandings; one-pass header+body with score-bearing headers. |
| 4 | Compact monospace style | `feat(ui): style standings live columns as compact monospace` | `public/css/styles.css`; new `.standings-live-*` plus scoped standings alignment. |
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

- [x] 3.1 In `public/js/app.js` `loadStandings`, single map over `liveMatches` builds N `<th>` AND N `<td>` per row.
- [x] 3.2 Header text: `${homeTeamShort} ${liveScore} ${awayTeamShort}` with `—` fallback; `title` carries full names; escapeHtml on every dynamic string.
- [x] 3.3 Body cell: `homeScore — awayScore` (em-dash when `livePredictions[matchId]` is `null`).
- [x] 3.4 When `liveMatches.length === 0`, render baseline header `Posición | Usuario | Puntos | Opciones` and 4-cell rows.

## Phase 4: Styling (scope discipline)

- [x] 4.1 In `public/css/styles.css`, add `.standings-live-th` and `.standings-live-td`: narrow, monospace, live-accent, reduced padding, plus scoped standings alignment/sizing.
- [x] 4.2 Confirm selectors do not reuse `.score-display` or `.match-card`; visual check of fixtures view unchanged.

## Phase 5: Manual verification

- [x] 5.1 `node --check server.js` and `node --check lib/team-abbrev.js`.
- [x] 5.2 `curl -b cookies /api/standings` with 0 live → `liveMatches: []`; legacy `liveMatch` absent.
- [x] 5.3 Flip 1 match to `status: 'live'` in `data/fixtures.json` → one `MEX 1 — 0 SUD` score-bearing column in Tabla Acumulada.
- [x] 5.4 Flip 2 matches (different kickoffs) → two columns in date order; header/body cell counts match.
- [x] 5.5 Flip 3+ matches → only 2 columns (earliest two).
- [x] 5.6 Trigger `ARG`/`ARG` collision (Argentina + Argelia both live) → full names on `title` hover; column order correct.
- [x] 5.7 Knockout placeholder set to `live` (`1A` vs `W73`) → placeholders pass through unchanged in header.
- [x] 5.8 Restore `data/fixtures.json` to pre-test state; confirm `data/audit-log.json` untouched.

## Phase 6: Docs + commit hygiene

- [x] 6.1 Add one-line note to `docs/PRD.md` "Accumulated Table" section: up to 2 concurrent live matches with 3-letter codes and live score.
- [x] 6.2 `git status`; ensure `data/audit-log.json` is not staged.
- [x] 6.3 `git diff --check` before each commit; commit per work unit on `feat/55-live-standings-header`.

## Phase 7: Corrective continuation

- [x] 7.1 Align proposal/spec/design/tasks/apply-progress with the shipped score-bearing header behavior.
- [x] 7.2 Tighten accumulated table column sizing/alignment so 0/1/2 live columns stay readable in the browser.
- [x] 7.3 Re-run syntax and diff hygiene checks for the corrective continuation.

## Phase 8: Corrective continuation follow-up

- [x] 8.1 Refine proposal/spec/design wording so the verified 2-word abbreviation rule explicitly matches `Arabia Saudita -> ARS`.
- [x] 8.2 Center and evenly distribute Tabla Acumulada header/body columns so 0/1/2 live-column layouts share the same horizontal grid.
- [x] 8.3 Re-run syntax and diff hygiene checks for the follow-up continuation.
