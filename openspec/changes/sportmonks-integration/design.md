# Design: SportMonks Integration (Issue #43)

Status: Draft (implementation blueprint for sdd-tasks / sdd-apply)
Depends on: proposal (`sdd/sportmonks-integration/proposal`)

## 1. New Files

### `lib/sportmonks-teams.js`

Plain object mapping `nombreLocal` (exact string as used in `data/fixtures.json` `homeTeam`/`awayTeam` fields) to the SportMonks numeric team id.

```js
// lib/sportmonks-teams.js
// Static translation table: fixtures.json team name -> SportMonks team id.
// Resolved once per tournament. Knockout placeholder names ("2A", "W74", etc.)
// are intentionally absent — their absence is what marks them as unresolved.
module.exports = {
  'México': 1234,        // placeholder values — must be filled with real
  'Sudáfrica': 5678,      // SportMonks team ids during apply, via SportMonks
  'Corea del Sur': 9012,  // /football/teams search endpoint or admin docs.
  'Chequia': 3456
  // ... ~32-48 entries total, one per group-stage team
};
```

Implementation note for apply: do NOT invent ids. Resolve real SportMonks team ids per country (e.g. via `GET /football/teams?search={name}` or SportMonks's static country/team reference) and hardcode them here once confirmed. This file has zero logic, only data, so it is trivially testable in isolation (assert known team names resolve to expected ids, assert placeholder names are absent).

### `lib/sportmonks-states.js`

Plain object mapping SportMonks fixture `state_id` (or `state.short_name`, whichever proves more stable — see Section 3) to the app's internal status string (`'scheduled' | 'live' | 'final'`).

```js
// lib/sportmonks-states.js
// Maps SportMonks fixture state identifiers to this app's FIXTURE_STATUSES.
// Values below are PLACEHOLDERS — must be confirmed against SportMonks's
// core /football/states reference endpoint (or include=state on a sample
// fixture) before this module is used, then replaced with real ids.
const STATE_ID_TO_STATUS = {
  1: 'scheduled',   // e.g. NS - Not Started
  2: 'live',        // e.g. LIVE / INPLAY
  5: 'final'        // e.g. FT - Full Time
  // ... fill remaining live sub-states (HT, ET, PEN_LIVE, etc.) as 'live'
  // and finished sub-states (FT_PEN, AET, etc.) as 'final'
};

function mapStateIdToStatus(stateId) {
  return STATE_ID_TO_STATUS[stateId] || null; // null = unknown/unmapped state, sync skips this fixture
}

module.exports = { mapStateIdToStatus, STATE_ID_TO_STATUS };
```

Implementation note for apply: call SportMonks's `GET /football/states` once during a spike/dev session (or inspect `include=state` on a couple of historical fixtures) to get the authoritative `id -> short_name` list, then hardcode every relevant id here. Treat any state id not present in the table as "unknown" — `mapStateIdToStatus` returns `null`, and the sync loop must skip writing for that fixture (log a warning, do not crash, do not guess).

### `lib/sportmonks-sync.js`

The sync engine. Exports a `startSportmonksSync(deps)` function and a `stopSportmonksSync()` function (so server startup/shutdown can control the interval handle). All HTTP/IO is injected via `deps` so apply can unit test the diff/audit logic without hitting the real API or filesystem.

```js
// lib/sportmonks-sync.js
const SPORTMONKS_BASE_URL = 'https://api.sportmonks.com/v3';
const POLL_INTERVAL_MS = 60 * 1000;

const teamIds = require('./sportmonks-teams');
const { mapStateIdToStatus } = require('./sportmonks-states');

let intervalHandle = null;

/**
 * @param {object} deps
 * @param {Function} deps.readJson - async (fileName) => data, same as server.js readJson
 * @param {Function} deps.writeJson - async (fileName, data) => void, same as server.js writeJson
 * @param {Function} deps.recordAuditLog - async (req, action, detail) => void, same as server.js
 * @param {string} deps.apiToken - SportMonks API token (process.env.SPORTMONKS_API_TOKEN)
 * @param {Function} [deps.fetchImpl] - injectable fetch, defaults to global fetch
 */
function startSportmonksSync(deps) {
  if (intervalHandle) return intervalHandle; // idempotent guard
  intervalHandle = setInterval(() => {
    runSyncCycle(deps).catch((error) => {
      console.error('SportMonks sync cycle failed:', error.message);
    });
  }, POLL_INTERVAL_MS);
  return intervalHandle;
}

function stopSportmonksSync() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

async function runSyncCycle(deps) {
  const fixtures = await deps.readJson('fixtures.json');
  const candidates = fixtures.filter(isSyncCandidate);

  for (const match of candidates) {
    try {
      await syncSingleFixture(match, deps);
    } catch (error) {
      // Per-fixture isolation: one failing match must not abort the cycle.
      console.error(`SportMonks sync failed for match ${match.id} (${match.homeTeam} vs ${match.awayTeam}):`, error.message);
    }
  }
}

function isSyncCandidate(match) {
  if (match.status === 'final') return false; // already final, nothing to sync
  const homeTeamId = teamIds[match.homeTeam];
  const awayTeamId = teamIds[match.awayTeam];
  if (!homeTeamId || !awayTeamId) return false; // placeholder team name ("2A", "W74") -> not yet resolved, skip

  const matchDate = new Date(match.date);
  const now = new Date();
  const oneDayMs = 24 * 60 * 60 * 1000;
  // Poll only matches that are today or in the past (up to a small grace
  // window for late-finishing results); skip far-future matches to avoid
  // wasted calls and rate-limit pressure.
  return matchDate.getTime() <= now.getTime() + oneDayMs;
}

async function syncSingleFixture(match, deps) {
  const fetchImpl = deps.fetchImpl || fetch;
  const homeTeamId = teamIds[match.homeTeam];
  const dateStr = match.boliviaDate; // YYYY-MM-DD, already present on fixture

  const url = `${SPORTMONKS_BASE_URL}/football/fixtures/teams/${homeTeamId}/between/${dateStr}/${dateStr}?include=scores;participants`;
  const response = await fetchImpl(url, {
    headers: { Authorization: deps.apiToken }
  });

  if (!response.ok) {
    throw new Error(`SportMonks API returned ${response.status} for match ${match.id}`);
  }

  const payload = await response.json();
  const remoteFixture = pickMatchingFixture(payload.data, match);
  if (!remoteFixture) return; // no matching remote fixture found this cycle, skip silently

  const status = mapStateIdToStatus(remoteFixture.state_id);
  if (!status) return; // unmapped state id, skip (logged at mapping layer if needed)

  const { homeScore, awayScore } = extractCurrentScore(remoteFixture, match);

  const changed = status !== match.status || homeScore !== match.homeScore || awayScore !== match.awayScore;
  if (!changed) return;

  await applyFixtureSync(match, { status, homeScore, awayScore }, deps);
}

// Sanity check: confirm the remote fixture's participants match both
// expected teams (home AND away), since the query is scoped only by the
// home team's id + date. Guards against the (unlikely) case of the home
// team playing two matches with overlapping date windows.
function pickMatchingFixture(remoteFixtures, match) {
  const awayTeamId = teamIds[match.awayTeam];
  return (remoteFixtures || []).find((remote) => {
    const participantIds = (remote.participants || []).map((p) => p.id);
    return participantIds.includes(awayTeamId);
  }) || null;
}

// SportMonks fixtures expose a `scores` array with multiple entries per
// period (1ST_HALF, 2ND_HALF, ET, PEN, CURRENT, etc.), each tagged by
// `description` and split by `score.participant` (home/away). The
// authoritative "current/final" score to persist is the entry with
// description === 'CURRENT' while the match is in progress or finished
// normally; for matches decided in extra time/penalties, SportMonks still
// keeps 'CURRENT' updated as the running total, so CURRENT is used
// unconditionally as the single source of truth for homeScore/awayScore.
function extractCurrentScore(remoteFixture, match) {
  const currentEntries = (remoteFixture.scores || []).filter((entry) => entry.description === 'CURRENT');
  const homeEntry = currentEntries.find((entry) => entry.score?.participant === 'home');
  const awayEntry = currentEntries.find((entry) => entry.score?.participant === 'away');

  return {
    homeScore: homeEntry ? homeEntry.score.goals : match.homeScore,
    awayScore: awayEntry ? awayEntry.score.goals : match.awayScore
  };
}

async function applyFixtureSync(match, nextValue, deps) {
  const fixtures = await deps.readJson('fixtures.json');
  const target = fixtures.find((candidate) => candidate.id === match.id);
  if (!target) return; // fixture removed since cycle started, defensive guard

  const previousValue = { status: target.status, homeScore: target.homeScore, awayScore: target.awayScore };
  target.status = nextValue.status;
  target.homeScore = nextValue.homeScore;
  target.awayScore = nextValue.awayScore;

  await deps.writeJson('fixtures.json', fixtures);
  await deps.recordAuditLog(
    { session: {}, ip: 'sportmonks-sync' }, // synthetic req-like object, no authenticated user
    'fixture_synced',
    {
      matchId: target.id,
      matchNumber: target.matchNumber,
      homeTeam: target.homeTeam,
      awayTeam: target.awayTeam,
      previousValue,
      homeScore: nextValue.homeScore,
      awayScore: nextValue.awayScore,
      status: nextValue.status
    }
  );
}

module.exports = {
  startSportmonksSync,
  stopSportmonksSync,
  // exported for unit testing in isolation:
  isSyncCandidate,
  extractCurrentScore,
  pickMatchingFixture
};
```

## 2. Wiring in `server.js`

Add near the top, with the other `require`s (after line 7):

```js
const { startSportmonksSync } = require('./lib/sportmonks-sync');
```

Add after `app.listen(...)` at the bottom (current lines 666-668), so the HTTP server is already accepting connections before the sync loop starts, and the interval handle is reachable for graceful shutdown:

```js
app.listen(PORT, () => {
  console.log(`La Curva Mundial running at http://localhost:${PORT}`);
});

