## Exploration: GitHub issue #55 — Tabla Acumulada live header improvements

### Current State

`/api/standings` (server.js:637–689) returns `{ standings, liveMatch }` where
`liveMatch` is the FIRST fixture with `status === 'live'` (or `null`). Each
standings row carries a single `livePrediction` field — the matched user's
prediction for that one match, or `null`.

Frontend consumption is in `loadStandings()` (public/js/app.js:719–750). The
`#standingsBody` table renders the header (`theadRow.innerHTML`) and rows from
a hard-coded layout: `Posición | Usuario | <live header> | Puntos | Opciones`.
The live header currently says:
`En vivo: México vs Sudáfrica`
and each user row gets a single live-prediction cell showing
`homeScore — awayScore` or `—` for no prediction.

`/api/standings` is read-only here, called on `standingsView` open. It is not
auto-refreshed today (only `fixturesView` has a polling timer via
`startFixtureAutoRefresh` at app.js:207–214). Header and cell state therefore
go stale during a live match until the user re-opens the view.

`lib/team-name-map.js` already centralises the Spanish team-name vocabulary
(group-stage only, 48 teams; knockout placeholders like "W73", "1A" are
intentionally absent). It is consumed by `lib/worldcup-sync.js` only; not by
the standings or any UI surface.

Sample live state from `data/fixtures.json` (runtime data, two concurrent
live matches present today):
- m-041 Noruega vs Senegal — kickoff 2026-06-23T00:00:00Z
- m-042 Francia vs Irak — kickoff 2026-06-22T21:00:00Z

### Affected Areas

- `server.js:643` — `const liveMatch = fixtures.find((m) => m.status === 'live') || null;`
  Must change to a sorted, capped array.
- `server.js:668–670` — the per-row `livePrediction` derivation uses
  `userPredictions.find((p) => p.matchId === liveMatch.id)`. Must produce a
  prediction PER live match so the frontend can map columns.
- `server.js:688` — `res.json({ standings, liveMatch });` response shape change.
- `public/js/app.js:720` — `const [{ standings, liveMatch }, prizePool] = …`
  destructures the now-removed `liveMatch` key.
- `public/js/app.js:725–729` — `theadRow.innerHTML` is rebuilt on every
  `loadStandings()`; needs to render 0/1/2 `<th>` live columns.
- `public/js/app.js:732–749` — row HTML template uses one live-prediction cell.
  Needs up to two cells, one per live match in the same order as the header.
- `public/js/app.js` (new) — `abbreviateTeamName(name)` helper. Place near the
  other pure helpers (around `escapeHtml` line 103, or right above
  `loadStandings`).
- `public/js/app.js` (new) — `selectEarliestLiveMatches(fixtures, n)` helper,
  OR this lives in the backend and the client just consumes the array.
- `public/css/styles.css` — minor table-cell styling for compact live header
  (smaller font, monospace score, column width hint) and per-cell live status
  accent. Existing `.score-display` (line 381) and `.match-card.live-card`
  (line 288) are NOT reused; new classes scoped to `.standings-live-*` keep
  the change isolated.
- `public/index.html:302` — `<thead><tr></tr></thead>` is already empty and
  rebuilt by JS, no markup change required.
- `docs/PRD.md` "Accumulated Table" section (line 80) — does not mention the
  live header today; the spec phase should decide if a one-line update is
  warranted (live header is a behaviour change to existing surface, so yes).

### Approaches

1. **All backend, minimal frontend** — server returns the full sorted live
   list and the per-row prediction array; client just iterates. Single
   source of truth for selection logic and abbreviation.
   - Pros: deterministic, server picks earliest, client is dumb renderer.
     Easy to unit-test pure functions later if/when a test runner is added.
     Reuses `lib/team-name-map.js` if abbreviation lives there.
   - Cons: ships more data over the wire (negligible — max 2 matches). Ties
     abbreviation to the API shape; client can't re-derive on a stale cache.
   - Effort: Low.

2. **All frontend** — server still emits a single `liveMatch` (or first two);
   client sorts, caps, and abbreviates.
   - Pros: no API shape change risk to other consumers; smaller blast radius.
   - Cons: duplication of "earliest two" logic; client has to know
     "earliest by `date`" semantics that the rest of the code currently
     enforces in only one place (server). Abbreviation logic ends up in JS
     where there is no shared module for the 48-team vocabulary, and would
     need a new client-side map to mirror `lib/team-name-map.js`. Two
     sources of truth for "what's a team name" become possible.

