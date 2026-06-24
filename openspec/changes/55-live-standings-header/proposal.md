# Proposal: 55-live-standings-header

## Intent

The Accumulated Standings shows one live header column
(`En vivo: México vs Sudáfrica`) for the first live fixture;
concurrent live matches are invisible. This change broadens the
header to up to two concurrent matches with compact 3-letter team
codes plus the real live score between them in fixture order, and
suppresses the column when no match is live.

## Scope

### In Scope
- `GET /api/standings`: `liveMatch` → `liveMatches` (capped at 2);
  per-row `livePredictions` keyed by `matchId`.
- New `lib/team-abbrev.js`: 3-letter helper. First letter per word
  for multi-word names; first three letters otherwise. Pass
  placeholders (`1A`, `W73`) through unchanged.
- Backend attaches `homeTeamShort` / `awayTeamShort` per live match;
  full names stay canonical for the `title` attribute.
- `loadStandings()` renders 0/1/2 live columns in fixture order;
  header and body cells built from the same array in one pass.
- Live header text is score-bearing (`HOME_SHORT 1 — 0 AWAY_SHORT`)
  with an em-dash fallback when the live score is unavailable.
- CSS: `.standings-live-*` block plus scoped standings column sizing
  so header/body columns stay aligned and readable with 0/1/2 live
  columns.
- One-line update to `docs/PRD.md` "Accumulated Table" section.

### Out of Scope
- Auto-refresh of standings view during a live match.
- Collision disambiguation — locked decision accepts collisions.

## Capabilities

### New Capabilities
- `standings-live-header`: live header column(s) in accumulated
  standings, 0–2 matches with 3-letter codes and live score in
  fixture order.

### Modified Capabilities
- None.

## Approach

Mirrors the `lib/team-name-map.js` precedent (single-responsibility
`lib/` module). Backend owns selection and abbreviation; frontend
iterates `liveMatches` for header and body in one pass. Locked:
3-letter codes only, compactness over clarity, fixture order, cap 2.

## Affected Areas

| Area | Impact |
|------|--------|
| `lib/team-abbrev.js` | New 3-letter helper. |
| `server.js` `/api/standings` (~637–689) | `liveMatch` → `liveMatches`; per-row `livePredictions`. |
| `public/index.html` | Standings-only `colgroup` hook for dynamic column sizing. |
| `public/js/app.js` `loadStandings` (~719–764) | 0/1/2 live columns from same array plus score-bearing headers and colgroup sizing. |
| `public/css/styles.css` | `.standings-live-*` block plus scoped standings alignment rules. |
| `docs/PRD.md` | One-line "Accumulated Table" update. |

## Risks

| Risk | Mitigation |
|------|------------|
| Header/body misalignment for 0/1/2 counts | Build both from same `liveMatches` in one pass and size the standings columns with scoped colgroup/CSS rules. |
| Collision (e.g. `ARG`/`ARG`) leaves header ambiguous | Accepted by locked decision; full name on `title`. |
| Stale live data while view is open | Out of scope; fixtures polling is fixtures-only. |
| Knockout placeholders mis-abbreviated | Helper passes placeholders unchanged. |

## Rollback Plan

Revert the commits. API returns to single `liveMatch` shape;
frontend reverts to the single live column. No data migration
(additive API change, single consumer).

## Dependencies

- `lib/team-name-map.js` precedent for `lib/` module shape.
- `data/fixtures.json` for manual verification only.

## Success Criteria

- [ ] `GET /api/standings` returns `liveMatches` (0–2, fixture order)
      and per-row `livePredictions` keyed by `matchId`.
- [ ] Header shows 0/1/2 live columns; cap 2 enforced.
- [ ] 3-letter codes with the real live score between them when available; full name on `title`; row cells aligned to header.
- [ ] `node --check server.js` passes; manual 0/1/2/3+ verification OK.
