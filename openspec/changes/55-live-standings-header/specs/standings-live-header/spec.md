# Spec: Standings Live Header

## Purpose

The Accumulated Standings table MUST surface up to two concurrent live
matches as compact columns in the table header, ordered by fixture kickoff
ascending. When no match is live, no live column is rendered. Live column
labels use 3-letter team abbreviations with the real live score between
them when available; the full team name remains on the `title` attribute
and on the row's prediction cell for unambiguity.

## Requirements

### Requirement: Live Match Selection

`GET /api/standings` MUST select at most 2 fixtures with
`status === 'live'`, ordered by `date` ascending (earliest kickoff
first). Selection is server-side and authoritative.

#### Scenario: Two concurrent live matches

- GIVEN two fixtures with `status: 'live'` and `date` values `T1` and `T2` where `T1 < T2`
- WHEN `GET /api/standings` is called
- THEN the response includes `liveMatches` with 2 entries, the first entry's `date` is `T1` and the second's is `T2`

#### Scenario: More than two live matches

- GIVEN three or more fixtures with `status: 'live'`
- WHEN `GET /api/standings` is called
- THEN `liveMatches` contains exactly the 2 with the earliest `date` values, in ascending order

#### Scenario: No live matches

- GIVEN zero fixtures with `status: 'live'`
- WHEN `GET /api/standings` is called
- THEN `liveMatches` is an empty array

#### Scenario: No live key in response on legacy consumers

- GIVEN a `liveMatches` array (possibly empty)
- WHEN the response is serialized
- THEN the legacy `liveMatch` key is NOT present; only `liveMatches` is emitted

### Requirement: Response Shape

Each `liveMatches` entry MUST expose the full team names
(`homeTeam`, `awayTeam`) AND the pre-computed 3-letter
abbreviations (`homeTeamShort`, `awayTeamShort`).

#### Scenario: Live match entry carries both full and short names

- GIVEN a live fixture `homeTeam: 'México'`, `awayTeam: 'Sudáfricá'`
- WHEN the response is built
- THEN the entry contains `homeTeam: 'México'`, `awayTeam: 'Sudáfricá'`, `homeTeamShort: 'MEX'`, `awayTeamShort: 'SUD'`

### Requirement: Per-Row Live Predictions

Each standings row MUST carry a `livePredictions` object keyed by
`matchId`, mapping to `{ homeScore, awayScore }` or `null` when the
user has not predicted that match.

#### Scenario: User has predicted both live matches

- GIVEN a user with predictions for both `m-041` and `m-042`
- WHEN the standings row is built
- THEN `livePredictions` is `{ 'm-041': { homeScore, awayScore }, 'm-042': { homeScore, awayScore } }`

#### Scenario: User has predicted one live match

- GIVEN a user with a prediction for `m-041` only
- WHEN the standings row is built
- THEN `livePredictions['m-041']` is the prediction object and `livePredictions['m-042']` is `null`

#### Scenario: User has predicted neither

- GIVEN a user with no predictions for the live match ids
- WHEN the standings row is built
- THEN `livePredictions` is `{ 'm-041': null, 'm-042': null }`

### Requirement: 3-Letter Abbreviation Algorithm

`abbreviateTeamName(name)` MUST return exactly 3 uppercase characters.
For 2-word names it takes the first 2 letters of word 1 plus the first
letter of word 2 (`Arabia Saudita` → `ARS`). For 3+ word names it takes
the first letter of each of the first 3 words. For single-word names it
takes the first 3 letters. The algorithm accepts collisions (e.g.
`Argentina` and `Argelia` both → `ARG`).

#### Scenario: Two-word name keeps a 3-character result

- GIVEN `abbreviateTeamName('Arabia Saudita')`
- WHEN called
- THEN it returns `'ARS'`

#### Scenario: Single-word name uses first three letters

- GIVEN `abbreviateTeamName('México')`
- WHEN called
- THEN it returns `'MEX'`

#### Scenario: More than three words is truncated to first three word initials

- GIVEN `abbreviateTeamName('República Democrática del Congo')`
- WHEN called
- THEN it returns `'RDD'` (first letter of first 3 words)

#### Scenario: Collisions are accepted

- GIVEN `abbreviateTeamName('Argentina')` and `abbreviateTeamName('Argelia')`
- WHEN both are called
- THEN both return `'ARG'`; the helper does NOT disambiguate

### Requirement: Placeholder Passthrough

