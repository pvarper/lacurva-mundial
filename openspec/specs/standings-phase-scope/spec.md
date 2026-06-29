# Standings Phase Scope Specification

## Purpose

The standings endpoints MUST support filtering by tournament phase (`groups` or `knockout`) so the frontend can render two parallel detail views — one for the group stage and one for the round of 16 onward — without doubling the implementation surface. Each phase's view reflects only the points and tiebreaker counters that apply to that phase, and only one phase set is active at a time (never both).

## Requirements

### Requirement: Phase query parameter

`GET /api/standings` and `GET /api/standings/:userId` MUST accept an optional `?phase=` query parameter.

#### Scenario: phase=knockout filters fixtures and counters

- GIVEN a request `GET /api/standings?phase=knockout`
- WHEN an authenticated user calls the endpoint
- THEN the response `standings[]` MUST contain, for every user, points and counters computed only over fixtures whose `phase` is in `KNOCKOUT_PHASES` (`16vos`, `8vos`, `4vos`, `Semifinal`, `Final`); group-stage fixtures MUST be ignored for `points`, `bonusPoints`, `totalPoints`, `exactPlusAdvancerCount`, `sixCount`, and `goalDiffOnSix`; the response MUST include `phaseScope: "knockout"`

#### Scenario: phase=groups filters fixtures and counters

- GIVEN a request `GET /api/standings?phase=groups`
- WHEN an authenticated user calls the endpoint
- THEN the response `standings[]` MUST contain, for every user, points and counters computed only over `Fase de Grupos` fixtures; knockout fixtures MUST be ignored for `points`, `bonusPoints`, `totalPoints`, `exactCount`, `threeCount`, `zeroCount`, `goalDiffOnThree`, and `goalDiffOnZero`; the response MUST include `phaseScope: "groups"`

#### Scenario: phase omitted defaults to all-phase

- GIVEN a request `GET /api/standings` with no `?phase=` parameter
- WHEN the endpoint is called
- THEN behaviour matches the legacy `all` scope: every fixture contributes, every counter is populated, and the response MUST include `phaseScope: "all"`

#### Scenario: invalid phase value is rejected

- GIVEN a request `GET /api/standings?phase=foo` (or any value not in `{groups, knockout}`)
- WHEN the endpoint is called
- THEN the server MUST treat it as `all` and the response MUST include `phaseScope: "all"`; the server MUST NOT return 400 for an unknown phase value, because the parameter is optional and lenient

### Requirement: Standings detail per phase

`GET /api/standings/:userId?phase=knockout` MUST filter the `details` array to knockout fixtures only, and recompute `matchPoints` and `totalPoints` over that filtered array.

#### Scenario: detail view shows only knockout fixtures

- GIVEN a request `GET /api/standings/u-123?phase=knockout`
- WHEN the endpoint is called
- THEN `details[]` MUST contain one row per knockout fixture only; `matchPoints` MUST equal the sum of `points` over the filtered `details`; the response MUST include `phaseScope: "knockout"`

#### Scenario: detail view shows only group fixtures

- GIVEN a request `GET /api/standings/u-123?phase=groups`
- WHEN the endpoint is called
- THEN `details[]` MUST contain one row per group fixture only; `matchPoints` MUST equal the sum of `points` over the filtered `details`; the response MUST include `phaseScope: "groups"`

### Requirement: Active phase determines column set

The frontend MUST render two distinct detail tables, each aligned to one phase's counters and tiebreaker columns.

#### Scenario: groups view shows R1/R2/R3 columns

- GIVEN the user navigates to `standingsDetailView`
- WHEN the table renders
- THEN it MUST show, per row: position, username, match points, bonus, total, exact hits (5 pts), winner/draw hits (3 pts), zero-point misses, goal diff on 3-pt hits, goal diff on 0-pt misses. It MUST NOT show the `+6 pts` or `+8 pts` columns

#### Scenario: knockout view shows all knockout score buckets

- GIVEN the user navigates to `standingsDetailKnockoutView`
- WHEN the table renders
- THEN it MUST show, per row: position, username, match points, bonus, total, exact + advancer hits (8 pts), winner + advancer hits (6 pts), exact hits worth 5 pts, non-exact hits worth 3 pts, zero-point misses, and goal diff on 6-pt hits. It MUST NOT show the `0-pt goal diff` column because knockout ranking does not use a zero-point goal-difference tiebreaker

#### Scenario: bonus column is identical across views

