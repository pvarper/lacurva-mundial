# AGENTS.md

Context for AI coding agents working on La Curva Mundial.

## Project Summary

La Curva Mundial is a World Cup prediction web app built with HTML, CSS, vanilla JavaScript, Node.js, Express, and JSON files for persistence.

## Quick Start

1. Install dependencies with `pnpm install`.
2. Start the app with `pnpm start`.
3. Open `http://localhost:3001`.

Use `pnpm` only. Do not use `npm install`, `npm run`, or npm lockfiles.

## Runtime Commands

| Task | Command |
|------|---------|
| Install dependencies | `pnpm install` |
| Start server | `pnpm start` |
| Start dev server | `pnpm dev` |
| Check backend syntax | `node --check server.js` |

## Architecture

| Path | Role |
|------|------|
| `server.js` | Express backend, sessions, auth, users, predictions, scoring, audit API. |
| `public/index.html` | Single-page app markup. |
| `public/js/app.js` | Frontend state, API calls, rendering, navigation, inactivity handling. |
| `public/css/styles.css` | App styling. |
| `data/fixtures.json` | World Cup 2026 fixture data. Versioned seed data. |
| `data/users.json` | User records and password hashes. Treat as sensitive runtime data. |
| `data/predictions.json` | User prediction state. Runtime data. |
| `data/audit-log.json` | Audit trail state. Runtime data. |
| `docs/PRD.md` | Product requirements and acceptance criteria. |

## Product Rules

- Users authenticate with username and password.
- Admin users can create, edit, and deactivate users.
- Authenticated users can view fixtures, submit predictions, view standings, and read rules.
- Predictions lock 10 minutes before kickoff.
- Scoring is 5 points for exact score, 3 points for correct winner or draw, and 0 otherwise.
- Matches without final scores do not add points.
- Inactivity logout happens after 5 minutes.

## Security Notes

- Passwords are stored as salted `scrypt` hashes in `salt:hash` format.
- Sessions are server-side via `express-session` with `httpOnly` cookies.
- JSON data files must stay outside `public/`.
- Do not rely on hidden UI for security; backend middleware must enforce permissions.
- Do not commit real users, real predictions, audit logs with IP addresses, `.env`, or local tool metadata.
- Set `SESSION_SECRET` in production instead of relying on the development fallback in `server.js`.

## Git Workflow

- Default branch is `main`.
- Remote is `https://github.com/pvarper/lacurva-mundial.git`.
- Keep changes small and scoped.
- Before committing, inspect `git status`, the relevant diff, and recent commits.
- Commit only intended files. `data/audit-log.json` may change while running the app; do not include it unless the task explicitly requires it.
- Use conventional commit messages, for example `chore: update admin password`.

## Verification

Run the smallest useful checks for the change:

- Backend changes: `node --check server.js`.
- Dependency changes: `pnpm install --frozen-lockfile`.
- Git hygiene: `git diff --check` or `git diff --cached --check` before committing.

## Current Gotchas

- `data/audit-log.json` is runtime state and can become dirty after local testing.
- `README.md` may mention the original seed admin password; verify it before relying on it.
- The app has no test script in `package.json` yet.