if (process.env.SPORTMONKS_API_TOKEN) {
  startSportmonksSync({
    readJson,
    writeJson,
    recordAuditLog,
    apiToken: process.env.SPORTMONKS_API_TOKEN
  });
  console.log('SportMonks sync started (60s interval).');
} else {
  console.warn('SPORTMONKS_API_TOKEN not set — SportMonks sync disabled, manual score entry only.');
}
```

This mirrors the existing `SESSION_SECRET` convention (`process.env.X`, no dotenv). Sync is opt-in: if the token is absent, the server runs exactly as it does today, with `PUT /api/fixtures/:id` as the only path to update scores. No `dotenv` is introduced — the existing project already relies on the hosting platform/shell to inject env vars (see `SESSION_SECRET`), so adding a new dependency for one more variable is not justified.

## 3. State Mapping Resolution Process (for apply)

`lib/sportmonks-states.js` ships with placeholder ids and a clear comment block. Before this module can be trusted, apply must:

1. Call `GET /football/states` (SportMonks core endpoint) with the configured token, or alternatively call a fixture endpoint with `include=state` for a handful of known past/future fixtures.
2. Record the full `id -> name/short_name` table returned.
3. Replace the placeholder `STATE_ID_TO_STATUS` object with the real ids, classifying every "not started" variant as `'scheduled'`, every in-progress variant (1st half, half-time, 2nd half, extra time, penalties live) as `'live'`, and every finished variant (full time, after extra time, after penalties, finished) as `'final'`. Postponed/cancelled/abandoned states should map to `null` (sync skips, admin handles manually via PUT) since `FIXTURE_STATUSES` in `server.js` does not have an equivalent.
4. Do not guess numeric ids in code; this design intentionally leaves them as TODOs to avoid persisting wrong data silently.

## 4. Score Extraction (confirmed authoritative source)

SportMonks's fixture `scores` array contains one entry per scoring snapshot (`1ST_HALF`, `2ND_HALF`, `ET`, `PEN`, `CURRENT`, etc.), each split into a `home` and `away` participant entry. **`description === 'CURRENT'`** is the authoritative running/final score and is used unconditionally — see `extractCurrentScore` above. This avoids needing to special-case extra-time/penalty matches, since SportMonks keeps `CURRENT` synced to the latest total regardless of period.

If a `CURRENT` entry for a given side is missing in a particular API response (transient/incomplete data), `extractCurrentScore` falls back to the existing `match.homeScore`/`match.awayScore` rather than writing `null`/`undefined` — this prevents a malformed response from blanking out an already-known score.

## 5. Diffing Logic

`syncSingleFixture` always reads the fresh `match` status/scores from `fixtures.json` at the top of `runSyncCycle` (one read per cycle, not per fixture, since the file is small and shared across the loop). The fetched `(status, homeScore, awayScore)` triple is compared field-by-field against the current fixture object:

- All three identical → no write, no audit log, cycle moves to the next fixture (this is the common case on every 60s tick for a match still `scheduled` with no scores yet).
- Any field differs → `applyFixtureSync` re-reads `fixtures.json` (defensive re-read, in case a concurrent `PUT /api/fixtures/:id` or a previous fixture's sync write happened earlier in the same cycle), mutates the target fixture, writes via the existing `writeJson` (same temp-file-then-rename pattern, same write-lock map keyed by filename — no changes needed to `writeJson` itself), and logs `fixture_synced` with the same `previousValue` diff shape as `fixture_updated`.

## 6. Audit Action: `fixture_synced`

New, distinct from `fixture_updated`. Logged only when the cycle's diff check finds a change (Section 5) — not on every poll, not when status/scores are unchanged. Payload shape intentionally mirrors the existing `fixture_updated` handler (`matchId`, `matchNumber`, `homeTeam`, `awayTeam`, `previousValue`, `homeScore`, `awayScore`, `status`) so existing audit-log UI rendering/filtering can treat both actions uniformly without UI changes — `recordAuditLog`'s `req` param is given a synthetic object (`{ session: {}, ip: 'sportmonks-sync' }`) since there is no authenticated HTTP request; `recordAuditLog` already defends against missing `req.session.user` (line 131-133 in `server.js`), so `userId`/`username`/`role` will correctly resolve to `null`.

## 7. Error Handling

- `runSyncCycle` wraps each fixture's sync in its own try/catch (see `lib/sportmonks-sync.js` above) — one failing SportMonks call (network error, 429, 500, malformed payload) logs to `console.error` and the loop continues to the next fixture in the same cycle.
- `startSportmonksSync`'s `setInterval` callback wraps the entire `runSyncCycle` call in a `.catch` as a second safety net (covers errors in the `readJson('fixtures.json')` call itself, which is shared across all fixtures in the cycle).
- No retries within a cycle: a failed fixture simply gets picked up again on the next 60s tick, which is sufficient given the cadence.

## 8. Rate Limit Estimate

`isSyncCandidate` filters to: not `final`, has a resolved team-id mapping (excludes knockout placeholders), and `date` is today or earlier (with a 1-day grace window for late results). During the group stage's busiest days, the 2026 World Cup schedules at most 4 matches per day across all 4 simultaneous time slots common in modern World Cups. Accounting for the previous day's matches still pending a `final` transition (e.g. just-finished matches not yet confirmed), a realistic peak is **4-8 fixtures per 60s cycle**, each requiring exactly 1 SportMonks API call. That is at most ~8 requests/minute, well under typical SportMonks plan rate limits (commonly 60-3000 requests/minute depending on tier). No batching or backoff logic is required at this volume; if SportMonks returns a 429, the existing per-fixture try/catch already prevents cascading failures, and the next cycle retries naturally.

## 9. Open Items for Apply (explicitly deferred, not invented here)

- Real SportMonks team ids for `lib/sportmonks-teams.js` (32-48 entries).
- Real SportMonks `state_id` values for `lib/sportmonks-states.js`.
- Confirming the exact SportMonks v3 endpoint path/version prefix (`/v3/football/...` assumed per proposal's API shape; verify against current SportMonks docs/account plan during apply, since endpoint availability depends on subscription tier).
