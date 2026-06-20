# Verify Report: fix-47-audit-log-retention-daily-view

Commit verified: 223f2bc (branch fix/47-audit-log-retention-daily-view)

## Status: PASS (no CRITICAL issues)

## Findings

### CRITICAL
None.

### WARNING
1. **tasks.md "Resolved Contract Override" section is stale/wrong vs. actual implementation.** It states "date omitted or invalid format -> defaults to today" (no 400 on invalid format), contradicting `specs/audit-log-date-filtering/spec.md`'s own "Invalid date format returns an error" scenario (400). The actual server.js code implements the spec.md contract correctly (invalid format -> 400 Bad Request), not the tasks.md override text. Recommend updating tasks.md's override note before archive so future readers aren't misled — code and spec.md agree, only tasks.md's narrative is out of sync.

### SUGGESTION
1. `state.auditShowingAll` in `public/js/app.js` is set in `loadAuditLog()` (false) and `clearAuditFilters()` (true) but has no read consumer anywhere in app.js or index.html. It's currently dead state — harmless, but either wire it to UI (e.g., a "showing all history" badge) or remove it to avoid confusion later.
2. `lib/worldcup-sync.js` POLL_INTERVAL_MS changed from 60s to 10s in this commit — unrelated to issue #47, but confirmed intentional per user; not flagged as a defect, noted here for traceability only.

## Verification performed
- server.js: `recordAuditLog()` no longer slices/caps (`writeJson('audit-log.json', logs)`), confirms `audit-log-retention` spec.
- server.js: `GET /api/audit-log` implements omit->today, date=all->full history, invalid format->400, valid date->Bolivia-local filtered. Matches `audit-log-date-filtering` spec.md exactly (BOLIVIA_DATE_FORMATTER uses `Intl.DateTimeFormat('en-CA', {timeZone:'America/La_Paz'})`).
- lib/worldcup-sync.js: `recordAuditLog` calls and `SYNC_REQUEST_CONTEXT` fully removed; `grep` across server.js confirms `startWorldcupSync({ readJson, writeJson })` deps no longer includes `recordAuditLog`; all other `recordAuditLog` call sites in server.js (login, user CRUD, predictions, etc.) untouched.
- public/js/app.js: `loadAuditLog()` defaults date input to `todayBoliviaDate()` and fetches server-filtered data; `filteredAuditLogs()` only does username/action filtering (no date logic); `clearAuditFilters()` is async, clears inputs, sets `auditShowingAll=true`, fetches `date=all`. No dead/broken references found except the unused state flag noted above.
- `node --check server.js && node --check lib/worldcup-sync.js` -> both pass.
- `git diff main...HEAD --stat` scope matches the change (server.js, lib/worldcup-sync.js, public/js/app.js, openspec docs) plus the confirmed-intentional unrelated POLL_INTERVAL_MS edit.
- Doc corrections: proposal.md and specs/audit-log-date-filtering/spec.md no longer contain stale "omit=full history" wording; both reflect today-default/all-opt-out contract.

## Tasks vs code state
Tasks 1-7 in tasks.md marked [x] and verified to match code. Task 8 (manual browser verification checklist) remains [ ] — requires running app locally, not covered by static verification.
