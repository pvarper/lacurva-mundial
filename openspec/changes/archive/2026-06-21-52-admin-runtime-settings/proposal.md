# Proposal: Admin-Managed Runtime Settings Screen (#52)

## Problem Statement

Operational tuning knobs — prediction lock window, login lockout thresholds, worldcup sync on/off and poll interval, fixture auto-refresh interval — are hardcoded `const` values in `server.js`, `lib/worldcup-sync.js`, and `public/js/app.js`. Changing any of them today requires editing source code and restarting the process. There is no audit trail of who changed what, and admins have no visibility into current effective values.

This is a real operational cost during a live World Cup tournament: lockout thresholds or the sync poll interval may need adjustment in response to live conditions (e.g. provider rate limits, abuse patterns), and a code-edit-and-restart cycle is too slow and too risky (restart drops in-flight sessions, requires shell/deploy access an admin user does not have).

## Intent

Give admin users a UI to view and edit the operationally relevant runtime settings, persisted to `data/settings.json`, applied live without a server restart. Settings that cannot be safely or meaningfully hot-reloaded (rate limiter construction, session cookie hard TTL) are explicitly deferred to environment variables — restart-required, but at least centralized and documented rather than hardcoded magic numbers, and outside this change's UI surface.

Success looks like: an admin opens a "Settings" tab, sees current values for prediction lock, lockout policy, worldcup sync, and fixture refresh interval, edits one or more, saves, and the new behavior takes effect immediately — confirmed by the worldcup sync interval actually changing cadence and the prediction lock window actually changing for the next prediction check, with no process restart and an audit-log entry recording the change.

## Architecture Decision: in-memory cache + `applySettings()` orchestrator

Confirming the exploration phase's recommended Approach 2, not Approach 1 (read-fresh-from-disk-per-request).

Rationale: five of the settings (`predictionLockMs`, `lockoutAttempts`, `lockoutDurationMs`, `maxTemporaryLockouts`, `lockoutResetMs`) are read on hot paths — every prediction check, every login attempt. Re-reading `data/settings.json` from disk on each of those calls adds I/O latency and lock contention with the existing per-file `writeLocks` Map, for no benefit, since the values only change on an explicit admin write. An in-memory object loaded at boot and refreshed only after a successful `PUT /api/settings` gives O(1) reads with zero added I/O on the hot path.

The two genuinely hard cases are not "read fresh," they're "re-construct a stateful thing":
- worldcup sync's `setInterval` captures its delay by value at call time — changing the in-memory number does nothing to a running timer. Requires explicit `stopWorldcupSync()` → `startWorldcupSync(deps)` sequencing.
- `loginLimiter` and session `maxAge` have the same closure-capture problem, which is exactly why this proposal moves them out of admin-editable scope (see Non-Goals) rather than building a middleware-swapping mechanism for they.

A single `applySettings(newSettings)` orchestrator function is the one place that knows how to react to a settings change: update the in-memory cache, and for the worldcup sync subsystem specifically, stop and restart it with the new `enabled`/`pollIntervalMs` values. This keeps the stateful-restart logic in one tested function instead of scattered across the settings route handler.

## Scope

### In scope (v1) — `data/settings.json`, admin-editable, hot-reload, no restart

| Setting | Current hardcoded location | Current value |
|---|---|---|
| `predictionLockMs` | `server.js:17` (`PREDICTION_LOCK_MS`) | 60000 (1 min) |
| `lockoutAttempts` | `server.js:173` (`LOCKOUT_ATTEMPTS`) | 3 |
| `lockoutDurationMs` | `server.js:174` (`LOCKOUT_DURATION_MS`) | 600000 (10 min) |
| `maxTemporaryLockouts` | `server.js:175` (`MAX_TEMPORARY_LOCKOUTS`) | 3 |
| `lockoutResetMs` | `server.js:176` (`LOCKOUT_RESET_MS`) | 3600000 (60 min) |
| `worldcupSync.enabled` | `WORLDCUP_SYNC_ENABLED` env var (`lib/worldcup-sync.js:162`) | replaces the env var entirely |
| `worldcupSync.pollIntervalMs` | `lib/worldcup-sync.js:15` (`POLL_INTERVAL_MS`) | 10000 (10s, despite stale "60s" comment/log) |
| `fixtureRefreshMs` | `public/js/app.js:14` (`FIXTURE_REFRESH_MS`) | 30000 (30s) — delivered to client the same way `inactivityLimitMs` already is |

`WORLDCUP_SYNC_ENABLED` is fully replaced by `worldcupSync.enabled` in `data/settings.json`. There is no dual-source-of-truth question to resolve here: the env var stops being read after this change ships. `lib/worldcup-sync.js`'s gating logic moves from "check `process.env` once at module load" to "check the current in-memory settings value every time `startWorldcupSync` is invoked," and the settings-update handler calls `stopWorldcupSync()` then `startWorldcupSync(deps)` whenever either `enabled` or `pollIntervalMs` changes.

Also fixed regardless of scope: the stale header comment (line 1) and `console.log` (line 167) in `lib/worldcup-sync.js` that claim "60 seconds" / "60s" while the actual default is 10s. Since the interval becomes admin-configurable, hardcoding any number in a comment or log string is actively misleading — both must read the live configured value or be rephrased to not state a fixed number.