3. **Backend array + frontend abbreviation** — server returns
   `liveMatches: Match[]` sorted ascending by `date`, sliced to first 2;
   client abbreviates for display only. Abbreviation helper lives in a
   small new module (e.g. `lib/team-abbrev.js`) consumed by both server
   and client (or the server-side `abbreviateTeamName` runs at response
   time and the client receives the abbreviated fields directly).
   - Pros: cleanest separation. Server owns ordering; client owns display
     detail. Helper unit-testable in isolation. Single source of truth for
     the team-name vocabulary (parallel to `team-name-map.js`).
   - Cons: introduces a new `lib/team-abbrev.js` module (small). Two calls
     sites for the same helper (server response builder + maybe nothing
     client-side, if server pre-abbreviates).
   - Effort: Low–Medium.

### Recommendation

Approach 3. It mirrors the existing `lib/team-name-map.js` precedent (a
small, focused, pure-data module under `lib/`), keeps the change isolated
behind a new module, and lets the server own the "first 2 by kickoff
ascending" rule that downstream consumers can rely on without re-deriving
it. Concretely:

- Backend adds `selectEarliestLiveMatches(fixtures, 2)` and
  `abbreviateTeamName(name)` helpers (server.js OR a new `lib/live-matches.js`
  if the design phase prefers to extract; `lib/team-name-map.js` is the
  precedent for a single-responsibility module).
- Response shape becomes `{ standings, liveMatches: Match[] }` (0–2 entries
  sorted ascending by `date`). Each standings row gets
  `livePredictions: { [matchId]: { homeScore, awayScore } | null }`
  so the client can map columns in the same order.
- Frontend `loadStandings()` renders 0/1/2 live columns by iterating
  `liveMatches`; the abbreviation is sent pre-computed by the server as
  `homeTeamShort` / `awayTeamShort` on each match, with `title="<full name>"`
  for hover/tooltip accessibility. The full name stays as the canonical
  `homeTeam` / `awayTeam` so `title` and any future reuse don't need
  translation.

### Risks

- **Header-cell alignment for 0/1/2 live matches** — the existing
  `theadRow.innerHTML` is rebuilt on every load. The body row template must
  render the same number of live cells as the header or columns will
  misalign. Mitigation: build header HTML and body cells from the same
  `liveMatches.length` in one pass inside `loadStandings()`.
- **Stale header during a live match** — `loadStandings()` is only called on
  view open. The 30 s `startFixtureAutoRefresh` (app.js:207) is wired to
  `fixturesView` only and bails on other views. The user re-opening or
  switching to `standingsView` will see fresh data, but a live score
  updated mid-session will not appear until then. Out of scope for the
  header change itself, but worth flagging; the existing fixture polling
  is trivially extensible to `standingsView` and could be a follow-up.
- **Abbreviation collisions** — confirmed via exploration of the 48 named
  teams: `Argentina`/`Argelia` both abbreviate to `ARG`; `Australia`/
  `Austria` both to `AUS`; `Arabia Saudita`/`AS…`; etc. Live-header scope
  (max 2 simultaneous matches) means both members of a colliding pair
  COULD be live at the same time (different groups, simultaneous kickoff
  is realistic). The header MUST remain unambiguous. Options:
  (a) show the full name in the header instead of abbreviation when
  collisions are possible for the displayed set, (b) include the group
  letter as a 4th character (e.g. `ARG·A` vs `ARG·D`) for header,
  (c) use the canonical 3-letter scheme but ALWAYS set the full team
  name as the `title` attribute and visually encode the group somewhere
  on the row/header so ambiguity is resolvable on inspection.
  Design phase should pick one and document the rule; this exploration
  recommends (a) — render the full team name in the live header (not
  abbreviated), with abbreviation as a secondary visual cue, because
  visual disambiguation matters more than compactness in a 2-column-wide
  table header. This is a deliberate departure from the strict 3-letter
  rule for the few cases where it would mislead.
- **Knockout placeholder names** — `1A`, `W73`, etc. abbreviate trivially but
  the team-name vocabulary change makes no sense for them. The helper must
  return the placeholder unchanged when it does not look like a real
  team name (digits at start, or no space in the input).
- **Forward compatibility** — if the live-match cap later grows from 2 to
  N, the client-side header and body code currently baked for 2 columns
  needs a small refactor (looping already does the work; only the
  "max 2" integer is the magic number). Designing the helper to take
  the cap as a parameter avoids hard-coding "2" in three places.

