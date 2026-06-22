# Design: Admin-Managed Runtime Settings Screen (#52)

## Technical Approach

In-memory `settingsCache` object inside `server.js`, loaded from `data/settings.json` at boot, mutated only by a single `applySettings(newSettings)` function called from `PUT /api/settings`. Hot-path readers (`isPredictionLocked`, lockout functions) read from the cache instead of module-level `const`s. `lib/worldcup-sync.js` is refactored to accept `pollIntervalMs` and `enabled` as call-time arguments instead of reading `POLL_INTERVAL_MS`/`process.env.WORLDCUP_SYNC_ENABLED`. No new module file is created for the cache — it lives in `server.js` next to the other module-level state (`writeLocks` Map), consistent with the codebase's existing pattern of colocating small pieces of process state with the routes that use them.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Cache location | Plain object in `server.js`, not a new module | Separate `lib/settings.js` module | Codebase has no precedent for extracting small stateful singletons into `lib/` (only `worldcup-sync.js` and pure helpers live there); `writeLocks` Map sets the precedent of inline state in `server.js`. Avoids a needless cross-module import for ~9 fields. |
| Sync restart trigger | `applySettings()` diffs old vs new `worldcupSync.*`, calls `stopWorldcupSync()` then `startWorldcupSync(deps, settings)` only if `enabled` or `pollIntervalMs` changed | Always stop/start on every settings write | Avoids resetting `warnedUnmatchedFixtureIds` and losing in-flight-cycle continuity when unrelated fields (e.g. `lockoutAttempts`) are edited. |
| Race on mid-flight cycle | Accept it — `stopWorldcupSync()` only clears the timer; an in-flight `runSyncCycle()` invocation (already past the `setInterval` callback firing) runs to completion using the OLD interval closure value it captured, but its `deps` object is by-reference so it still reads/writes current files correctly. The NEXT scheduled cycle uses the new interval. | Track an `AbortController` / cycle generation counter to hard-cancel in-flight fetch | A stale fetch finishing 1 cycle late is harmless (same idempotent `applyFixtureSync` write-if-changed logic already in place); hard cancellation adds complexity for no observable benefit on a single-instance app. |
| Env var removal | `WORLDCUP_SYNC_ENABLED` fully removed; `enabled` read from `settings.json` at boot | Keep env var as a fallback/override | Proposal explicitly states no dual-source-of-truth; env var stops being read entirely. |
| Validation floor on `pollIntervalMs` | Hard minimum 5000 ms server-side | No floor (admin self-regulates) | Risk doc flags "implicit floor to avoid hammering worldcup26.ir" — must be explicit, not implicit. 5s chosen as half the current default (10s), generous enough for legitimate tightening, not so low it risks provider rate-limiting. |
| `fixtureRefreshMs` delivery | Added to existing `GET /api/session` response, alongside `inactivityLimitMs` | New dedicated endpoint | Proposal explicitly says "delivered the same way `inactivityLimitMs` already is" — same endpoint, same fetch-once-at-boot lifecycle, zero new API surface. |
| Settings file missing/corrupt at boot | Fall back to hardcoded defaults in memory, write them to `data/settings.json` immediately so the file self-heals | Throw and refuse to boot | App currently never throws on missing data files in a way that blocks startup (e.g. `readAuditLogs` catches and returns `[]`); consistent with that resilience pattern. First-run/upgrade path must not require a manual seed step. |

## Data Flow

    Boot: readSettingsFile() → settingsCache (in memory)
                                   │
                    ┌──────────────┼───────────────────┐
                    ▼              ▼                    ▼
         isPredictionLocked   getLockoutStatus    startWorldcupSync(deps, cache)
         recordFailedAttempt  etc. (hot path reads)   (interval uses cache.worldcupSync.*)
                    │
    Admin UI ──PUT /api/settings──▶ validate ──▶ writeJson('settings.json', merged)
                                       │
                                       ▼
                              applySettings(merged)
                                  │         │
                          settingsCache = merged
                                  │
                          worldcupSync changed? ──yes──▶ stopWorldcupSync() → startWorldcupSync(deps, merged)
                                  │
                          recordAuditLog('settings_updated', diff)

