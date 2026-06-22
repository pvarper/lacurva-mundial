# Tasks: Admin Runtime Settings (#52)

Ordered, sequential task list for `sdd-apply`. No automated test framework exists in this
project (per `CLAUDE.md` Gotchas) — verification is `node --check` plus manual exercise via
`pnpm dev`, not unit tests.

## 1. [x] Create `data/settings.json` defaults + `loadSettings()`/`applySettings()` skeleton

- **Satisfies**: Spec Requirement "Settings Persist Across Restart"
- **Files**: `server.js:14-19` (remove `PREDICTION_LOCK_MS` const, add `SETTINGS_DEFAULTS` object
  and `let settingsCache = null;`), new function block near `server.js:81` (after `writeJson`)
  adding `async function loadSettings()` and `async function applySettings(newSettings)`
  (cache-write + `writeJson('settings.json', ...)` only for now — sync-restart wiring comes in
  task 3-4, route wiring comes in task 5).
- **Detail**: `loadSettings()` tries `readJson('settings.json')`; on any error, falls back to
  `{ ...SETTINGS_DEFAULTS }` and self-heals by calling `writeJson('settings.json', settingsCache)`.
  Do NOT wire this into boot yet (task 4) — just define the functions.
- **Verify**: `node --check server.js`.
- **Parallel/Sequential**: Sequential — first task, no dependencies.

## 2. [x] Refactor existing hot-path readers to use `settingsCache`

- **Satisfies**: Spec Requirement "Settings Persist Across Restart" (cache becomes source of truth
  for lockout + prediction-lock logic), Requirement "Field Validation Bounds" (bounds only matter
  once these reads are live)
- **Files**: `server.js:173-176` (remove `LOCKOUT_ATTEMPTS`, `LOCKOUT_DURATION_MS`,
  `MAX_TEMPORARY_LOCKOUTS`, `LOCKOUT_RESET_MS` consts), `server.js:191, 202, 203, 206`
  (`resetStaleCounters`/`recordFailedAttempt` read `settingsCache.lockoutResetMs`,
  `.lockoutAttempts`, `.lockoutDurationMs`, `.maxTemporaryLockouts`), `server.js:220-223`
  (`isPredictionLocked` reads `settingsCache.predictionLockMs`), `server.js:293` (login-locked
  response message reads `settingsCache.lockoutDurationMs`).
- **Detail**: At this point `settingsCache` is still `null` until boot wiring lands in task 4 — this
  is fine because task 4 immediately follows in the same PR sequence before the app is runnable;
  if you want an intermediate runnable checkpoint, temporarily default `settingsCache` to
  `SETTINGS_DEFAULTS` at declaration (task 1) so the app stays bootable between commits.
- **Verify**: `node --check server.js`.
- **Parallel/Sequential**: Sequential — depends on task 1 (`settingsCache`/`SETTINGS_DEFAULTS` must
  exist first).

## 3. [x] `lib/worldcup-sync.js` signature change + stale comment fixes

- **Satisfies**: Spec Requirement "Worldcup Sync Hot-Reload", Requirement "Settings Persist Across
  Restart" (env var removal)
- **Files**: `lib/worldcup-sync.js:1` (remove fixed "every 60 seconds" claim from header comment),
  `lib/worldcup-sync.js:5` (remove "Opt-in: only starts when WORLDCUP_SYNC_ENABLED..." comment,
  replace with settings-driven description), `lib/worldcup-sync.js:15` (remove
  `const POLL_INTERVAL_MS = 10 * 1000;`), `lib/worldcup-sync.js:160-172`
  (`startWorldcupSync(deps, syncSettings)` — add `syncSettings` param, guard on
  `if (!syncSettings?.enabled) return;` instead of reading `process.env.WORLDCUP_SYNC_ENABLED`,
  `setInterval` callback uses `syncSettings.pollIntervalMs`).
- **Detail**: `stopWorldcupSync()` signature is unchanged. Confirmed `stopWorldcupSync` already
  exists and is exported (line 175, `module.exports` line 182-184) — server.js's current import on
  line 8 only destructures `startWorldcupSync`, so this task does NOT touch the export, only the
  signature of `startWorldcupSync`.
- **Verify**: `node --check lib/worldcup-sync.js`.
- **Parallel/Sequential**: Can run in parallel with task 2 (different file, no shared state) but
  must land before task 4 (boot wiring calls the new signature).

## 4. [x] Boot sequence wiring in server.js

- **Satisfies**: Spec Requirement "Settings Persist Across Restart", Requirement "Worldcup Sync
  Hot-Reload" (gating reads live settings, not env var)
