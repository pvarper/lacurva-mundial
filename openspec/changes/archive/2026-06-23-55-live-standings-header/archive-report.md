# Archive Report: 55-live-standings-header

## Change

- **Name**: `55-live-standings-header`
- **Branch**: `feat/55-live-standings-header`
- **Capability**: `standings-live-header` (new)
- **Archived on**: 2026-06-23
- **Archived to**: `openspec/changes/archive/2026-06-23-55-live-standings-header/`

## Status

**PASS — closed**

- All 32/32 implementation tasks complete in `tasks.md` and reflected in `apply-progress.md`.
- `verify-report.md` returned **PASS** after corrective continuations and a user-validated browser screenshot confirmed the standings table renders an evenly distributed grid for 0, 1, and 2 live columns.
- No CRITICAL issues, no stale unchecked tasks, no missing artifacts.

## Specs Synced

| Domain / Capability | Action | Details |
|---------------------|--------|---------|
| `standings-live-header` | **Created** (new capability) | Copied delta spec verbatim from `openspec/changes/55-live-standings-header/specs/standings-live-header/spec.md` to `openspec/specs/standings-live-header/spec.md`. No prior main spec existed. |

No other capability was modified, so no other main spec was touched.

## Archive Contents

- `proposal.md` ✅
- `design.md` ✅
- `tasks.md` ✅ (32/32 tasks complete, no unchecked boxes)
- `specs/standings-live-header/spec.md` ✅
- `apply-progress.md` ✅
- `verify-report.md` ✅
- `explore.md` ✅ (preserved for audit trail)
- `archive-report.md` ✅ (this file)

## Source of Truth Updated

The following main spec now reflects the new behavior:

- `openspec/specs/standings-live-header/spec.md` — new capability for the
  Accumulated Standings live header (0/1/2 live columns, 3-letter team
  codes, live score in the header, per-row `livePredictions` keyed by
  `matchId`, backend-owned selection in fixture-date order, cap 2).

## What the Change Delivered

### Backend

- `lib/team-abbrev.js` — pure `abbreviateTeamName(name)` helper. 3-letter
  codes for single-word names; first 2 letters of word 1 + first letter
  of word 2 for 2-word names (`Arabia Saudita` → `ARS`); first letter of
  the first 3 words for 3+ word names (`República Democrática del Congo`
  → `RDD`); placeholder passthrough for digit-led or ≤3-char codes
  (`1A`, `W73`, `L101`). Collisions (e.g. `Argentina`/`Argelia` → `ARG`)
  are accepted and the full name remains on the `title` attribute.
- `server.js` `GET /api/standings` — `liveMatch` removed; `liveMatches`
  array capped at 2, ordered by fixture `date` ascending, with
  `homeTeamShort` / `awayTeamShort` pre-computed. Per-row `livePrediction`
  replaced by `livePredictions` keyed by `matchId`.

### Frontend

- `public/index.html` — standings-only `colgroup` hook for controlled,
  equal-width column sizing.
- `public/js/app.js` `loadStandings` — single map over `liveMatches`
  builds N `<th>` and N `<td>` per row in the same order. Header text is
  `${homeTeamShort} ${homeScore} — ${awayScore} ${awayTeamShort}` with a
  `—` fallback when the live score is unavailable. `title` carries the
  full Spanish team names. `escapeHtml` is applied to every dynamic
  string. With 0 live matches the table falls back to the baseline 4-cell
  header.
- `public/css/styles.css` — `.standings-live-th` and `.standings-live-td`
  block plus a standings-only scoped alignment/width grid. No reuse of
  `.score-display` or `.match-card`.

### Docs

- `docs/PRD.md` — one-line note in the "Accumulated Table" section
  documenting the up to 2 concurrent live matches, 3-letter codes, and
  live score in the header.

## Verification Evidence

- `node --check server.js` ✅
- `node --check lib/team-abbrev.js` ✅
- `node --check public/js/app.js` ✅
- Helper cases manually verified: `Argentina`/`Argelia` → `ARG`,
  `Australia`/`Austria` → `AUS`, `Arabia Saudita` → `ARS`,
  `México` → `MEX`, `Sudáfricá` → `SUD`,
  `República Democrática del Congo` → `RDD`, placeholders `1A`/`W73`/
  `L101` pass through unchanged.
- API contract manually verified for 0/1/2/3+ live matches, with `ARG`
  collision preservation and placeholder passthrough.
- User-supplied browser screenshot validated the equal-width, centered
  standings grid for 0/1/2 live columns.

## Deviations from Design

None. Implementation matches the updated design after the corrective
continuation rounds (artifact alignment, equal-width grid).

## Non-Blocking Suggestions (for future work)

- `standings-user-th/td` is intentionally left-aligned for consistency
  with the rest of the app's tables. Revisit only if the user requests
  centered usernames in standings.
- `loadStandings()` injects inline `style="width:..."` on the dynamic
  `<col>` elements, which currently overrides the CSS `.standings-col-*`
  rules. Revisit only if a future change needs CSS-controlled widths.

## Workload / PR Boundary

- Single PR, 5 work-unit commits on `feat/55-live-standings-header`.
- Total change well under the 400-line review budget.

## SDD Cycle

Closed. The change is planned, implemented, verified, and archived.
The new `standings-live-header` capability is now part of the source of
truth in `openspec/specs/`. Ready for the next change.
