# Design: Standings Live Header

## Technical Approach

The backend (`GET /api/standings`) selects, orders, and pre-abbreviates live
matches; `loadStandings` builds header and body in a **single iteration over
the same array** so column counts cannot drift. The visible header shows the
real live score between the two team codes when it exists, with an em-dash
fallback when it does not. Abbreviation lives in a new pure
`lib/team-abbrev.js` mirroring the `lib/team-name-map.js` precedent. Locks:
3-letter codes, 0 live = no column, fixture order, cap 2.

## Architecture Decisions

| # | Choice | Alternatives | Decision |
|---|--------|--------------|----------|
| D1 | New `lib/team-abbrev.js` (pure, single export) | Inline in `server.js`; client-side | **lib/ helper** — matches codebase precedent; repl-testable. |
| D2 | Backend selects, orders, abbreviates | Frontend filters | **Backend** — single source of truth; frontend stays dumb. |
| D3 | Pre-compute `homeTeamShort` / `awayTeamShort` per entry | Send names; client abbreviates | **Pre-compute** — keeps `loadStandings` thin. |
| D4 | Per-row `livePredictions` keyed by `matchId` replaces `livePrediction` | First-match only | **Map** — supports 0/1/2 columns uniformly. |
| D5 | Remove legacy `liveMatch` key (single consumer) | Keep both keys | **Remove** — spec locks removal; no external API. |
| D6 | New `.standings-live-*` class family | Reuse `.score-display` / `.match-card` | **New class** — spec mandates no reuse; avoids fixtures leak. |
| D7 | Score-bearing compact header | Scoreless `HOME_SHORT vs AWAY_SHORT` | **Score-bearing** — shipped behavior uses the real live score between abbreviations while keeping the full-name `title`. |
| D8 | Scoped standings colgroup/width classes | Generic table auto sizing only | **Scoped sizing** — keeps rank/live/points/actions columns readable and aligned when 0/1/2 live columns are rendered. |

## Data Flow

    data/fixtures.json (status === 'live')
        → server.js /api/standings
            filter 'live' → sort date asc → slice(0,2)
            map → { id, date, homeTeam, awayTeam,
                    homeTeamShort, awayTeamShort, homeScore, awayScore }
            + per row: livePredictions = { matchId → {homeScore, awayScore} | null }
        → JSON → app.js loadStandings()
            one map(liveMatches): builds N <th> AND N <td> in same order
              header: "HOME_SHORT 1 — 0 AWAY_SHORT" title="home full vs away full"
              body:   "homeScore — awayScore"      (— when prediction is null)
            + standings colgroup/classes keep header/body columns aligned

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `lib/team-abbrev.js` | Create | `abbreviateTeamName(name)`: passthrough for digit-led or ≤3-char placeholders; 2-word names use the first 2 letters of word 1 plus the first letter of word 2 (`Arabia Saudita` → `ARS`); 3+ word names use the first letter of the first 3 words; single-word names use the first 3 letters. Pure, no I/O. |
| `server.js` | Modify | `/api/standings` (~637–689): `liveMatch` → `liveMatches` (slice 0..2, date asc, with `homeTeamShort`/`awayTeamShort`); per-row `livePrediction` → `livePredictions` keyed by `matchId`. |
| `public/index.html` | Modify | Add a standings-only `colgroup` hook so dynamic column sizing stays inside the accumulated table. |
| `public/js/app.js` | Modify | `loadStandings` (~719–764): map `liveMatches` once for both `<th>` and `<td>`, render score-bearing headers, and size the colgroup for 0/1/2 live columns; `title` carries full names; `escapeHtml` on every dynamic string. |
| `public/css/styles.css` | Modify | Add `.standings-live-th` and `.standings-live-td` plus standings column width/alignment classes: narrow, monospace, live-accent, smaller padding. Standings-only scope. |
| `docs/PRD.md` | Modify | "Accumulated Table": one-line note on up to 2 concurrent live matches with 3-letter codes and live score. |

## Interfaces / Contracts

```js
// lib/team-abbrev.js
function abbreviateTeamName(name) // returns 1..3 chars
//  "Argentina"           -> "ARG"
//  "Arabia Saudita"      -> "ARS" (2 letters from word 1 + 1 from word 2)
//  "República ... Congo" -> "RDD"
//  "1A", "W73", "L101"   -> unchanged (digit-led OR ≤3 chars)
```

```js
// GET /api/standings → 200
{
  standings: [{ userId, username, rank, points,
                exactCount, threeCount, zeroCount,
                goalDiffOnThree, goalDiffOnZero,
                livePredictions: { [matchId]: {homeScore, awayScore} | null } }],
  liveMatches: [{ id, matchNumber, date,
                  homeTeam, awayTeam,           // canonical Spanish
                  homeTeamShort, awayTeamShort, // 1..3 chars
                  homeScore, awayScore }]       // 0..2, date asc
}
```

## Testing Strategy

No test script in `package.json`; strict TDD disabled.

| Layer | What | How |
|-------|------|-----|
| Syntax | `server.js`, `lib/team-abbrev.js` | `node --check` on each. |
| Helper | Collisions + passthroughs | Repl loop over 48 fixture team names + `1A`/`2B`/`W73`/`L101`; eyeball collisions. |
| API shape | 0/1/2/3+ live matches | `curl -b cookies /api/standings` after editing `data/fixtures.json` `status`; verify order and cap. |
| UI counts | Header = body cells | Manual browser at `http://localhost:3001` → Tabla Acumulada; count `<th>` vs `<td>`. |
| UI layout | Columns stay aligned/readable with 0/1/2 live matches | Manual browser validation of the accumulated table after rendering score-bearing headers. |
| UI a11y | `title` carries full names | Hover each live `<th>`; tooltip shows canonical names. |
| CSS scope | `.standings-live-*` does not leak | Visual check of fixtures view. |

## Migration / Rollout

No migration. `liveMatches` and `livePredictions` replace `liveMatch` and
`livePrediction`; single consumer is `loadStandings`, updated in the same
change. Rollback = revert the work-unit commits for this change.

## Open Questions

None. Visible label is `MEX 1 — 0 SUD` when live scores exist, with `MEX — SUD` fallback when they do not — locked compactness still applies.

## Work Units (single-PR)

| # | Commit | Touches | ~LOC |
|---|--------|---------|------|
| 1 | `feat(standings): add 3-letter team abbreviation helper` | `lib/team-abbrev.js` (new) | ~25 |
| 2 | `feat(standings): expose up to 2 live matches with pre-computed abbreviations` | `server.js` | ~30 |
| 3 | `feat(ui): render 0/1/2 live columns in Tabla Acumulada header` | `public/js/app.js` | ~25 |
| 4 | `feat(ui): style standings live columns as compact monospace` | `public/css/styles.css` | ~25 |
| 5 | `docs(standings): note up to 2 live matches in PRD` | `docs/PRD.md` | ~3 |

≈ 110 net lines, single-PR (under 400-line budget). Tests/docs ride with their behavior
