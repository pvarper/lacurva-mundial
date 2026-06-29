# La Curva Mundial - PRD

La Curva Mundial is a World Cup prediction web app where authenticated users can review fixtures, submit match predictions, read scoring rules, and compare accumulated points in a ranking table.

## Quick Path

1. Use `pnpm` for all dependency and script commands.
2. Run the application through the Node.js backend, not by opening HTML files directly.
3. Authenticate before accessing fixtures, predictions, rules, or accumulated points.

## Dependency Rule

This project MUST use `pnpm`.

Do not use `npm install`, `npm run`, or npm-generated lockfiles. The expected package manager is `pnpm`, and the lockfile must be `pnpm-lock.yaml`.

## Product Goals

| Goal | Decision |
|------|----------|
| Authentication | Users log in with username and password. |
| Admin role | One admin user can create additional users. |
| Fixtures | Users can view the complete World Cup fixture list. |
| Live match status | Fixtures can show each match status and score. |
| Predictions | Users can submit predictions per match. |
| Prediction lock | Predictions close 10 minutes before each match starts. |
| Ranking | Users can view accumulated points. |
| Rules | Users can read scoring and prediction rules. |
| Persistence | Data is stored in JSON files. |

## Menu Structure

| Menu | Access | Purpose |
|------|--------|---------|
| Create User | Admin only | Create new users. |
| World Cup Fixture | Authenticated users | View all matches, scores, and status. |
| Predictions | Authenticated users | Submit and review personal predictions. |
| Special Picks | Authenticated users | Choose champion, runner-up, and top scorer before the round-of-16 lock. Includes an inline community table of every user's pick visible to all authenticated users. |
| Accumulated Table | Authenticated users | View points by user. |
| Scorers | Authenticated users | Review the admin-maintained top scorers table. |
| Rules | Authenticated users | Explain scoring and prediction lock rules. |
| Audit Log | Admin only | Review user actions across the system. |

## Functional Requirements

### Login

- Users must log in before using the app.
- Passwords must not be stored as plain text.
- Sessions must be handled by the backend.
- Navigation must be protected server-side, not only hidden in the browser.
- The app must include a manual logout button.
- The app must close the session after 5 minutes of inactivity.

### Create User

- Only admin users can see the menu.
- Only admin users can call the user creation endpoint.
- New users must be stored in `data/users.json`.
- New user passwords must be hashed before saving.
- Admin users can view a table of created users.
- Admin users can edit username, role, and optionally password.
- Admin users can deactivate users so they can no longer log in.
- Admin users cannot deactivate their own active admin account.
- The three standings views (`standingsView`, `standingsDetailView`, `standingsDetailKnockoutView`) MUST include deactivated users who have submitted at least one prediction, alongside active users. Deactivated users with zero predictions MUST NOT appear. The individual standing detail endpoint (`GET /api/standings/:userId`) MUST also be accessible for deactivated users with predictions, so the per-user modal can still render.

### Fixture

- Users can view all 104 World Cup 2026 matches.
- Each match includes Bolivia date/time, teams or knockout references, score, status, phase, city, and stadium.
- Users can filter by Bolivia date, team, and phase.
- Group-stage matches use real team names from the published draw.
- Knockout matches use references such as `1A`, `W73`, or `L101` until results define the teams.

### Predictions

- Each authenticated user can create or update predictions for matches.
- A prediction contains local team goals and away team goals.
- Users can filter prediction fixtures by Bolivia date, team, and phase.
- A match becomes locked 10 minutes before kickoff.
- Locked matches cannot receive new predictions or updates.

### Special Picks

- Each authenticated user can save exactly one champion, one runner-up, and one top-scorer pick.
- Special picks stay editable until 1 minute before the first round-of-16 kickoff.
- Once the special-picks lock is active, no user can create or edit special picks.
- Below the personal pick form, the Special Picks view shows an inline community table (`Usuario`, `Campeón`, `Subcampeón`, `Goleador`) listing every active user, with `—` for users who have not submitted a pick yet. The table is visible to all authenticated users; it is not admin-only and does not include any edit or override column.
- Correct special picks add bonus points only after the final fixture is marked as `final`.
- The bonus values are fixed at champion `+10`, runner-up `+6`, and top scorer `+4`.
- No tie analysis or point splitting applies: every matching user receives the full documented bonus.

### Scorers

