# Proposal: Audit Log Retention and Daily View (#47)

## Problem Statement

The audit log has three related issues:

1. `recordAuditLog()` silently truncates to the last 1000 entries (`server.js:139`), discarding historical audit data — unacceptable for a compliance/audit trail.
2. `GET /api/audit-log` returns the entire log on every request with no server-side date filtering; the frontend (bitácora view) fetches everything and filters client-side. This wastes bandwidth/CPU and grows unbounded as the log grows.
3. The World Cup fixture sync job writes `fixture_synced` and `fixture_sync_unmatched` entries to the audit log on every poll, including repeated identical syncs (a dedup bug elsewhere). The bitácora is flooded with noise like repeated `fixture_synced ... (null-null)` entries, burying real admin/user actions.

## Scope

**In scope:**
- Remove the `.slice(-1000)` cap in `recordAuditLog()` — persist all entries indefinitely.
- Add a `date` query param (YYYY-MM-DD, America/La_Paz) to `GET /api/audit-log`; default frontend request to `todayBoliviaDate()`, matching the existing pattern in `loadPredictions()`.
- Remove the two `recordAuditLog(...)` calls in `lib/worldcup-sync.js` (`fixture_synced` and `fixture_sync_unmatched`) so sync events never reach the audit log.
- Keep the existing date filter UI in the bitácora view, but it now drives the server request instead of client-side filtering of an already-fetched full dataset.

**Out of scope:**
- Fixing the underlying dedup bug in `applyFixtureSync`'s "unchanged" check that causes repeated identical syncs to fire in the first place. That bug still exists after this change; it's just no longer logged to the audit trail. Tracked separately if needed.
- Any new persistence backend, log rotation/archival strategy, or pagination beyond per-day filtering.
- Changing fixture sync console logging (`console.warn` stays).
- Changing the `username`/`action` client-side filters already in `filteredAuditLogs()` — those remain client-side on top of the server-filtered day.

## Approach

1. **Uncapped persistence** — in `server.js` `recordAuditLog()`, change `writeJson('audit-log.json', logs.slice(-1000))` to `writeJson('audit-log.json', logs)`. No other change needed; `writeJson`'s existing mutex already makes this safe under concurrent writes.

2. **Server-side daily filter** — `GET /api/audit-log` reads `req.query.date` (YYYY-MM-DD). If present, filter `logs` to entries whose `timestamp` converted to America/La_Paz date (same `Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' })` logic already used client-side) equals the param; otherwise return all (used when an admin explicitly clears the date filter to see full history). Reuse a small shared helper to avoid duplicating the Bolivia-date conversion across two files. Update `loadAuditLog()` in `app.js` to call `api('/api/audit-log?date=' + (elements.auditDateFilter.value || todayBoliviaDate()))`, defaulting the filter input itself to today on view load (mirrors `loadPredictions()`). Drop the date check inside `filteredAuditLogs()` since the server now does it; keep user/action filters client-side.

3. **Stop logging sync noise** — delete the `await recordAuditLog(SYNC_REQUEST_CONTEXT, 'fixture_synced', {...})` call in `applyFixtureSync` and the `await recordAuditLog(SYNC_REQUEST_CONTEXT, 'fixture_sync_unmatched', {...})` call in `recordUnmatched`, both in `lib/worldcup-sync.js`. The `console.warn` in `recordUnmatched` stays for operator visibility. No change to `deps` injection signature is required beyond no longer calling `recordAuditLog`; leave the dependency wired in case future use needs it, or remove if unused elsewhere (verify during implementation).

## Acceptance Criteria

- Audit log file grows without truncation; no `.slice(-1000)` or equivalent cap remains in `recordAuditLog()`.
- `GET /api/audit-log?date=YYYY-MM-DD` returns only entries from that Bolivia-local calendar day; omitting `date` returns full history (admin "view all" still works).
- Bitácora view loads defaulting to today's entries (Bolivia time) without requiring the admin to pick a date first.
- Fixture sync polling no longer creates any `fixture_synced` or `fixture_sync_unmatched` audit-log entries, even on repeated identical syncs.
- Existing user/action client-side filters in the bitácora view continue to work unchanged.
- `node --check server.js` and `node --check lib/worldcup-sync.js` pass.