## Final `data/settings.json` Shape

```json
{
  "predictionLockMs": 60000,
  "lockoutAttempts": 3,
  "lockoutDurationMs": 600000,
  "maxTemporaryLockouts": 3,
  "lockoutResetMs": 3600000,
  "worldcupSync": {
    "enabled": false,
    "pollIntervalMs": 10000
  },
  "fixtureRefreshMs": 30000
}
```

Defaults above are exact current hardcoded values, except `worldcupSync.enabled: false` (matches current behavior when `WORLDCUP_SYNC_ENABLED` env var is unset — safe-by-default).

**Validation bounds** (enforced in `PUT /api/settings`):

| Field | Type | Bounds |
|---|---|---|
| `predictionLockMs` | integer | 0 – 3600000 (max 60 min) |
| `lockoutAttempts` | integer | 1 – 20 |
| `lockoutDurationMs` | integer | 1000 – 86400000 (max 24h) |
| `maxTemporaryLockouts` | integer | 1 – 20 |
| `lockoutResetMs` | integer | 1000 – 604800000 (max 7d) |
| `worldcupSync.enabled` | boolean | — |
| `worldcupSync.pollIntervalMs` | integer | **5000 (floor) – 300000** (max 5 min) |
| `fixtureRefreshMs` | integer | 5000 – 300000 |

## File Changes

| File | Action | Description |
|---|---|---|
| `data/settings.json` | Create | New runtime config file, see shape above. Not seeded in repo (created on first boot if missing) — add to `.gitignore` alongside other runtime data files if not already covered. |
| `server.js:14-19` | Modify | Remove `PREDICTION_LOCK_MS`, keep `SESSION_MAX_AGE_MS` (out of scope, but becomes `process.env.SESSION_MAX_AGE_MS \|\| (120*60*1000)`). Add `let settingsCache = null;` and `const SETTINGS_DEFAULTS = {...}`. |
| `server.js` (new, near line 81 after `writeJson`) | Modify | Add `async function loadSettings()` (boot-time load+fallback+self-heal) and `async function applySettings(newSettings)` (cache update + worldcup sync restart + diff for audit). |
| `server.js:173-176` | Modify | Remove `LOCKOUT_ATTEMPTS`, `LOCKOUT_DURATION_MS`, `MAX_TEMPORARY_LOCKOUTS`, `LOCKOUT_RESET_MS` consts. |
| `server.js:191, 202, 203, 206` | Modify | `resetStaleCounters`/`recordFailedAttempt` read `settingsCache.lockoutResetMs`, `.lockoutAttempts`, `.lockoutDurationMs`, `.maxTemporaryLockouts` instead of the removed consts. |
| `server.js:220-223` | Modify | `isPredictionLocked` reads `settingsCache.predictionLockMs`. |
| `server.js:293` | Modify | Login-locked response message reads `settingsCache.lockoutDurationMs` instead of `LOCKOUT_DURATION_MS`. |
| `server.js:352-354` (`GET /api/session`) | Modify | Add `fixtureRefreshMs: settingsCache.fixtureRefreshMs` to response. |
| `server.js` (new routes, near line 633 after prize-pool) | Modify | Add `GET /api/settings` and `PUT /api/settings` (see API Contract below). |
| `server.js:697-700` | Modify | Replace `startWorldcupSync({ readJson, writeJson })` with `startWorldcupSync({ readJson, writeJson }, settingsCache.worldcupSync)`, called only after `await loadSettings()` resolves. Move into an async boot sequence since `loadSettings()` is async. |
| `lib/worldcup-sync.js:1` | Modify | Fix stale header comment — remove fixed "every 60 seconds" claim, rephrase to not state a number. |
| `lib/worldcup-sync.js:5` | Modify | Remove "Opt-in: only starts when WORLDCUP_SYNC_ENABLED..." comment, replace with settings-driven description. |
| `lib/worldcup-sync.js:15` | Modify | Remove `const POLL_INTERVAL_MS = 10 * 1000;` module-level const. |
| `lib/worldcup-sync.js:160-167` | Modify | `startWorldcupSync(deps, syncSettings)` signature change — see Interfaces below. |
| `lib/worldcup-sync.js:168-172` | Modify | `setInterval` callback uses `syncSettings.pollIntervalMs` param, not removed const. |
| `public/js/app.js:14` | Modify | Remove `const FIXTURE_REFRESH_MS = 30 * 1000;` module-level const. |
| `public/js/app.js:1-12` (`state`) | Modify | Add `fixtureRefreshMs: 30000` to `state` as the fallback default. |
| `public/js/app.js:201-207` | Modify | `startFixtureAutoRefresh` reads `state.fixtureRefreshMs` instead of the removed const. |
| `public/js/app.js:1214-1216` | Modify | Destructure `fixtureRefreshMs` from `/api/session` response, assign to `state.fixtureRefreshMs`. |
| `public/js/app.js` (new, near `elements` object line 22-71) | Modify | Add `settingsView`, `settingsForm`, `settingsMessage` element refs. |
| `public/js/app.js` (new functions, near `loadUsers`/`renderPrizePool`) | Modify | Add `loadSettings()` (GET, render form) and `saveSettings(form)` (PUT, re-render) following the `prizePoolPanel` submit-handler pattern. |
| `public/js/app.js:145-154` (`showView`) | Modify | Add `if (viewId === 'settingsView') loadSettings();`. |
| `public/index.html:93-99` | Modify | Add `#settingsMenu` button after `#auditMenu`, same `.admin-only hidden` classes. |
| `public/index.html:350` (after `</section>` closing `auditView`) | Modify | Add new `#settingsView` section. |
| `public/index.html:416-423` (bottom nav) | Modify | Add matching `#settingsMenu`-equivalent bottom-nav button after the audit one. |
| `CLAUDE.md` Security Notes | Modify | Document `SESSION_MAX_AGE_MS`, `LOGIN_RATE_LIMIT_WINDOW_MS`, `LOGIN_RATE_LIMIT_MAX` env vars (out-of-scope settings moved here per proposal). |