`abbreviateTeamName(name)` MUST return the input unchanged when it
looks like a knockout placeholder: starts with a digit (e.g. `1A`,
`2B`) OR is short enough to already be a code (e.g. `W73`, `L101`).

#### Scenario: Group-letter placeholder passes through

- GIVEN `abbreviateTeamName('1A')`
- WHEN called
- THEN it returns `'1A'`

#### Scenario: Winner-path placeholder passes through

- GIVEN `abbreviateTeamName('W73')`
- WHEN called
- THEN it returns `'W73'`

### Requirement: Zero Live Columns

When `liveMatches` is empty, the standings table header MUST NOT include
a live column and each standings row MUST NOT include live cells.

#### Scenario: No live matches → no live column

- GIVEN a response with `liveMatches: []`
- WHEN `loadStandings()` renders the table
- THEN the header is `Posición | Usuario | Puntos | Opciones` and each row has exactly 4 cells

### Requirement: One or Two Live Columns in Fixture Order

When `liveMatches` has 1 or 2 entries, the table renders that many live
columns, left to right in the same order as the response array (which
is `date` ascending). Each column header shows `HOME_SHORT SCORE AWAY_SHORT`
using the live match score when available, with the full team names on
the `title` attribute.

#### Scenario: One live match → one score-bearing column

- GIVEN `liveMatches: [{ id: 'm-041', homeTeam: 'México', awayTeam: 'Sudáfricá', homeTeamShort: 'MEX', awayTeamShort: 'SUD', homeScore: 1, awayScore: 0 }]`
- WHEN `loadStandings()` renders the header
- THEN a single `<th>` is emitted with visible text `MEX 1 — 0 SUD` and `title="México vs Sudáfricá"`

#### Scenario: Two live matches → two score-bearing columns in date order

- GIVEN `liveMatches: [{ id: 'm-041', date: T1, homeTeamShort: 'A', awayTeamShort: 'B', homeScore: 1, awayScore: 0 }, { id: 'm-042', date: T2, homeTeamShort: 'C', awayTeamShort: 'D', homeScore: 2, awayScore: 2 }]`
- WHEN `loadStandings()` renders the header
- THEN two `<th>` cells appear left-to-right: `A 1 — 0 B` then `C 2 — 2 D`

#### Scenario: Live score unavailable → header falls back to separator only

- GIVEN `liveMatches: [{ id: 'm-041', homeTeamShort: 'MEX', awayTeamShort: 'SUD', homeScore: null, awayScore: null }]`
- WHEN `loadStandings()` renders the header
- THEN the visible header text is `MEX — SUD`

#### Scenario: Body cell count matches header cell count

- GIVEN a header with N live columns
- WHEN each standings row is rendered
- THEN the row has exactly N live `<td>` cells, in the same order, each showing `homeScore — awayScore` (or `—` when the per-row prediction is `null`)

### Requirement: Live Column CSS

The `.standings-live-*` CSS block MUST style live header and body cells
as compact (narrower than default), monospace, with a visible accent
indicating live status. Scoped standings table sizing MUST keep header
and body columns visually aligned and readable with 0, 1, or 2 live
columns. The block MUST be scoped to standings only (no reuse of
`.score-display` or `.match-card`).

#### Scenario: Live cells use compact monospace styling

- GIVEN a rendered standings table with live columns
- WHEN the browser applies styles
- THEN each live header and body cell carries a `standings-live-*` class and renders in monospace, narrower than the points/options columns

#### Scenario: Two live columns remain aligned with body cells

- GIVEN a rendered standings table with 2 live matches
- WHEN the browser applies styles
- THEN the live headers, live prediction cells, points column, and options column remain visually aligned and readable in the same table grid

## Constraints

- Backward incompatibility: `liveMatch` is removed; `livePrediction` per row is replaced by `livePredictions` keyed by `matchId`. The single consumer is `loadStandings()`.
- `lib/team-name-map.js` precedence: the new `lib/team-abbrev.js` MUST NOT mutate or write back to `data/fixtures.json`; team names stay canonical in Spanish.
- Placeholder names (group letters and bracket paths) MUST always pass through unchanged — the abbreviation algorithm MUST NOT mis-render them.
- No test script is required; verification is `node --check server.js` plus manual browser verification at `http://localhost:3001` covering 0/1/2/3+ live match states.
- `docs/PRD.md` "Accumulated Table" section MUST be updated with a one-line mention that the live column shows up to 2 concurrent matches.
