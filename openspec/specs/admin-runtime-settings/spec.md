# Admin Runtime Settings Specification

## Purpose

Admin users MUST be able to view and edit operationally relevant runtime settings (prediction lock window, login lockout policy, worldcup sync, fixture refresh interval) through an authenticated API and admin UI, with changes persisted to `data/settings.json`, applied live without a server restart, and recorded in the audit log.

## Requirements

### Requirement: Read Current Settings

The system MUST expose `GET /api/settings`, gated by `requireAdmin`, returning the current in-memory settings object.

#### Scenario: Admin reads current settings

- GIVEN an authenticated user with `role: 'admin'`
- WHEN they call `GET /api/settings`
- THEN the response is `200` with the full current settings object (all 8 in-scope fields)

#### Scenario: Non-admin authenticated user is rejected

- GIVEN an authenticated user with `role` other than `admin`
- WHEN they call `GET /api/settings`
- THEN the response is `403` with `{ error: 'Admin access required.' }`, matching the existing `requireAdmin` behavior used by `/api/audit-log`

#### Scenario: Unauthenticated request is rejected

- GIVEN no active session
- WHEN a request is made to `GET /api/settings`
- THEN the response is `403` (the existing `requireAdmin` middleware returns 403 for missing session, not 401 — confirmed at `server.js:166-171`; it does not distinguish unauthenticated from non-admin)

### Requirement: Update Settings

The system MUST expose `PUT /api/settings`, gated by `requireAdmin`, validating the request body, persisting valid changes to `data/settings.json`, updating the in-memory cache, applying side effects, and recording an audit-log entry.

#### Scenario: Admin updates a valid settings field

- GIVEN an authenticated admin and a request body `{ predictionLockMs: 120000 }`
- WHEN they call `PUT /api/settings`
- THEN the value passes validation, `data/settings.json` is written via the existing `writeJson` lock pattern, the in-memory cache reflects the new value, the response is `200` with the full updated settings object, and an audit-log entry `settings_updated` is recorded with old value, new value, admin's `userId`/`username`, and timestamp (mirroring `prize_pool_updated`)

#### Scenario: Admin submits an out-of-bounds value

- GIVEN a request body `{ lockoutAttempts: -1 }`
- WHEN `PUT /api/settings` is called
- THEN the response is `400` with a descriptive error, no write to `data/settings.json` occurs, and no audit-log entry is recorded

#### Scenario: Admin submits a non-numeric value for a numeric field

- GIVEN a request body `{ predictionLockMs: "abc" }`
- WHEN `PUT /api/settings` is called
- THEN the response is `400`, mirroring the `Number.isFinite` guard pattern used in `PUT /api/prize-pool`

#### Scenario: Request body contains unknown fields

- GIVEN a request body containing a field not in the settings schema (e.g. `{ foo: 'bar' }`)
- WHEN `PUT /api/settings` is called
- THEN the unknown field MUST be ignored (not persisted, not echoed back), and known valid fields in the same request are still applied — consistent with the existing `PUT /api/users/:id` pattern of picking known fields off `req.body` rather than spreading the whole body

#### Scenario: Partial update only changes submitted fields

- GIVEN a request body containing only `{ fixtureRefreshMs: 45000 }`
- WHEN `PUT /api/settings` is called
- THEN only `fixtureRefreshMs` changes; all other settings retain their previous values in both the cache and `data/settings.json`

#### Scenario: Non-admin or unauthenticated PUT is rejected

- GIVEN a non-admin or unauthenticated request
- WHEN `PUT /api/settings` is called
- THEN the response is `403`, no validation runs, no write occurs, no audit log is recorded

#### Scenario: Concurrent PUT requests do not corrupt the settings file

- GIVEN two `PUT /api/settings` requests arrive in close succession
- WHEN both are processed
- THEN the existing `writeLocks` Map per-file queuing in `writeJson('settings.json', ...)` serializes the two writes so `data/settings.json` always ends in a fully-applied, non-corrupted state matching the second write to complete

### Requirement: Field Validation Bounds

Each of the 8 in-scope settings MUST be validated as a positive integer within a defined bound before being persisted.

| Field | Bound | Basis |
|---|---|---|
| `predictionLockMs` | integer, `>= 0` | No existing implicit floor; 0 means "lock at kickoff," a valid admin choice |
| `lockoutAttempts` | integer, `>= 1` | Must allow at least one attempt before lockout |
| `lockoutDurationMs` | integer, `>= 1000` (1s floor) | Prevents a near-zero lockout that defeats its purpose |
| `maxTemporaryLockouts` | integer, `>= 1` | Must allow at least one temporary lockout before permanent block |
| `lockoutResetMs` | integer, `>= lockoutDurationMs` | A reset window shorter than the lockout itself is contradictory (ASSUMPTION — not enforced by existing code, design phase should confirm) |
| `worldcupSync.enabled` | boolean | N/A |
| `worldcupSync.pollIntervalMs` | integer, `>= 5000` (5s floor) | RESOLVED by design phase: 5000ms floor, implemented in `server.js` and matched by the client form's `min="5000"`. Supersedes the original 10000ms ASSUMPTION. |
| `fixtureRefreshMs` | integer, `>= 5000` (5s floor) | Implemented as designed; prevents excessive client polling |