- Authenticated users can view the tournament scorers table.
- V1 scorer data is fully manual and stored in `data/scorers.json`.
- The scorers view must display an `Admin-maintained` source banner.
- Admin users can create, update, and delete scorer rows at any time.
- Admin scorer edits remain allowed even if a future automatic source is added.

### Accumulated Table

- The table shows each user and accumulated points.
- The admin user must not appear in the accumulated table.
- The role column is not shown in the accumulated table.
- The accumulated table can show up to 2 concurrent live matches as compact 3-letter header columns with the live score between both team codes.
- Each row includes an option to view match-by-match prediction detail.
- Normal users can only view their own match-by-match detail.
- Admin users can view user details for administration.
- The detail shows what the user predicted, the real score when available, and points earned for each match.
- Exact score prediction gives 5 points.
- Correct winner or draw gives 3 points.
- No match gives 0 points.
- Matches without final scores do not contribute points.
- From the round of 16 onward, an additional 3-point bonus is awarded for correctly picking the team that advances (8 pts exact + advancer, 6 pts winner + advancer).
- Each row also shows `bonusPoints` and `totalPoints`, where `totalPoints = match points + bonus points`.
- Ranking order stays based on match points and the phase-scoped tiebreakers, not on bonus points.

#### Tiebreakers by phase

Tiebreakers are split into two phase-scoped sets, and only the set matching the current tournament phase is applied — never all six at once. The active phase is derived from the fixtures: if any round-of-16 (or later) fixture is `final`, the knockout set is active; otherwise the group-stage set is active.

**Group-stage set (active while the tournament is still in group play):**

- Rule 1 — more exact-score hits (5 pts) across group-stage matches.
- Rule 2 — lower accumulated goal difference on group-stage matches where the user got the winner/draw right but missed the exact score (3 pts).
- Rule 3 — lower accumulated goal difference on group-stage matches where the user scored zero points.

**Knockout set (active from the round of 16 onward, replacing the group-stage set):**

- Rule 4 — more `exact + advancer` hits (8 pts: 5 base + 3 bonus) across knockout matches.
- Rule 5 — lower accumulated goal difference on knockout matches where the user got the winner and the advancer right but missed the exact score (6 pts).

Each rule is independently toggleable by the admin in `data/settings.json` under `standingsTiebreak`. The persisted keys are: `exactCountEnabled`, `goalDiffOnThreeEnabled`, `goalDiffOnZeroEnabled`, `exactPlusAdvancerCountEnabled`, `goalDiffOnSixEnabled`. If a tie persists after the active set is exhausted, the prize is split equally among the tied users.

#### Phase-scoped standings detail views

`GET /api/standings` and `GET /api/standings/:userId` accept an optional `?phase=` query parameter with values `groups` or `knockout` (default `all`, which preserves legacy behaviour).

- `?phase=knockout` filters every `userPredictions` iteration, every `liveMatches` slice, and the `details` array to knockout-phase fixtures only (`16vos`, `8vos`, `4vos`, `Semifinal`, `Final`). The `matchPoints`, `points`, `bonusPoints`, and all four knockout counters (`exactPlusAdvancerCount`, `sixCount`, `goalDiffOnSix`) are computed on that filtered set.
- `?phase=groups` mirrors the same filter for the group-stage set, exposing `exactCount`, `threeCount`, `zeroCount`, `goalDiffOnThree`, and `goalDiffOnZero` (recomputed over group fixtures only).
- The active scope is echoed back as `phaseScope` in the response so the client can confirm what the server filtered on.

The frontend ships two parallel detail views so users can audit each phase set in isolation:

- **Tabla Acumulada Detalle** (`standingsDetailView`, the legacy view) — sums points from the group stage only and shows the R1/R2/R3 columns: exact hits (5 pts), winner/draw hits (3 pts), zero-point misses, and the two group-stage goal-difference columns.
- **Tabla Acumulada Detalle — 16vos en adelante** (`standingsDetailKnockoutView`, new) — sums points from `16vos` onward and shows the R4/R5 columns: `exact + advancer` (8 pts) count, `winner + advancer` (6 pts) count, and the single `goal difference on +6 pts` column. The `dif. goles sin acierto` and `cantidad fallos` columns are intentionally absent because there is no equivalent zero-point tiebreaker in the knockout set.

#### Admin phase-scope selector on the main standings view

