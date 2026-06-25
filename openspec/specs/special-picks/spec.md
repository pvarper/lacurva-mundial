# Spec: Special Picks

## Purpose

Authenticated users submit three pre-tournament picks (champion, runner-up, top scorer) that share a single round-of-16 lock. The three fields are selection controls populated from authoritative lists: `champion` and `runnerUp` from the unique team names in `data/fixtures.json` fixtures with `phase === "16vos"`, and `topScorer` from the admin-maintained scorers in `data/scorers.json`. `champion` MUST NOT equal `runnerUp`. All authenticated users can view an inline community table of every active user's picks inside the `picksView`; there is no popup and no admin override endpoint. Correct picks earn 10 / 6 / 4 bonus points in standings once the final is `status: 'final'`.

## Requirements

### Requirement: Shared R16 lock for normal users

All three picks MUST be locked together for non-admin users at `firstR16Kickoff - 60s`, computed at request time from `data/fixtures.json`. After lock, normal users' `POST` and `PUT` to `/api/picks` MUST be rejected with HTTP 423. The current lock state MUST be returned in every picks response.

#### Scenario: Pre-lock submission succeeds

- GIVEN current time is more than 60 seconds before the first R16 kickoff
- WHEN a non-admin user calls `POST /api/picks`
- THEN the response is 200 and the row is persisted

#### Scenario: Post-lock submission is rejected

- GIVEN current time is at or after the lock instant
- WHEN a non-admin user calls `POST /api/picks` or `PUT /api/picks`
- THEN the response is 423 with `error: "picks_locked"`

#### Scenario: Admin can submit after lock