## Interfaces / Contracts

### `applySettings(newSettings)` (server.js)

```js
async function applySettings(newSettings) {
  const previous = settingsCache;
  settingsCache = newSettings;
  await writeJson('settings.json', newSettings);

  const syncChanged = !previous ||
    previous.worldcupSync.enabled !== newSettings.worldcupSync.enabled ||
    previous.worldcupSync.pollIntervalMs !== newSettings.worldcupSync.pollIntervalMs;

  if (syncChanged) {
    stopWorldcupSync();
    startWorldcupSync({ readJson, writeJson }, newSettings.worldcupSync);
  }
}
```

Note: `writeJson` already happens inside `applySettings` (unlike `prize-pool`, which writes before calling nothing further) — this centralizes "cache update + persist + side-effect" in one place, the single orchestrator the proposal calls for.

### `startWorldcupSync(deps, syncSettings)` (lib/worldcup-sync.js)

```js
function startWorldcupSync(deps, syncSettings) {
  if (intervalHandle) return;
  if (!syncSettings?.enabled) {
    console.log('[worldcup-sync] disabled via settings.');
    return;
  }
  console.log(`[worldcup-sync] starting sync, polling every ${syncSettings.pollIntervalMs}ms.`);
  intervalHandle = setInterval(() => {
    runSyncCycle(deps).catch((error) => {
      console.error(`[worldcup-sync] sync cycle failed: ${error.message}`);
    });
  }, syncSettings.pollIntervalMs);
}
```

`stopWorldcupSync()` signature is unchanged (takes no args, just clears `intervalHandle`).

### `GET /api/settings`

Request: none (requireAdmin). Response `200`: the full `settingsCache` object (same shape as `data/settings.json`).

