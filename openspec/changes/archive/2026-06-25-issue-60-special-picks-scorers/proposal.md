# Proposal: 60-special-picks-scorers

## Intent

Add a pre-tournament prediction mechanic (champion, runner-up, top
scorer) plus a tournament-scorers view. Bonus points enrich accumulated
standings without replacing match scoring; the scorers view lets users
validate the top-scorer pick (auto-source when available, admin-
maintained otherwise).

## Scope

### In Scope
- New `data/picks.json` (one row per user: `champion`, `runnerUp`,
  `topScorer`, audit fields); new `data/scorers.json` (manual rows:
  `playerName`, `team`, `goals`, `matchesPlayed`, `source`).
- Endpoints: `GET/POST/PUT /api/picks`, `GET /api/admin/picks`,
  `PUT /api/admin/picks/:userId`, `GET /api/scorers`,
  `POST/PUT/DELETE /api/admin/scorers[/:id]`.
- Lock: all three picks editable until 1 minute before the round-of-16
  first kickoff (computed from `data/fixtures.json`); normal users
  locked afterwards; admin overrides always allowed.
- Standings: `GET /api/standings` adds per-row `bonusPoints` +
  `totalPoints`; bonus is 0 until the final is `status: 'final'`, then
  10 / 6 / 4 to every matching user (no tie analysis, no splitting).
- Frontend: `picksView` (3 cards + Save), `scorersView` (table + source
  banner), `adminPicksView` (table + override modal); nav buttons for
  all authenticated users, admin link in admin section.
- Eye-icon popup on the picks view: table `user | champion | runner-up
  | top scorer` (admin sees `updatedBy`).
- Admin scorers CRUD overrides any computed row; audit entries
  `pick_override`, `scorer_manual_*`; `docs/PRD.md` updated.

### Out of Scope
- Automatic scorer source integration (admin manual v1; contract
  leaves room for it).
- Top-scorer name validation against an external roster.
- Tie analysis or point splitting for bonus picks.
- Live polling, pre-lock warnings, push notifications.
- Data migration (greenfield — files start empty).

## Capabilities

### New Capabilities
- `special-picks`: pre-tournament picks with shared R16 lock, admin
  override, eye-icon visibility, 10/6/4 bonus applied to standings
  once the final is `final`.
- `tournament-scorers`: scorers view with computed-vs-manual source
  banner and admin CRUD that overrides any source.

### Modified Capabilities
- None.

## Approach

Reuse existing patterns: Express + JSON persistence, `requireAuth` /
`requireAdmin` middleware, audit-log hook on every admin mutation.
Lock state computed at request time from `data/fixtures.json`
timestamps (no separate lock flag). Bonus computed read-time inside
the standings handler when the final is `status: 'final'`; raw match
points stay authoritative before then. Frontend extends `state.x` and
`showView()` for the three new views.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `data/picks.json` | New | Per-user pick row + audit fields. |
| `data/scorers.json` | New | Manual scorer records. |
| `server.js` | Modified | 8 endpoints, lock helper, standings bonus fields, audit hooks. |
| `public/index.html` | Modified | 3 view containers + nav buttons. |
| `public/js/app.js` | Modified | `state.picks/scorers/adminPicks`, 3 render fns, eye-icon popup, submission handlers. |
| `public/css/styles.css` | Modified | Cards, lock banner, scorer table, popup table. |
| `docs/PRD.md` | Modified | Picks, lock, bonus, scorers sections. |

## Risks

| Risk | Mitigation |
|------|------------|
| Lock shifts when fixtures change | Recomputed at request time; response includes current lock fields. |
| Top-scorer typos / duplicates | `<datalist>` autofill from current scorer list; case-insensitive equality for matching. |
| Admin override auditability | Audit entries include previous and new value plus `updatedBy`. |
| Bonus leaking before final | Standings handler returns 0 bonus unless final `status === 'final'`. |
| Manual vs computed scorer conflict | Manual rows win; banner reflects `source` of rows actually returned. |

## Rollback Plan

Revert the change's commits. Drop `data/picks.json` and
`data/scorers.json` (greenfield, no data loss). Remove the 3 nav
buttons and view containers. `GET /api/standings` returns to
match-points-only. No migration needed in either direction.

## Dependencies

- `data/fixtures.json` for lock timestamps and the final's `status`.
- Existing `requireAuth` / `requireAdmin` middleware in `server.js`.
- Existing audit-log writer and `data/audit-log.json` schema.

## Success Criteria

- [ ] All three picks lock 1 minute before the round-of-16 first kickoff for normal users.
- [ ] Admin overrides any pick after lock via `adminPicksView`; each override is audit-logged.
- [ ] Eye-icon popup on the picks view shows `user | champion | runner-up | top scorer` for all authenticated users.
- [ ] Standings apply 10 / 6 / 4 only after the final is `status: 'final'`; no tie analysis or splitting.
- [ ] Scorers view shows source banner; admins CRUD manual rows that override any computed row.
- [ ] `node --check server.js` passes; manual browser verification at `http://localhost:3001` covers: submit picks, eye-icon popup, admin override, scorers CRUD, bonus in standings only after the final.
- [ ] `docs/PRD.md` documents the new lock rule, bonus scheme, and scorers behavior.
