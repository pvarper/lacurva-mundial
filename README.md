# La Curva Mundial

La Curva Mundial is a World Cup prediction web app built with HTML5, CSS, JavaScript, Bootstrap Icons, Node.js, Express, and JSON files for persistence.

## Package Manager

This project uses `pnpm` only.

Do not use `npm install`, `npm run`, or npm lockfiles in this project. Use `pnpm install`, `pnpm start`, and `pnpm` scripts instead.

## Features

- Login with username and password.
- Admin-only user creation, editing, and deactivation.
- Protected navigation for authenticated users.
- Full World Cup fixture view.
- Fixture filters by Bolivia date, team, and phase.
- User match predictions.
- Prediction lock 10 minutes before each match.
- Accumulated points table with match-by-match user detail.
- Rules menu explaining scoring behavior.
- Admin-only audit log for system actions, with filters by date, user, and action.
- Manual logout.
- Automatic logout after 5 minutes of inactivity.
- JSON-backed persistence.

## Fixture Data

`data/fixtures.json` contains the 104 World Cup 2026 matches with:

- Bolivia date and time.
- City and stadium.
- Phase label.
- Group-stage teams.
- Knockout references such as `1A`, `W73`, and `L101` where teams depend on results.

Available phase filters:

- `Fase de Grupos`
- `16vos`
- `8vos`
- `4vos`
- `Semifinal`
- `Final`

## Scoring Rules

| Prediction Result | Points |
|-------------------|--------|
| Exact score | 5 |
| Correct winner or draw | 3 |
| Incorrect prediction | 0 |

Matches without final scores do not add points.

## Security Model

- Passwords are stored as hashes.
- Sessions are managed by the backend.
- Session cookies are `httpOnly`.
- JSON data files are not served from the public directory.
- Admin-only actions are protected by backend middleware.
- UI visibility is not treated as security; API routes also validate access.

## Project Structure

```text
data/
  fixtures.json
  predictions.json
  audit-log.json
  users.json
docs/
  PRD.md
public/
  css/styles.css
  js/app.js
  index.html
server.js
package.json
```

## Setup

```bash
pnpm install
pnpm start
```

Then open:

```text
http://localhost:3001
```

## Initial Admin

The initial admin account is created in `data/users.json`:

```text
username: admin
password: admin123
```

For real usage, change the initial password after first setup.

## Documentation

See `docs/PRD.md` for product requirements, acceptance criteria, and implementation constraints.