### `PUT /api/settings`

Request body: full settings object (all 8 fields + nested `worldcupSync`), same shape as response.

Validation failure → `400 { "error": "<specific bounds message>" }`, one check per field, first failure wins (same short-circuit style as `PUT /api/prize-pool`).

Success → `200` with the saved settings object. Audit log entry:

```js
await recordAuditLog(req, 'settings_updated', {
  previous: previousSettings,
  updated: newSettings
});
```

(Mirrors `prize_pool_updated`'s pattern of logging the resulting object; here we also include `previous` since multiple unrelated fields could change in one save and an admin needs to see what moved.)

### Boot sequence change (server.js bottom)

```js
async function loadSettings() {
  try {
    settingsCache = await readJson('settings.json');
  } catch (error) {
    settingsCache = { ...SETTINGS_DEFAULTS };
    await writeJson('settings.json', settingsCache);
  }
}

async function boot() {
  await loadSettings();
  app.listen(PORT, () => {
    console.log(`La Curva Mundial running at http://localhost:${PORT}`);
  });
  startWorldcupSync({ readJson, writeJson }, settingsCache.worldcupSync);
}

boot();
```

This replaces the bare `app.listen(...)` + trailing `startWorldcupSync(...)` call at the bottom of the file.

## Client Delivery Limitation (explicit)

`fixtureRefreshMs` is read from `/api/session` once, at app load (line ~1214). **It does not hot-update an already-open tab.** An admin changing `fixtureRefreshMs` via Settings only affects browser sessions that load (or reload) the app AFTER the save. This is the same limitation `inactivityLimitMs` already has today — no new regression, just an explicit carry-over. Not fixing this in v1: no existing polling/push mechanism exists to notify open tabs of settings changes, and building one is out of scope for this change.

## Admin UI

`#settingsView` mirrors `#auditView`'s section structure: heading + one form per logical group (Prediction Lock, Lockout Policy, Worldcup Sync, Fixture Refresh), each with labeled number/checkbox inputs and client-side `min`/`max`/`required` attributes matching the server bounds table above. One submit button, one `#settingsMessage` feedback paragraph (same `setMessage()` helper used everywhere else). `#settingsMenu` nav button added to sidebar (after `#auditMenu`, line 99) and bottom nav (after audit, line 423), both `.admin-only hidden`.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | `applySettings` triggers sync restart only when worldcupSync fields change | Mock `stopWorldcupSync`/`startWorldcupSync`, call with changed/unchanged payloads |
| Unit | `startWorldcupSync` respects `enabled: false` and uses passed `pollIntervalMs` | Call directly with fake deps + fake timers |
| Integration | `PUT /api/settings` validation bounds, audit log shape, cache update reflected in subsequent `GET` | `supertest`-style request against running app (or manual `node --check` + manual smoke if no test runner exists yet) |
| Integration | `isPredictionLocked`/lockout functions read updated cache without restart | Update settings via PUT, then exercise a login/prediction request in the same process |
| Manual/E2E | Admin UI form round-trip, worldcup sync interval actually changes cadence (observable via console.log timestamp diff) | Manual verification during apply/verify phase — repo has no test script yet per `CLAUDE.md` Gotchas |

## Migration / Rollout

No data migration required. `data/settings.json` self-creates with defaults on first boot after this change ships (see `loadSettings()` fallback). `WORLDCUP_SYNC_ENABLED` env var becomes dead — if still set in a deploy environment, it is silently ignored, not erroring (acceptable per proposal's no-dual-source-of-truth confirmation). Deploys must add `SESSION_MAX_AGE_MS`, `LOGIN_RATE_LIMIT_WINDOW_MS`, `LOGIN_RATE_LIMIT_MAX` env vars if they want non-default values for the now-explicit out-of-scope settings (otherwise hardcoded fallback constants apply, matching current behavior).

## Open Questions

None — proposal's open items (validation bounds, `.env.example` vs `CLAUDE.md` docs, sync-restart mechanics) are resolved above.