- GIVEN either view (`standingsDetailView` or `standingsDetailKnockoutView`)
- WHEN the table renders
- THEN the `bonus` column MUST reflect the same `pickBonus` value (champion, runner-up, top scorer) — the bonus is tournament-wide and not phase-scoped

### Requirement: Admin phase-scope selector on the main standings view

The main `standingsView` MUST expose a phase-scope selector to admin users. The selector MUST be hidden for non-admin users and the table MUST always render with `phaseScope: "all"` for them. The selector MUST be placed below the prize pool panel, not at the top of the view.

#### Scenario: admin sees the selector, save button, and active-scope label

- GIVEN an admin user opens `standingsView`
- WHEN the view renders
- THEN a `<select id="standingsPhaseScope">` with three options (`all`, `groups`, `knockout`), a `Guardar` button (`#standingsPhaseScopeSave`), and a `Mostrando: <label>` indicator (`#standingsPhaseScopeActive`) MUST be visible below the prize pool panel; the active-scope label MUST reflect the current persisted scope

#### Scenario: non-admin does not see the selector block

- GIVEN a non-admin user opens `standingsView`
- WHEN the view renders
- THEN the entire `admin-only hidden` block containing the selector, button, and label MUST be hidden; the table MUST always fetch from `GET /api/standings` (no `?phase=`), behaving as `phaseScope: "all"` for that user

#### Scenario: clicking Guardar persists the choice server-side and re-fetches

- GIVEN an admin selects `groups` from the selector
- WHEN they click the `Guardar` button
- THEN the client MUST call `PUT /api/admin/settings` with body `{ standingsPhaseScope: "groups" }`, the server MUST persist the change in `data/settings.json`, the active-scope label MUST update to `Mostrando: Fase de Grupos`, and the table MUST re-fetch from `GET /api/standings` (no query needed) and re-render

#### Scenario: choice persists across reloads and applies to all users

- GIVEN an admin previously saved `knockout` to `data/settings.json`
- WHEN any authenticated user (admin or non-admin) loads the standings view
- THEN the table MUST fetch from `GET /api/standings` and the server MUST apply the saved `knockout` scope, regardless of which user is logged in

#### Scenario: invalid scope value is rejected

- GIVEN a request body `{ standingsPhaseScope: "bogus" }`
- WHEN `PUT /api/admin/settings` is called
- THEN the response MUST be `400` with `{ error: "standingsPhaseScope must be \"all\", \"groups\", or \"knockout\"." }` and no write to `data/settings.json` occurs

#### Scenario: missing scope defaults to all

- GIVEN `data/settings.json` does not contain a `standingsPhaseScope` key (e.g. fresh install or pre-feature file)
- WHEN `GET /api/standings` is called
- THEN the server MUST fall back to `all` and the response MUST include `phaseScope: "all"`

#### Scenario: live header columns respect the selected scope

- GIVEN an admin's saved scope is `knockout`
- WHEN the table re-renders
- THEN the `liveMatches` array in the response MUST contain only `live` knockout fixtures; the live header columns MUST NOT show group-stage matches under a knockout scope

#### Scenario: switching back to all restores the full view

- GIVEN an admin saved `groups` and then saves `all`
- WHEN the table re-renders
- THEN the response MUST include `phaseScope: "all"`, all group and knockout fixtures contribute, and the live header columns show both group and knockout live matches as before

### Requirement: Include deactivated users with predictions in the standings

The three standings endpoints (`GET /api/standings`, `GET /api/standings/:userId`, plus the phase-scoped variants) MUST include deactivated users that have submitted at least one prediction, alongside active users. Admin users MUST always be excluded. Deactivated users with zero predictions MUST NOT appear.

#### Scenario: deactivated user with predictions appears in the list

- GIVEN `users.json` contains a user with `active: false` and `role: 'user'` whose `id` matches at least one entry in `predictions.json`
- WHEN `GET /api/standings?phase=knockout` is called
- THEN the response `standings[]` MUST contain a row for that user with their computed points and counters, the `active: false` flag preserved in the sanitised `username` field, and the same sort/tiebreak logic as active users

#### Scenario: deactivated user with only group-stage predictions is excluded from the knockout view

- GIVEN `users.json` contains a user with `active: false` whose predictions in `predictions.json` all reference group-stage fixtures (no `matchId` whose fixture has `phase` in `KNOCKOUT_PHASES`)
- WHEN `GET /api/standings?phase=knockout` is called
- THEN the response `standings[]` MUST NOT contain a row for that user, because they have no predictions in the requested phase; the same user MUST still appear in `?phase=groups` and `?phase=all` if they have any group-stage prediction