### Ready for Proposal

Yes. All required context is on disk and verified. The spec phase can:

- Lock the new response shape (`liveMatches: Match[]` + per-row
  `livePredictions: { [matchId]: Prediction | null }`).
- Define the abbreviation algorithm precisely with a collision-handling
  rule, plus the cap (`2`).
- Enumerate the two or three header-column layout variants (0/1/2 live
  matches) as concrete scenarios.

The orchestrator can hand this to `sdd-propose` next.

### Work Units (estimated reviewer load)

Each unit is one commit, mapped to a 200-line-or-less diff for the
configured 800-line chained-PR budget. PR is small enough to ship in
one PR (chained strategy ask-always → confirm with user; total
estimate below the 800-line threshold for single PR, but two narrow
chained PRs is also viable and worth asking the user).

| # | Unit | Files | LoC est. |
|---|------|-------|----------|
| 1 | `lib/team-abbrev.js`: pure helper, 48-team lookup + collision rule + 3-letter-from-words algorithm + "leave placeholders alone" guard | new file | ~70 |
| 2 | Backend: `selectEarliestLiveMatches(fixtures, 2)` + new response shape `{ standings, liveMatches, livePredictionsByUserId }` | server.js (route ~640–690) | ~50 |
| 3 | Backend: send pre-abbreviated `homeTeamShort` / `awayTeamShort` on each `liveMatch` via `team-abbrev.js` | server.js (route ~660) | ~10 |
| 4 | Frontend: switch `loadStandings()` to render 0/1/2 live columns; use pre-abbreviated codes; full name as `title`; align header and body in one loop | public/js/app.js (~719–750) | ~60 |
| 5 | Styling: `.standings-live-cell`, `.standings-live-score`, accent for live status, ensure column widths hold on mobile | public/css/styles.css (new block + responsive) | ~40 |
| 6 | Docs: one-line update to PRD.md "Accumulated Table" section | docs/PRD.md | ~5 |
| 7 | Audit/manual: manual test plan executed in browser at `pnpm dev` for 0/1/2/3+ live match states | (no file change) | 0 |

Total: ~235 changed lines across 6 files, well under the 800-line budget.
Single PR is feasible; chained PRs only if the user prefers a
backend-first / frontend-second split (work units 1–3 then 4–5).

### Manual Verification Plan

With the app running (`pnpm dev`, http://localhost:3001):

1. `node --check server.js` — backend syntax gate (mandatory).
2. Log in as a regular user. Open "Tabla Acumulada" with 0 live matches
   in `data/fixtures.json` — confirm header is `Posición | Usuario |
   Puntos | Opciones` (no live column).
3. Manually flip ONE match to `status: 'live'` with scores in
   `data/fixtures.json` — refresh the view, confirm ONE live column
   appears with the two team names (full, not abbreviated) and a small
   `homeScore — awayScore` underneath. Confirm each user row has the
   matching prediction cell.
4. Flip a SECOND match to `live` (different group) — refresh, confirm
   TWO live columns, ordered by kickoff time ascending. The earlier
   kickoff appears LEFT. Each user row has two prediction cells in the
   same order.
5. Flip a THIRD match to `live` — refresh, confirm the table still shows
   only TWO live columns (the two earliest kickoffs). The third live
   match does NOT appear as a column.
6. Trigger the abbreviation collision case: flip `Argentina` and
   `Argelia` matches to `live` (different groups, same kickoff time).
   Refresh and confirm the header disambiguates the two teams (full
   names visible; no `ARG` / `ARG` collision that would leave the user
   guessing). `title` attribute shows the full name regardless.
7. Switch to a different view, then back to Tabla Acumulada — confirm
   fresh data loads.
8. Knockout placeholders (1A, W73): set the status of a knockout
   placeholder match to `live` (artificial, but possible if an admin
   does it). Confirm the header shows the placeholder unchanged.
9. Log in as admin, open Tabla Acumulada, click "Ver detalle" on a row —
   confirm the per-user detail modal still works (regression check on
   `loadStandingDetail` and `/api/standings/:userId`, which is unrelated
   to the live header but shares the standings view).
10. Verify `data/audit-log.json` is NOT modified by any of the above
    user actions (read-only endpoints).
11. `git diff --check` before committing to catch trailing whitespace /
    conflict markers.
12. Restore `data/fixtures.json` to the runtime state if any test
    changes were made — do not commit those changes.