- **Files**: `server.js:8` (import update: `const { startWorldcupSync, stopWorldcupSync } = require('./lib/worldcup-sync');`),
  `server.js:697-700` (bottom of file) — replace bare `app.listen(...)` +
  `startWorldcupSync({ readJson, writeJson })` with an async `boot()` function:
  `await loadSettings()` → `app.listen(PORT, ...)` →
  `startWorldcupSync({ readJson, writeJson }, settingsCache.worldcupSync)`, then call `boot()`.
- **Detail**: Matches design doc's exact boot sequence snippet. This is the point where
  `settingsCache` becomes non-null before any request can be served, making task 2's reads safe.
- **Verify**: `node --check server.js`, then `pnpm dev` — confirm server starts, console shows
  worldcup-sync log line reflecting `settings.json` defaults (`enabled: false` → "disabled via
  settings" log), confirm `data/settings.json` self-creates on first boot if absent.
- **Parallel/Sequential**: Sequential — depends on tasks 1, 2, 3 all landing first.

## 5. [x] `GET`/`PUT /api/settings` routes with validation + audit logging

- **Satisfies**: Spec Requirements "Read Current Settings", "Update Settings", "Field Validation
  Bounds", "Audit Logging for Settings Changes"
- **Files**: `server.js` new routes near line 633 (after the existing prize-pool routes).
- **Detail**:
  - `GET /api/settings` — `requireAdmin` gated, returns `settingsCache` as-is, `200`.
  - `PUT /api/settings` — `requireAdmin` gated. Pick known fields off `req.body` only (mirror
    `PUT /api/users/:id` pattern — unknown fields silently ignored, not echoed/persisted). Validate
    each present field against the bounds table from the design doc (`predictionLockMs` 0–3600000,
    `lockoutAttempts` 1–20, `lockoutDurationMs` 1000–86400000, `maxTemporaryLockouts` 1–20,
    `lockoutResetMs` 1000–604800000 AND `>= lockoutDurationMs` of the merged result,
    `worldcupSync.enabled` boolean, `worldcupSync.pollIntervalMs` 5000–300000,
    `fixtureRefreshMs` 5000–300000). Use `Number.isFinite` guard pattern from `PUT /api/prize-pool`.
    First validation failure short-circuits with `400 { error: '<message>' }`, no write, no audit
    entry. On success: merge with `settingsCache` (partial update — only touch submitted fields),
    call `applySettings(merged)` (writes file + updates cache + conditionally restarts sync per
    task 1's skeleton, now extended to diff `worldcupSync.*` and call
    `stopWorldcupSync()`/`startWorldcupSync(deps, merged.worldcupSync)` only if those fields
    changed), then `await recordAuditLog(req, 'settings_updated', { previous: previousSettings, updated: merged })`,
    respond `200` with `merged`.
- **Verify**: `node --check server.js`, then manual smoke via `pnpm dev`: log in as admin, `curl`
  or browser devtools `GET /api/settings` (expect 200 + full object), `PUT /api/settings` with a
  valid partial body (expect 200, `data/settings.json` updated, audit log entry appended), `PUT`
  with an out-of-bounds value (expect 400, no file/audit change), `GET /api/settings` as a non-admin
  session (expect 403).
- **Parallel/Sequential**: Sequential — depends on task 4 (`applySettings`/`settingsCache` must be
  fully wired and boot-safe before the route can call them).

## 6. [x] `GET /api/session` response: add `fixtureRefreshMs`

- **Satisfies**: Spec Requirement "Fixture Refresh Interval Delivery"
- **Files**: `server.js:352-354`.
- **Detail**: Add `fixtureRefreshMs: settingsCache.fixtureRefreshMs` alongside the existing
  `inactivityLimitMs: SESSION_MAX_AGE_MS` field in the `/api/session` JSON response.
- **Verify**: `node --check server.js`, manual: `GET /api/session` while authenticated, confirm
  `fixtureRefreshMs` present in response body.
- **Parallel/Sequential**: Can run in parallel with task 5 (different code region, no shared
  mutation) but both depend on task 4.

## 7. [x] `public/js/app.js`: consume `fixtureRefreshMs` from session response

- **Satisfies**: Spec Requirement "Fixture Refresh Interval Delivery"
- **Files**: `public/js/app.js:14` (remove `const FIXTURE_REFRESH_MS = 30 * 1000;`),
  `public/js/app.js` `state` object near lines 1-12 (add `fixtureRefreshMs: 30000` as client-side
  fallback default), `public/js/app.js:201-207` (`startFixtureAutoRefresh` reads
  `state.fixtureRefreshMs` instead of the removed const), `public/js/app.js:1214-1216`
  (destructure `fixtureRefreshMs` from `/api/session` response, assign to `state.fixtureRefreshMs`,
  mirroring how `inactivityLimitMs` is already handled there).
- **Verify**: manual via `pnpm dev` — load app, confirm fixture auto-refresh still fires (check
  console/network tab timing), change `fixtureRefreshMs` in `data/settings.json` directly, reload,
  confirm new interval takes effect (only observable after reload, per spec's documented
  limitation).
- **Parallel/Sequential**: Sequential — depends on task 6 (server must emit the field first to
  verify end-to-end).

## 8. [x] Admin Settings UI: `public/index.html` + `public/js/app.js`

- **Satisfies**: Spec Requirements "Read Current Settings", "Update Settings" (UI surface for the
  API built in task 5)
- **Files**:
  - `public/index.html:93-99` — add `#settingsMenu` sidebar button after `#auditMenu`, same
    `.admin-only hidden` classes.
  - `public/index.html` after `auditView`'s closing `</section>` (~line 350) — add new
    `#settingsView` section mirroring `#auditView`'s structure: heading + one form per logical
    group (Prediction Lock, Lockout Policy, Worldcup Sync, Fixture Refresh), labeled number/checkbox
    inputs with client-side `min`/`max`/`required` matching the server bounds table, one submit
    button, one `#settingsMessage` feedback paragraph.
  - `public/index.html:416-423` — add matching `#settingsMenu`-equivalent bottom-nav button after
    the audit one.
  - `public/js/app.js` `elements` object (~lines 22-71) — add `settingsView`, `settingsForm`,
    `settingsMessage` element refs.
  - `public/js/app.js` new functions near `loadUsers`/`renderPrizePool` — add `loadSettings()`
    (GET, populate form) and `saveSettings(form)` (PUT, re-render + `setMessage()` feedback),
    following the existing `prizePoolPanel` submit-handler pattern.
  - `public/js/app.js:145-154` (`showView`) — add `if (viewId === 'settingsView') loadSettings();`.
- **Detail**: This is the largest single task (new HTML markup block + two new JS functions + nav
  wiring in two places). Reuse existing CSS classes from `auditView`/`prizePoolPanel` — no new
  `public/css/styles.css` rules expected.
- **Verify**: manual via `pnpm dev` — log in as admin, confirm Settings nav item appears (sidebar +
  bottom nav), click into it, confirm form pre-populates from `GET /api/settings`, submit a valid
  change, confirm success message + persisted value on reload, submit an invalid value, confirm
  inline/`#settingsMessage` error and no silent failure. Log in as non-admin, confirm nav item is
  absent (`.admin-only hidden` class).
- **Parallel/Sequential**: Sequential — depends on task 5 (API must exist) and task 6/7 (consistent
  with how the rest of the page already reads session-delivered settings) being merged first.

## 9. [x] `CLAUDE.md`: document new out-of-scope `.env` vars

- **Satisfies**: Design doc's "Migration / Rollout" note on out-of-scope settings; not a spec
  requirement but required by the proposal's no-dual-source-of-truth decision and the design's
  File Changes table.
- **Files**: `CLAUDE.md` Security Notes section.
- **Detail**: Document `SESSION_MAX_AGE_MS`, `LOGIN_RATE_LIMIT_WINDOW_MS`, `LOGIN_RATE_LIMIT_MAX`
  env vars (the settings explicitly kept out of the admin UI/settings.json scope per the proposal),
  noting their hardcoded fallback values if unset.
- **Verify**: visual review only — no executable check applies to a doc-only change.
- **Parallel/Sequential**: Can run in parallel with any other task (pure documentation, no code
  dependency) but is listed last since it documents the env vars that remain after the settings.json
  surface is finalized.

---

## Review Workload Forecast

- Estimated total changed lines across all files: **~420 lines** (server.js ~140: const removal +
  cache/loadSettings/applySettings + route handlers + boot refactor + ~6 call-site swaps;
  lib/worldcup-sync.js ~25: signature + comments; public/js/app.js ~90: const removal, state field,
  two new functions, showView wiring, session response destructure; public/index.html ~140: two
  nav buttons + full new `#settingsView` section with 4 form groups; data/settings.json ~12 new;
  CLAUDE.md ~10 doc lines).
- `Chained PRs recommended: Yes`
- `400-line budget risk: High`
- `Decision needed before apply: Yes`
