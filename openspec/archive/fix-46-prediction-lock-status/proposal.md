# Proposal: Fix prediction lock to respect match status

## Problem

`isPredictionLocked(match)` in `server.js:210-212` only compares `match.date`
against `Date.now()` with a 60-second pre-kickoff buffer. It ignores
`match.status` entirely. When a match transitions to `'live'` or `'final'`
(via the worldcup-sync background poll or an admin manual update through
`PUT /api/fixtures/:id`), predictions for that match remain editable until
the date-based buffer happens to trigger — which may never align with the
real match state if `match.date` is stale or unset correctly. Users can
submit or change predictions for matches that are already in progress or
finished, undermining the integrity of the scoring system.

## Scope

**In scope:**
- Update `isPredictionLocked(match)` so a match is locked when
  `match.status !== 'scheduled'` (i.e., status is `'live'` or `'final'`),
  OR the existing date-buffer condition (`match.date - now <= PREDICTION_LOCK_MS`)
  is true.
- No changes to the 4 call sites (`GET /api/fixtures`, `PUT /api/fixtures/:id`,
  `GET /api/predictions`, `POST /api/predictions`) — all consume the boolean
  return value as-is.

**Out of scope:**
- Frontend changes (frontend only reads the `locked` field and the 423
  response; no independent lock computation exists there).
- New fixture status values (cancelled/postponed) — only `scheduled`,
  `live`, `final` exist today.
- Audit logging changes (tracked separately as issue #47).
- Data retention changes.

## Approach

Change the function body to a logical OR of the status check and the
existing date check:

```js
function isPredictionLocked(match) {
  return match.status !== 'scheduled' ||
    new Date(match.date).getTime() - Date.now() <= PREDICTION_LOCK_MS;
}
```

If an admin manually reverts a match's status back to `'scheduled'` via
`PUT /api/fixtures/:id`, predictions re-open automatically — consistent
with the existing admin override behavior for that endpoint. No additional
safeguards are added for this case in this change.

## Acceptance Criteria

- A match with `status: 'live'` is locked for predictions regardless of
  `match.date`.
- A match with `status: 'final'` is locked for predictions regardless of
  `match.date`.
- A match with `status: 'scheduled'` and a kickoff time more than 60
  seconds away remains unlocked (unchanged behavior).
- A match with `status: 'scheduled'` and a kickoff time within 60 seconds
  (or in the past) is locked (unchanged behavior).
- `POST /api/predictions` returns 423 for any match where
  `isPredictionLocked` is true.
- No frontend files are modified.
- `node --check server.js` passes.
