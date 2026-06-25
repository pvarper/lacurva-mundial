# Spec: Tournament Scorers

## Purpose

The scorers view lists tournament top scorers to authenticated users. V1 data is wholly manually maintained by ADMIN in `data/scorers.json`; no automatic source exists in V1 and none is required. ADMIN can CRUD manual rows at all times. A future automatic source is permitted as an extension; if added later, ADMIN manual edits MUST take precedence for affected players and the source banner MUST reflect the rows actually returned.


## Requirements

### Requirement: Scorers listing

`GET /api/scorers` MUST return a JSON array of scorer rows read from `data/scorers.json`. Each row MUST contain `id`, `playerName`, `team`, `goals`, `matchesPlayed`, `source: "manual"`, and audit timestamps.

#### Scenario: Manual scorers returned

- GIVEN `data/scorers.json` has two manual rows
- WHEN an authenticated user calls `GET /api/scorers`
- THEN the response is those two rows, each with `source: "manual"`

#### Scenario: Empty data returns empty array

- GIVEN `data/scorers.json` is empty
- WHEN `GET /api/scorers` is called
- THEN the response is `[]`

### Requirement: Source banner

`scorersView` MUST render a top banner labelled "Admin-maintained" in V1. The label MAY come from a response-level field so a future automatic source can relabel it without changing the view contract.

#### Scenario: Admin-maintained banner is shown

- GIVEN the response is read from `data/scorers.json`
- WHEN the scorers view renders
- THEN a banner labelled "Admin-maintained" appears

### Requirement: Admin scorers CRUD

`POST`, `PUT`, `DELETE` under `/api/admin/scorers[/:id]` MUST be admin-only. POST creates a row with server-generated `id` and `source: "manual"`; PUT updates in place and refreshes `lastUpdated`; DELETE removes the row. Each mutation appends an audit-log entry (`scorer_manual_create` | `scorer_manual_update` | `scorer_manual_delete`). `goals` and `matchesPlayed` MUST be non-negative integers; invalid values return 400.

#### Scenario: Admin creates a manual scorer

- GIVEN an admin user and an empty `data/scorers.json`
- WHEN `POST /api/admin/scorers` is sent with `playerName`, `team`, `goals`, `matchesPlayed`
- THEN a new row is appended with a server-generated `id` and `source: "manual"`
- AND an audit-log entry `scorer_manual_create` is appended

#### Scenario: Admin updates a manual scorer

- GIVEN a manual row with `id: "s-1"`
- WHEN `PUT /api/admin/scorers/s-1` is called with new fields
- THEN the row is updated in place; `lastUpdated` is refreshed
- AND an audit-log entry `scorer_manual_update` is appended

#### Scenario: Admin deletes a manual scorer

- GIVEN a manual row with `id: "s-1"`
- WHEN `DELETE /api/admin/scorers/s-1` is called
- THEN the row is removed
- AND an audit-log entry `scorer_manual_delete` is appended

#### Scenario: Non-admin scorer write is rejected

- GIVEN a non-admin user
- WHEN `POST /api/admin/scorers` is called
- THEN the response is 403

#### Scenario: Invalid integer fields are rejected

- GIVEN an admin user submitting `goals: -1`
- WHEN `POST /api/admin/scorers` is called
- THEN the response is 400 with no row appended

### Requirement: Forward-compatible ADMIN override

If a future automatic scorer source is added, ADMIN manual rows MUST take precedence for affected players (case-insensitive `playerName`) in the merged response, and the source banner MUST reflect the source of the rows actually returned. This requirement does NOT require any automatic source in V1; it constrains future extensions only.

#### Scenario: Manual row wins over a future computed row

- GIVEN a future extension returns a computed row for `Mbappé` and a manual row also exists
- WHEN `GET /api/scorers` is called
- THEN the manual row is returned; the computed row is dropped

#### Scenario: Admin edits during a future computed source

- GIVEN a future extension supplies computed rows
- WHEN an admin calls `PUT /api/admin/scorers/:id` to correct a row
- THEN the manual row wins for that player in subsequent GET responses

## Constraints

- Scorer endpoints reuse existing `requireAuth` / `requireAdmin` middleware.
- `data/scorers.json` MUST live under `data/` and MUST NOT be served from `public/`.
- Scorer data is wholly manual; no rows are derived from `data/fixtures.json`.
- No automatic scorer source is required, scheduled, or assumed.