#### Scenario: deactivated user with no predictions does not appear

- GIVEN `users.json` contains a user with `active: false`, `role: 'user'`, and no matching entries in `predictions.json`
- WHEN `GET /api/standings` is called
- THEN the response `standings[]` MUST NOT contain a row for that user

#### Scenario: deactivated user detail is accessible

- GIVEN a deactivated user has predictions
- WHEN `GET /api/standings/:userId` is called for that user
- THEN the response MUST be `200` with the same shape as for an active user, including `matchPoints`, `bonusPoints`, `totalPoints`, and the per-match `details[]`

#### Scenario: admin user never appears

- GIVEN `users.json` contains a user with `role: 'admin'` regardless of `active` or predictions
- WHEN `GET /api/standings` or `GET /api/standings/:userId` is called
- THEN the response MUST NOT contain a row for the admin user

### Requirement: Server-side enforcement of the detail-table visibility settings

The `visibilityGroupDetail` and `visibilityKnockoutDetail` settings MUST be enforced on the server, not only in the frontend. The bulk standings endpoint and the navigation audit endpoint MUST refuse detail-table requests from non-admin users when the corresponding setting is `false`. Admins MUST always be allowed. The main standings view and the per-user drill-down modal MUST remain available to every authenticated user, regardless of the visibility settings.

#### Scenario: non-admin blocked from the group detail data when visibility is off

- GIVEN `settings.json` has `visibilityGroupDetail: false`
- WHEN a non-admin user calls `GET /api/standings?phase=groups`
- THEN the response MUST be `403` with `{ error: "This standings table is not available for your account." }` and no standings rows MUST be returned

#### Scenario: non-admin blocked from the knockout detail data when visibility is off

- GIVEN `settings.json` has `visibilityKnockoutDetail: false`
- WHEN a non-admin user calls `GET /api/standings?phase=knockout`
- THEN the response MUST be `403` with `{ error: "This standings table is not available for your account." }` and no standings rows MUST be returned

#### Scenario: non-admin can still load the group detail data when visibility is on

- GIVEN `settings.json` has `visibilityGroupDetail: true`
- WHEN a non-admin user calls `GET /api/standings?phase=groups`
- THEN the response MUST be `200` with `standings[]` containing the per-user counters and `phaseScope: "groups"`

#### Scenario: admin always sees both detail tables

- GIVEN `settings.json` has either visibility setting as `false`
- WHEN an admin user calls `GET /api/standings?phase=groups` and `GET /api/standings?phase=knockout`
- THEN BOTH responses MUST be `200` with `standings[]` populated and the corresponding `phaseScope`, regardless of the persisted visibility values

#### Scenario: main standings view is never blocked by the visibility settings

- GIVEN `settings.json` has `visibilityGroupDetail: false` and `visibilityKnockoutDetail: false`
- WHEN any authenticated user calls `GET /api/standings` with no `?phase=` parameter (or with `?phase=all`)
- THEN the response MUST be `200` and the main standings table MUST continue to render; the visibility settings MUST NOT affect the main view

#### Scenario: per-user drill-down modal is never blocked by the visibility settings

- GIVEN `settings.json` has `visibilityGroupDetail: false` and `visibilityKnockoutDetail: false`
- WHEN any authenticated user calls `GET /api/standings/:userId?phase=groups` (or `?phase=knockout`) from the per-user modal on the main standings view
- THEN the response MUST be `200` with the per-user `details[]`; the per-user modal is part of the main standings view and MUST remain reachable for every authenticated user

#### Scenario: navigation audit is rejected for a hidden detail view

- GIVEN `settings.json` has `visibilityGroupDetail: false`
- WHEN a non-admin user posts `{ view: "standingsDetailView" }` to `POST /api/audit/navigation`
- THEN the response MUST be `403` with `{ error: "This standings table is not available for your account." }` and no `menu_viewed` audit entry MUST be recorded for that view

#### Scenario: navigation audit is accepted for a visible detail view

- GIVEN `settings.json` has `visibilityGroupDetail: true`
- WHEN a non-admin user posts `{ view: "standingsDetailView" }` to `POST /api/audit/navigation`
- THEN the response MUST be `200` and a `menu_viewed` audit entry with `view: "standingsDetailView"` MUST be recorded for that user