- GIVEN current time is at or after the lock instant
- WHEN an admin calls `POST /api/picks` for their own user
- THEN the request succeeds (admin bypass on the admin's own row only)

### Requirement: Standings bonus points

`GET /api/standings` MUST add per-row `bonusPoints` and `totalPoints` (where `totalPoints = matchPoints + bonusPoints`). While no final-stage fixture has `status: 'final'`, `bonusPoints` MUST be 0 for every row. After the final is `final`, the server MUST award 10 to every user whose `champion` matches the final winner, 6 to every user whose `runnerUp` matches the final runner-up, and 4 to every user whose `topScorer` matches the final top scorer (case-insensitive). No tie analysis or point splitting is performed.

| Pick field | Bonus | Match basis |
|------------|-------|-------------|
| `champion` | 10 | Final winner |
| `runnerUp` | 6 | Final runner-up |
| `topScorer` | 4 | Final top scorer |

#### Scenario: Bonus is zero before the final

- GIVEN no final-stage fixture is `status: 'final'`
- WHEN `GET /api/standings` is called
- THEN every row has `bonusPoints: 0` and `totalPoints` equals `matchPoints`

#### Scenario: Each pick awards the documented bonus to all matching users

- GIVEN the final is `status: 'final'` with winner `Argentina`, runner-up `France`, top scorer `Mbappé`
- WHEN `GET /api/standings` is called
- THEN every user with matching `champion` (case-insensitive) gets `+10`
- AND every user with matching `runnerUp` (case-insensitive) gets `+6`
- AND every user with matching `topScorer` (case-insensitive) gets `+4`
- AND the three awards are independent (a user can earn 10 + 6 + 4 if all three match)

#### Scenario: No tie analysis or point splitting

- GIVEN multiple users have the same `champion` matching the final winner
- WHEN `GET /api/standings` is called
- THEN each matching user receives the full 10 points (no division by count)

### Requirement: Pick submission

`POST /api/picks` and `PUT /api/picks` MUST persist the calling user's three picks (`champion`, `runnerUp`, `topScorer`) into `data/picks.json` with `userId`, `username`, timestamps, and `updatedBy: "user"`. The three values MUST each be a member of its allowed set: `champion` and `runnerUp` MUST be members of the 16vos teams set (unique, non-empty team names from fixtures with `phase === "16vos"`); `topScorer` MUST be a `playerName` from the admin-maintained scorers list. `champion` MUST NOT equal `runnerUp`. Submission with a value outside its allowed set, or with `champion === runnerUp`, MUST be rejected with HTTP 400 and a clear `error` message. Lock state still applies: non-admin users are rejected with HTTP 423 when locked; admin users can submit/update their own row post-lock. The success response of `GET /api/picks`, `POST /api/picks`, and `PUT /api/picks` MUST include `teams: string[]` (the sorted unique 16vos team list used for validation).

#### Scenario: User submits all three picks before lock

- GIVEN an authenticated non-admin user with no existing row
- WHEN `POST /api/picks` is sent with valid `champion`, `runnerUp`, `topScorer`
- THEN a row is appended with `updatedBy: "user"` and the response includes `teams`

#### Scenario: User updates picks before lock

- GIVEN an existing pick row for the user
- WHEN `PUT /api/picks` replaces the three values
- THEN the row is updated in place; `updatedAt` is refreshed; `updatedBy` remains `"user"`

#### Scenario: Submission with champion === runnerUp is rejected

- GIVEN a request with `champion` equal to `runnerUp`
- WHEN `POST /api/picks` or `PUT /api/picks` is called
- THEN the response is 400 and no row is created or updated

#### Scenario: Submission with value outside allowed set is rejected

- GIVEN a request with a `champion`, `runnerUp`, or `topScorer` not in the allowed set
- WHEN `POST /api/picks` or `PUT /api/picks` is called
- THEN the response is 400 and no row is created or updated

### Requirement: Community picks table visibility

The frontend `picksView` MUST render an inline (no popup, no modal) table listing every active user's `champion`, `runnerUp`, and `topScorer`, with columns `Usuario | Campeón | Subcampeón | Goleador`. The table MUST be visible to all authenticated users. The `Actualizado por` (`updatedBy`) column MUST NOT be rendered for any user, including admins; there is no edit/override affordance in the row. `GET /api/picks` MUST return one row for every active user (`users.filter(u => u.active !== false)`), merging with `data/picks.json` so users without submitted picks appear with empty `champion` / `runnerUp` / `topScorer` (rendered as `—`). The same response MUST include `teams: string[]` — the sorted unique list of team names from fixtures with `phase === "16vos"`. The `POST` and `PUT /api/picks` success responses MUST also include the same `teams` array.

#### Scenario: Inline community table renders for all authenticated users

- GIVEN any authenticated user (admin or non-admin) on the `picksView`
- WHEN the view loads
- THEN an inline table renders with columns `Usuario | Campeón | Subcampeón | Goleador` and no `Actualizado por` column

#### Scenario: GET /api/picks returns teams and a row per active user

- GIVEN a set of active and inactive users, and some users have submitted picks and others have not
- WHEN `GET /api/picks` is called
- THEN the response includes `teams` and `picks` has one row per active user (including those with no submitted pick, with empty pick fields)

#### Scenario: Admin sees no updatedBy column

- GIVEN an admin user on the `picksView`
- WHEN the community table renders
- THEN no `Actualizado por` / `updatedBy` column is shown and no edit/override control is rendered in any row

### Requirement: Restricted pick value sources

The picks form MUST present `champion`, `runnerUp`, and `topScorer` as selection controls (no free-text input). `champion` and `runnerUp` options MUST be the unique, sorted, non-empty team names from `data/fixtures.json` fixtures with `phase === "16vos"`. `topScorer` options MUST be the unique, sorted, non-empty `playerName` values from the admin-maintained scorers list (`data/scorers.json`). The `runnerUp` options MUST dynamically exclude the currently selected `champion`; when the `champion` value changes, the runner-up options are rebuilt to remove the new champion while preserving the current runner-up value when still valid. If an existing pick's value is not in the allowed set (legacy data), the form MUST still display it as an extra selected `<option>` so the user can see and change it; submission of such a value MUST be rejected by the backend with HTTP 400.

#### Scenario: Form renders selection controls from authoritative lists

- GIVEN the `picksView` loads with `teams` from the API and `scorers` from the scorers endpoint
- WHEN the form renders
- THEN `champion`, `runnerUp`, and `topScorer` are `<select>` controls whose `<option>` values come from the 16vos teams set and the scorers list (no free-text input)

#### Scenario: Runner-up excludes the selected champion

- GIVEN a champion value is selected
- WHEN the runner-up options are computed
- THEN the champion value is not present in the runner-up options; if the runner-up is changed, the runner-up is rebuilt to keep the current runner-up when it remains valid

#### Scenario: Legacy value is shown but rejected on submit

- GIVEN an existing pick with a value not in the allowed set
- WHEN the form renders
- THEN the legacy value is rendered as a selected `<option>` so the user can change it
- AND WHEN the user submits the form unchanged, the backend returns 400

## Constraints

- All picks endpoints reuse the existing `requireAuth` middleware.
- Lock state is computed at request time from `data/fixtures.json`; no separate lock flag is stored.
- `data/picks.json` MUST live under `data/` and MUST NOT be served from `public/`.
- `champion` and `runnerUp` MUST be members of the 16vos teams set; `topScorer` MUST be a `playerName` from the admin scorers list; `champion` MUST NOT equal `runnerUp`.
- `GET /api/picks`, `POST /api/picks`, and `PUT /api/picks` responses MUST include `teams: string[]` (sorted unique 16vos teams).
- There is no admin override endpoint for special picks; admins manage only their own row.
- Top-scorer match for bonus is case-insensitive.