### Out of scope (v1) — moves to `.env`, NOT admin-editable, requires restart

This is an explicit user decision for this change, not an oversight:

- `SESSION_MAX_AGE_MS` (session cookie `maxAge`, `server.js:16`, currently 120 min) — becomes an env var (e.g. `SESSION_MAX_AGE_MS`), read once at `session()` construction time, same pattern as `SESSION_SECRET`. Reason: `express-session`'s cookie `maxAge` is captured at middleware construction; true hot-reload would need a custom session middleware wrapper reading the value per-request from a mutable reference. The existing client-side inactivity timer (`GET /api/session` → `inactivityLimitMs`, already proven hot-reloadable) is the actual product-level enforcement; the cookie's hard TTL is a secondary backstop and is not worth the added complexity for v1.
- `loginLimiter` config (`windowMs`/`max`, `server.js:246-253`) — becomes two env vars (e.g. `LOGIN_RATE_LIMIT_WINDOW_MS`, `LOGIN_RATE_LIMIT_MAX`), read once at module load when the `express-rate-limit` instance is constructed. Reason: the rate limiter middleware instance is built once and wired into the route at module load; true hot-reload requires either swapping the middleware reference per-request (no native Express support) or a wrapper middleware delegating to a mutable `currentLimiter`. Not justified for a security-relevant control that changes rarely — env var + restart is an acceptable, simpler tradeoff.

Both of these are genuinely **not** in this change's admin settings UI or `data/settings.json`. They become documented env vars instead of undocumented hardcoded constants — an improvement in clarity even though they're not hot-reloadable.

This repo has no `.env.example` or dotenv loader today (confirmed: only `SESSION_SECRET` is read via bare `process.env.SESSION_SECRET`, no `.env` file convention exists). This proposal does not introduce dotenv. The two new env vars follow the exact same bare-`process.env` convention as `SESSION_SECRET`, documented in `CLAUDE.md`'s Security Notes section (which already documents `SESSION_SECRET`) rather than in a new `.env.example` file, since no such file exists to extend.

## New API Surface

- `GET /api/settings` — gated by existing `requireAdmin` middleware (`server.js:166-171`, zero modification needed). Returns the current in-memory settings object.
- `PUT /api/settings` — gated by `requireAdmin`. Validates each field (positive integers, reasonable bounds — these are security-relevant values), writes to `data/settings.json` via the existing `writeJson` atomic-write-with-lock pattern, updates the in-memory cache, calls `applySettings()` to trigger any required subsystem restarts (worldcup sync), and records an audit-log entry. This follows the exact precedent of `PUT /api/prize-pool` (`server.js:610-633`) for validation style and audit-log-on-write behavior — no new pattern introduced.

## New Admin UI

Extend the existing `.admin-only` nav pattern in `public/index.html`:
- New `#settingsMenu` button in the sidebar nav (after `#auditMenu`) and bottom nav, same `.admin-only hidden` classes as existing admin-only entries.
- New `#settingsView` section, mirroring the `usersView`/`auditView` structure (form fields for each editable setting, save button, current-value display).
- No new UI paradigm. No new JS state-management pattern — follows the existing `loadUsers`/`createUserForm`-style fetch-render-submit flow in `public/js/app.js`.

`fixtureRefreshMs` reaches the client the same way `inactivityLimitMs` already does today: as a field in an existing or new API response read at session/app-boot time, not as a separate hardcoded client constant. `startFixtureAutoRefresh()` already tears down and restarts its own interval on every view change, so no new teardown logic is needed beyond using the live value.

## Risks / Tradeoffs

- **Worldcup sync interval hot-reload (HIGH)** — `setInterval`'s delay is captured by value; the settings-update handler MUST explicitly call `stopWorldcupSync()` then `startWorldcupSync(deps)` whenever `enabled` or `pollIntervalMs` changes. This is the single highest-risk mechanical detail for the design/tasks phase to get right — a settings write that updates the JSON file but doesn't restart the timer would silently fail to apply, with no error surfaced to the admin.
- **In-memory cache vs. disk drift** — acceptable risk for this single-instance app (no multi-process/multi-instance deployment), consistent with the rest of the codebase's assumptions (e.g. `writeLocks` Map is also process-local). If `data/settings.json` is ever edited directly on disk while the server is running, the in-memory cache will not pick up the change until next boot — this is a known, accepted limitation, not a bug to fix in this change.
- **Stale "60s" comment/log** — must be fixed as part of this change regardless of the settings UI scope; leaving it would actively mislead anyone reading the new admin UI's displayed poll interval against the source code comment.
- **Validation scope creep** — each of the 8 in-scope settings needs independent bounds validation (positive integers, sane ranges) since these are security-relevant (lockout policy) or stability-relevant (sync interval) values; the spec/design phase must enumerate exact bounds per field, not leave them implicit.
- **Two env vars introduced with no `.env.example` precedent** — `SESSION_MAX_AGE_MS` and the login rate-limiter vars need documentation somewhere discoverable; this proposal recommends extending `CLAUDE.md`'s Security Notes section rather than inventing a `.env.example` file, but the design/spec phase should confirm this is sufficient or decide a `.env.example` file should be introduced as part of this change.
