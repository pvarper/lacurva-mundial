# Design: Audit Log Retention and Daily View (#47)

## Technical Approach

Three independent, low-risk edits in existing functions/endpoints. No new modules, no schema changes. The shared technique (Bolivia-local date via `Intl.DateTimeFormat('en-CA', {timeZone:'America/La_Paz'})`) already exists client-side (`app.js:95-97`, `app.js:895-900`) and is mirrored server-side rather than abstracted into a shared util, since `server.js` and `app.js` don't currently share a module.

## Architecture Decisions

### Decision: Uncapped persistence
**Choice**: Drop `.slice(-1000)` at `server.js:139`; write the full `logs` array.
**Alternatives considered**: Rotate to a secondary archive file; cap with higher threshold.
**Rationale**: Proposal scope explicitly excludes rotation/archival. Existing `writeJson` mutex already serializes writes safely. Minimal change satisfies the compliance requirement now; rotation is a separate future change if file size becomes a problem.

### Decision: `date` query param semantics — default-vs-explicit-all
**Choice**: `GET /api/audit-log` computes "today" in Bolivia time *server-side* (not trusted from client absence). Resolution: if `req.query.date === 'all'` → return all logs reversed (admin opt-out, preserves today's "clear filter" UX). Otherwise, validate `date` matches `/^\d{4}-\d{2}-\d{2}$/`; if invalid or absent, default to server-computed `todayBoliviaDate()` equivalent. Filter logs to entries whose Bolivia-local date matches.
**Alternatives considered**: (a) Trust client always sends `date`, default-absent = all (proposal's literal text) — rejected because a stale/cached frontend or direct API call without the param would silently return the entire unbounded log, defeating the bandwidth/CPU goal that motivated this change. (b) Require `date` always, no default — rejected, breaks robustness for any caller that omits it.
**Rationale**: Defaulting absence to "today" server-side is strictly safer and matches the stated intent ("reduce unbounded growth in default requests"); `date=all` gives admins an explicit, discoverable way to retain full-history view without relying on client-side trust.
**Deviation from proposal**: proposal.md line 36 says "omitting `date` returns full history" — this design intentionally diverges (default = today, `all` = full history) per the task's explicit design directive. Flagged in Open Questions for confirmation before tasks/apply.

### Decision: Frontend date param wiring
**Choice**: `loadAuditLog()` reads `elements.auditDateFilter.value`; if empty, set the input's value to `todayBoliviaDate()` first (mirrors `loadPredictions()` pattern), then call `api('/api/audit-log?date=' + value)`. The "clear filter" UI action (clicking to empty the date field) sends `date=all` explicitly rather than omitting the param.
**Alternatives considered**: Keep `filteredAuditLogs()` doing date filtering client-side as a fallback safety net.
**Rationale**: Removing client-side date filtering eliminates the original bandwidth waste this change targets. User/action filters stay client-side per proposal (out of scope to change).

### Decision: Sync log removal — deps wiring cleanup
**Choice**: Delete both `recordAuditLog(...)` calls in `lib/worldcup-sync.js` (`applyFixtureSync` ~line 112, `recordUnmatched` ~line 131). Remove `recordAuditLog` from the destructuring in `applyFixtureSync` (line 96) and from `recordUnmatched` (line 125). Remove the `recordAuditLog` property from the `deps` object passed in `server.js`'s `startWorldcupSync({...})` call (~line 675), since after this change no function in the sync module's call chain (`runSyncCycle` → `syncSingleFixture` → `applyFixtureSync`/`recordUnmatched`) uses it.
**Alternatives considered**: Leave `recordAuditLog` wired into `deps` "in case future use needs it" (proposal's stated fallback).
**Rationale**: Project convention favors minimal surface; dead parameters invite confusion about whether sync still logs. Removing now-unused wiring is mechanical and low-risk; re-adding later is trivial when actually needed.

## Data Flow

    Browser (auditView opened)
        │ loadAuditLog()
        ▼
    GET /api/audit-log?date=<today|all>
        │
        ▼
    server.js: validate date param → compute Bolivia "today" if absent/invalid
        │
        ▼
    readAuditLogs() → filter by Bolivia-local date (unless date=all) → reverse
        │
        ▼
    JSON response → state.auditLogs → renderAuditLog() (client applies user/action filters only)

    Sync flow (unaffected by audit log, after this change):
    runSyncCycle → syncSingleFixture → applyFixtureSync / recordUnmatched
        (no recordAuditLog call; console.warn unchanged in recordUnmatched)

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `server.js` | Modify | `recordAuditLog()` (~126-143): drop `.slice(-1000)`. `GET /api/audit-log` (~322-325): add date param parsing/validation/filtering, default-to-today logic, `date=all` opt-out. `startWorldcupSync({...})` (~672-676): remove `recordAuditLog` from deps object. |
| `lib/worldcup-sync.js` | Modify | Remove `recordAuditLog` calls and destructured references in `applyFixtureSync` (~96, ~112) and `recordUnmatched` (~125, ~131). |
| `public/js/app.js` | Modify | `loadAuditLog()` (~885-888): default date input to `todayBoliviaDate()`, pass `date` query param. `filteredAuditLogs()` (~890-906): remove date-matching logic; keep user/action filters. Date-filter "clear" UX sends `date=all`. |

## Interfaces / Contracts

```
GET /api/audit-log?date=<YYYY-MM-DD|all>   (requireAdmin)

date omitted or invalid format → defaults to today (America/La_Paz, server-computed)
date=all                        → returns full history, reversed (newest first)
date=YYYY-MM-DD                 → returns entries matching that Bolivia-local day, reversed
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit/manual | `recordAuditLog` no longer truncates | Push >1000 entries, confirm file retains all |
| Integration | `/api/audit-log` date filtering | curl/fetch with no param (= today), `date=all`, valid date, invalid date string |
| Integration | Sync no longer logs | Run sync cycle locally, confirm no `fixture_synced`/`fixture_sync_unmatched` entries appear |
| Manual | Bitácora UI | Open auditView, confirm defaults to today; clear filter shows all; user/action filters still narrow results |
| Static | Syntax | `node --check server.js`, `node --check lib/worldcup-sync.js` |

## Migration / Rollout

No migration required. `data/audit-log.json` already contains valid entries; removing the cap and adding query filtering are backward compatible with existing data.

## Open Questions

- [ ] Confirm the "default absent date to today, `all` as opt-out" semantics (this design) over the proposal's literal "absent = full history" — recommend confirming with stakeholder before sdd-tasks, since it changes documented acceptance criteria language even though intent is preserved.
