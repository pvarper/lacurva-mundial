# Apply Progress: Standings Live Header

## Mode

Standard

## Completed Tasks

- [x] 1.1 Create `lib/team-abbrev.js` exporting `abbreviateTeamName(name)` (pure, no I/O).
- [x] 1.2 Implement placeholder passthrough (digit-led or ≤3 chars) before any rule.
- [x] 1.3 Implement multi-word (first letter of ≤3 words) and single-word (first 3 chars) rules; uppercase.
- [x] 1.4 `node --check lib/team-abbrev.js`.
- [x] 1.5 Repl loop over fixture team names plus placeholder values; confirmed collisions and passthrough behavior.
- [x] 2.1 Replace `liveMatch` with `liveMatches` in `/api/standings`.
- [x] 2.2 Pre-compute full and short team names for up to 2 live matches.
- [x] 2.3 Replace per-row `livePrediction` with `livePredictions` keyed by `matchId`.
- [x] 2.4 Remove the legacy `liveMatch` payload key.
- [x] 2.5 `node --check server.js`.
- [x] 3.1 Build live `<th>` and `<td>` cells from the same `liveMatches` source in `loadStandings()`.
- [x] 3.2 Render `${homeTeamShort} ${liveScore} ${awayTeamShort}` with `—` fallback, full names in `title`, and `escapeHtml` on dynamic strings.
- [x] 3.3 Render `homeScore — awayScore` or `—` from `livePredictions[matchId]`.
- [x] 3.4 Preserve the 4-column baseline when there are 0 live matches.
- [x] 4.1 Add `.standings-live-th` and `.standings-live-td` compact monospace styling plus standings-only alignment sizing.
- [x] 4.2 Keep styling scoped to standings without reusing `.score-display` or `.match-card`.
- [x] 5.1 Run syntax checks for `server.js`, `lib/team-abbrev.js`, and `public/js/app.js`.
- [x] 5.2 Verify `liveMatches: []` and no legacy `liveMatch` key when 0 matches are live.
- [x] 5.3 Verify a single live match returns a score-bearing `MEX 1 — 0 SUD` header.
- [x] 5.4 Verify 2 live matches stay in fixture-date order.
- [x] 5.5 Verify 3+ live matches are capped to the earliest 2.
- [x] 5.6 Verify `ARG` collisions are preserved.
- [x] 5.7 Verify knockout placeholders pass through unchanged.
- [x] 5.8 Restore runtime data after verification.
- [x] 6.1 Add the PRD note for up to 2 concurrent live matches with live score.
- [x] 6.2 Confirm `data/audit-log.json` is not staged.
- [x] 6.3 Run `git diff --check` before each commit and commit per work unit.
- [x] 7.1 Align proposal/spec/design/tasks/apply-progress with the shipped score-bearing header behavior.
- [x] 7.2 Tighten accumulated table column sizing/alignment so 0/1/2 live columns stay readable in the browser.
- [x] 7.3 Re-run syntax and diff hygiene checks for the corrective continuation.

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `lib/team-abbrev.js` | Created/Modified | Added the pure abbreviation helper, placeholder passthrough, diacritic stripping, and 2-word/3-word abbreviation rules. |
| `server.js` | Modified | Replaced single live match payload with capped `liveMatches` and per-row `livePredictions`. |
| `public/index.html` | Modified | Added a standings-only `colgroup` hook for controlled column sizing. |
| `public/js/app.js` | Modified | Rendered 0/1/2 live standings columns from one `liveMatches` source with score-bearing headers, escaped labels, title attributes, and dynamic colgroup sizing. |
| `public/css/styles.css` | Modified | Added compact monospace standings-only live column styling plus scoped alignment/sizing rules. |
| `docs/PRD.md` | Modified | Documented up to 2 concurrent live matches in the accumulated table with the live score in the header. |
| `openspec/changes/55-live-standings-header/proposal.md` | Modified | Aligned proposal language with score-bearing headers and scoped alignment styling. |
| `openspec/changes/55-live-standings-header/specs/standings-live-header/spec.md` | Modified | Aligned acceptance criteria with score-bearing headers and explicit layout readability requirements. |
| `openspec/changes/55-live-standings-header/design.md` | Modified | Aligned design decisions/data flow with score-bearing headers and standings-only column sizing. |
| `openspec/changes/55-live-standings-header/tasks.md` | Modified | Updated completed tasks to reflect score-bearing headers and added corrective continuation tasks. |

## Verification

- `node --check server.js`
- `node --check lib/team-abbrev.js`
- `node --check public/js/app.js`
- `git diff --check` before each commit
- Focused corrective verification: confirmed `loadStandings()` now renders the live header with the actual `homeScore — awayScore` between abbreviated teams when the API provides live scores.
- Corrective continuation browser/layout validation: confirmed the standings table keeps readable column boundaries and aligned header/body cells with 0, 1, or 2 live columns after adding the standings-only colgroup and width classes.
- Isolated authenticated API verification on a temporary local server for:
  - 0 live matches
  - 1 live match (`MEX 1 — 0 SUD`)
  - 2 live matches in date order
  - 3+ live matches capped to 2
  - `ARG` collision preservation
  - knockout placeholder passthrough (`1A` vs representative placeholder fixture data)

## Deviations from Design

None — implementation matches the updated design, with one clarification from spec examples: 2-word names use the first 2 letters of the first word plus the first letter of the second to keep a 3-character result.

## Issues Found

- The original helper implementation failed spec examples for diacritics (`MÉX`) and 2-word names (`AS`), so a follow-up fix commit normalized both cases.
- The fixture seed data does not include the exact `1A` vs `W73` example from the task text; verification used the available placeholder fixture `1A` vs `3CEFHI` to validate unchanged passthrough behavior.
- Corrective continuation: `loadStandings()` was still rendering only abbreviated team names in the live standings header even though `/api/standings` already exposed `homeScore` and `awayScore`; the header now includes the real live score with a safe fallback to `—`.
- Corrective continuation: the accumulated table needed explicit standings-only column sizing because two live columns made the generic auto-sized header/body layout look cramped and visually misaligned in the browser.

## Workload / PR Boundary

- Mode: single PR
- Current work unit: complete change
- Boundary: live standings header helper, API shape, UI rendering, styling, docs, and verification
- Estimated review budget impact: still well under the 800-line session budget

## Status

29/29 tasks complete. Corrective continuation applied; ready for verify.
