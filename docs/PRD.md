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
| Accumulated Table | Authenticated users | View points by user. |
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