The main `standingsView` exposes a phase-scope selector to admin users only (rendered through the `admin-only hidden` class, toggled by the existing `state.user.role === 'admin'` guard at app boot). Non-admin users see the same table but never see the selector and the value is always treated as `all`.

The selector is placed **below the prize pool panel** (not at the top of the view) and consists of a `<select id="standingsPhaseScope">` plus a `Guardar` button (`#standingsPhaseScopeSave`). The selector's `change` event does NOT auto-reload the table — the admin must click `Guardar` to commit the choice, which:

1. Persists the choice in `localStorage` under the key `standings.phaseScope` (one of `all`, `groups`, `knockout`).
2. Updates a small `Mostrando: <label>` indicator next to the button so the admin sees the active scope at a glance.
3. Re-fetches `GET /api/standings?phase=...` and re-renders the table.

The three options and their effect on the table:

- **Todo el mundial** (`value="all"`) — sums every fixture in `data/fixtures.json`. Default. Equivalent to the legacy behaviour before the phase scope existed.
- **Fase de Grupos** (`value="groups"`) — sums only `Fase de Grupos` fixtures, ignoring any 16vos/8vos/4tos/semifinal/final match. Renders the table with only the group-stage columns active.
- **16avos en adelante** (`value="knockout"`) — sums only `16vos`/`8vos`/`4tos`/`Semifinal`/`Final` fixtures, ignoring any group match. Renders the table with only the knockout columns active.

The persistence is **server-side** in `data/settings.json` under the `standingsPhaseScope` key. The choice is set by the admin via `PUT /api/admin/settings` (body `{ standingsPhaseScope: "all" | "groups" | "knockout" }`), validated and persisted like every other admin runtime setting. The change applies to **every authenticated user** on the next standings fetch — non-admin users do not see the selector but their `GET /api/standings` response is automatically filtered by the admin's choice. An optional `?phase=` query parameter on the endpoint still works as a per-request override for testing.

### Rules

- The Rules menu is visible to all authenticated users.
- It explains scoring rules and prediction lock behavior.
- The displayed rules should match the backend scoring logic.

### Audit Log

- Only admin users can see the Audit Log menu.
- Only admin users can call the audit-log endpoint.
- The audit log is stored in `data/audit-log.json`.
- The audit log records login success/failure, logout, menu navigation, user creation/edit/deactivation, prediction creation/edit, and accumulated-table detail views.
- Each log entry includes timestamp, user, role, action, detail, and IP address.
- Admin users can filter the audit log by date, username, and action.

## Security Requirements

| Area | Requirement |
|------|-------------|
| Passwords | Store hashed passwords only. |
| Sessions | Use server-side sessions with `httpOnly` cookies. |
| JSON files | Keep JSON data outside the public static directory. |
| Admin actions | Validate admin role in backend middleware. |
| Navigation | Hide unauthorized UI and reject unauthorized API calls. |
| Inactivity | Logout after 5 minutes of inactivity. |

## Data Files

| File | Purpose |
|------|---------|
| `data/users.json` | Users, roles, and password hashes. |
| `data/fixtures.json` | Match schedule, teams, status, and scores. |
| `data/predictions.json` | User predictions by match. |
| `data/audit-log.json` | Admin-visible audit trail of system actions. |

## Fixture Source

The fixture data is normalized from the FIFA World Cup 26 match schedule and a tabular feed that mirrors the published schedule.

All stored kickoff times use UTC in `date`, plus explicit Bolivia fields:

- `boliviaDate`
- `boliviaTime`

The available phase labels are:

- `Fase de Grupos`
- `16vos`
- `8vos`
- `4vos`
- `Semifinal`
- `Final`

## Initial Admin

The project includes one initial admin user so the app can be used immediately after setup.

The initial password must be changed for real use.

## Acceptance Checklist

- [ ] The app installs dependencies with `pnpm install`.
- [ ] The app starts with `pnpm start`.
- [ ] Admin can log in and create users.
- [ ] Normal users cannot see or access Create User.
- [ ] Users can view fixtures and filter by date/team.
- [ ] Users can submit predictions before the lock time.
- [ ] Users cannot submit predictions 10 minutes before kickoff.
- [ ] Users can view accumulated points.
- [ ] Users can read scoring rules.
- [ ] Manual logout works.
- [ ] Inactivity logout works after 5 minutes.