#### Scenario: pollIntervalMs below the floor is rejected

- GIVEN a request body `{ worldcupSync: { pollIntervalMs: 1000 } }`
- WHEN `PUT /api/settings` is called
- THEN the response is `400` because `1000 < 5000`

### Requirement: Settings Persist Across Restart

The system MUST read `data/settings.json` at boot and use it as the in-memory cache. If the file does not exist, the system MUST fall back to the current hardcoded default values and MUST NOT crash.

#### Scenario: Boot with existing settings file

- GIVEN `data/settings.json` exists with valid prior admin-set values
- WHEN the server starts
- THEN the in-memory settings cache is populated from the file, not from hardcoded defaults

#### Scenario: First run, no settings file

- GIVEN `data/settings.json` does not exist
- WHEN the server starts
- THEN the in-memory cache is populated with the current hardcoded defaults (e.g. `predictionLockMs: 60000`), and the server starts successfully without writing the file until the first admin `PUT`

#### Scenario: Settings file is corrupted at boot

- GIVEN `data/settings.json` exists but contains unparseable JSON
- WHEN the server starts
- THEN the system MUST log the error and fall back to hardcoded defaults (mirroring `readAuditLogs()`'s existing catch-and-fallback pattern at `server.js:83-90`), and MUST NOT crash the boot sequence

### Requirement: Worldcup Sync Hot-Reload

Changing `worldcupSync.enabled` or `worldcupSync.pollIntervalMs` via `PUT /api/settings` MUST take effect immediately, without a server restart, by explicitly stopping and restarting the sync subsystem.

#### Scenario: Admin disables an active sync

- GIVEN `worldcupSync.enabled` is currently `true` and the sync interval is running
- WHEN an admin sets `worldcupSync.enabled: false` via `PUT /api/settings`
- THEN the settings update handler calls `stopWorldcupSync()`, the running interval is cleared, and no further sync cycles execute until re-enabled

#### Scenario: Admin changes the poll interval while sync is running

- GIVEN `worldcupSync.enabled` is `true` with `pollIntervalMs: 10000`
- WHEN an admin sets `worldcupSync.pollIntervalMs: 20000` via `PUT /api/settings`
- THEN the handler calls `stopWorldcupSync()` followed by `startWorldcupSync(deps)`, because `startWorldcupSync` no-ops if `intervalHandle` is already set (`lib/worldcup-sync.js:161`) — the new interval value only takes effect after an explicit stop+restart, and the next sync cycle fires at the new cadence, not the old one

#### Scenario: Admin enables sync that was off

- GIVEN `worldcupSync.enabled` is `false`
- WHEN an admin sets `worldcupSync.enabled: true` via `PUT /api/settings`
- THEN `startWorldcupSync(deps)` is called and sync cycles begin without a restart

#### Scenario: gating logic reads live settings, not the env var

- GIVEN `WORLDCUP_SYNC_ENABLED` env var is unset or `false`
- WHEN `worldcupSync.enabled: true` is set via `PUT /api/settings`
- THEN sync starts, because `startWorldcupSync` MUST check the in-memory settings value, not `process.env.WORLDCUP_SYNC_ENABLED` (env var gating is fully removed per this change)

### Requirement: Fixture Refresh Interval Delivery

`fixtureRefreshMs` MUST be delivered to the client the same way `inactivityLimitMs` is delivered today: as a field read once at app boot via `GET /api/session`, not via live push to already-open sessions.

#### Scenario: New page load picks up the updated interval

- GIVEN an admin has changed `fixtureRefreshMs` from `30000` to `45000`
- WHEN a client loads (or reloads) the app and calls `GET /api/session`
- THEN the response includes the new `fixtureRefreshMs` value, and `startFixtureAutoRefresh()` uses it for its `setInterval` delay

#### Scenario: Already-open session does not pick up the change without reload

- GIVEN a client session is already open with the old `fixtureRefreshMs` cached client-side
- WHEN an admin changes `fixtureRefreshMs` via `PUT /api/settings`
- THEN the already-open client continues polling at the old interval until the user reloads the page or re-authenticates — this is the accepted behavior, consistent with how `inactivityLimitMs` already behaves (read once at boot, no live push mechanism exists in this codebase)

### Requirement: Audit Logging for Settings Changes

Every successful `PUT /api/settings` MUST record an audit-log entry capturing which fields changed, their old and new values, the acting admin, and a timestamp.

#### Scenario: Audit entry on successful update

- GIVEN a successful `PUT /api/settings` changing `lockoutAttempts` from `3` to `5`
- WHEN the write completes
- THEN an audit-log entry is appended with `action: 'settings_updated'`, `userId`/`username`/`role` of the acting admin (from `req.session.user`, mirroring `recordAuditLog`'s existing signature), and a `detail` object containing at least the changed field names with their old and new values

#### Scenario: No audit entry on failed validation

- GIVEN a `PUT /api/settings` request that fails validation
- WHEN the response is `400`
- THEN no audit-log entry is recorded, consistent with `PUT /api/prize-pool`'s existing behavior of validating before any write or audit call
