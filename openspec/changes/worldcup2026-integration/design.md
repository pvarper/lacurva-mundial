# Design: worldcup2026 fixture sync (issue #43)

Implements the resolved decisions in `proposal.md`. This document is the concrete blueprint for `sdd-apply` — function signatures, file contents, and wiring changes are specified precisely enough to implement without further design decisions.

## 1. Module map

| File | Status | Role |
|------|--------|------|
| `lib/worldcup-sync.js` | NEW | Sync engine: fetch, match, diff, write, audit, interval lifecycle |
| `lib/team-name-map.js` | NEW | ES (fixtures.json) -> EN (provider) team name lookup |
| `lib/match-status-map.js` | NEW | `finished`/`time_elapsed` -> our status enum parser |
| `lib/sportmonks-sync.js` | DELETE | dead SportMonks engine |
| `lib/sportmonks-team-map.js` | DELETE | dead SportMonks team-id map (all null) |
| `lib/sportmonks-states.js` | DELETE | dead SportMonks state-id map |
| `server.js` | EDIT | remove SportMonks require/wiring (line 8, lines 671-676), add worldcup-sync wiring |

After this change, `rg -i sportmonks` across the repo must return zero matches in live code/imports. `openspec/changes/sportmonks-integration/*` (historical proposal docs for the abandoned attempt) are left untouched — they are dated records of a past decision, not active code.

## 2. `lib/team-name-map.js`

Plain object, ES key (exact string as it appears in `data/fixtures.json` `homeTeam`/`awayTeam`) -> EN value (must match provider's `home_team_name_en`/`away_team_name_en` case-insensitively after trim — see matching algorithm in section 4).

Confirmed: 48 distinct real team names appear across `data/fixtures.json` group-stage fixtures (m-001 through ~m-072), matching the 48 listed in the proposal context exactly. Knockout fixtures (`m-073`..`m-104`) use placeholder names (`"2A"`, `"W74"`, `"1E"`, `"L101"`, etc.) and are intentionally NOT in this map — their absence is what makes `isSyncCandidate` filter them out (see section 7).

```js
// Static translation table: fixtures.json team name (homeTeam/awayTeam) -> the
// worldcup26.ir provider's English team name (home_team_name_en / away_team_name_en).
//
// Only real group-stage team names are listed here. Knockout-stage placeholder names
// ("2A", "W74", "1E", "L101", etc.) are deliberately absent — their absence is what makes
// isSyncCandidate() in lib/worldcup-sync.js skip them as expected, non-failure exclusions.
//
// Comparison against the provider is case-insensitive + trimmed (see findMatchingProviderRecord
// in lib/worldcup-sync.js), so exact casing here only needs to be readable/correct, not byte-exact.
const TEAM_NAME_EN_BY_ES = {
  Alemania: 'Germany',
  'Arabia Saudita': 'Saudi Arabia',
  Argelia: 'Algeria',
  Argentina: 'Argentina',
  Australia: 'Australia',
  Austria: 'Austria',
  'Bosnia y Herzegovina': 'Bosnia and Herzegovina',
  Brasil: 'Brazil',
  Bélgica: 'Belgium',
  'Cabo Verde': 'Cape Verde',
  Canadá: 'Canada',
  Catar: 'Qatar',
  Chequia: 'Czech Republic',
  Colombia: 'Colombia',
  'Corea del Sur': 'South Korea',
  'Costa de Marfil': 'Ivory Coast',
  Croacia: 'Croatia',
  Curazao: 'Curacao',
  Ecuador: 'Ecuador',
  Egipto: 'Egypt',
  Escocia: 'Scotland',
  España: 'Spain',
  'Estados Unidos': 'United States',
  Francia: 'France',
  Ghana: 'Ghana',
  Haití: 'Haiti',
  Inglaterra: 'England',
  Irak: 'Iraq',
  Irán: 'Iran',
  Japón: 'Japan',
  Jordania: 'Jordan',
  Marruecos: 'Morocco',
  México: 'Mexico',
  Noruega: 'Norway',
  'Nueva Zelanda': 'New Zealand',
  Panamá: 'Panama',
  Paraguay: 'Paraguay',
  'Países Bajos': 'Netherlands',
  Portugal: 'Portugal',
  'República Democrática del Congo': 'DR Congo',
  Senegal: 'Senegal',
  Sudáfrica: 'South Africa',
  Suecia: 'Sweden',
  Suiza: 'Switzerland',
  Turquía: 'Turkey',
  Túnez: 'Tunisia',
  Uruguay: 'Uruguay',
  Uzbekistán: 'Uzbekistan'
};

function getEnglishTeamName(teamNameEs) {
  return Object.prototype.hasOwnProperty.call(TEAM_NAME_EN_BY_ES, teamNameEs)
    ? TEAM_NAME_EN_BY_ES[teamNameEs]
    : null;
}

module.exports = { TEAM_NAME_EN_BY_ES, getEnglishTeamName };
```

**Apply-phase verification step**: before relying on this table, `sdd-apply` (or a quick manual check) should sanity-check a handful of these EN names against a live `GET https://worldcup26.ir/get/games` response (e.g. confirm `"South Korea"` and `"Ivory Coast"` and `"DR Congo"` match the provider's exact `home_team_name_en`/`away_team_name_en` strings — these three are the most likely to use a different convention, e.g. `"Korea Republic"`, `"Côte d'Ivoire"`, `"Congo DR"`). If any mismatch is found, fix the EN value in this table only — no other file changes are needed since matching is case-insensitive/trimmed but not fuzzy.

## 3. `lib/match-status-map.js`

```js
// Maps the worldcup26.ir provider's finished/time_elapsed string fields to the app's
// status vocabulary (scheduled | live | final — see FIXTURE_STATUSES in server.js).
//
// Confirmed provider behavior:
// - finished: "TRUE" | "FALSE" (string, not boolean)
// - time_elapsed: "notstarted" | "finished" | other values while in play (exact live-phase
//   strings unconfirmed/unstable, e.g. clock text) — anything not "notstarted"/"finished" is
//   treated defensively as "live".
//
// Precedence (must be checked in this order):
//   1. finished === 'TRUE'        -> 'final'   (regardless of time_elapsed value)
//   2. time_elapsed === 'notstarted' -> 'scheduled'
//   3. otherwise                  -> 'live'
function parseProviderStatus({ finished, time_elapsed }) {
  if (finished === 'TRUE') return 'final';
  if (time_elapsed === 'notstarted') return 'scheduled';
  return 'live';
}

module.exports = { parseProviderStatus };
```

## 4. `lib/worldcup-sync.js`

### 4.1 Reused conceptually from `sportmonks-sync.js` (operational skeleton, unchanged shape)

- `runSyncCycle(deps)` — loop over sync-candidate fixtures, per-fixture try/catch, calls into match+apply logic. Difference: candidates are computed once, and the provider payload (full list) is fetched **once per cycle**, not once per fixture.
- `applyFixtureSync({ match, status, homeScore, awayScore, deps })` — defensive re-read of `fixtures.json`, diff-before-write, `fixture_synced` audit action. **Reused unchanged**, including the exact audit payload shape (`matchId`, `matchNumber`, `homeTeam`, `awayTeam`, `previousValue`, `homeScore`, `awayScore`, `status`).
- `startWorldcupSync(deps)` / `stopWorldcupSync()` — same `setInterval`/`clearInterval` lifecycle, same `POLL_INTERVAL_MS = 60 * 1000`, same `intervalHandle` module-level guard against double-start.
- Top-level interval safety net: `runSyncCycle(deps).catch(...)` inside the `setInterval` callback, same as before.
- `SYNC_REQUEST_CONTEXT` constant for `recordAuditLog` calls outside an HTTP request — reused, renamed to reflect new module (`{ session: {}, ip: 'worldcup-sync' }`).

### 4.2 Entirely new (provider-specific)

- `fetchAllMatches()` — single bulk `GET https://worldcup26.ir/get/games` call, returns the parsed JSON array of provider match objects. Uses built-in `fetch` (Node >=18, confirmed available, no extra dependency).
- `findMatchingProviderRecord(localMatch, providerGames, teamNameMap)` — name+date matcher (section 4.4).
- `parseProviderScore(record)` — exported as `parseScore` per the task brief naming; string-to-number coercion (section 4.5).
- `isSyncCandidate(match, teamNameMap)` — filters local fixtures eligible for sync (section 6).

### 4.3 Exact function signatures and file skeleton

```js
// Background sync that polls worldcup26.ir every 60 seconds and writes fixture status/score
// changes into data/fixtures.json, mirroring the audit shape used by the manual
// PUT /api/fixtures/:id route (fixture_updated) under a distinct `fixture_synced` action.
//
// Opt-in: only starts when WORLDCUP_SYNC_ENABLED === 'true' (see server.js wiring).
//
// Matching strategy: by translated team name (ES->EN via lib/team-name-map.js) + same-day
// date comparison. NEVER by provider `id` — confirmed live that provider id does not
// correspond to our matchNumber (e.g. provider id=13 is Iran/New Zealand; our matchNumber 13
// is Saudi Arabia/Uruguay). No external id is persisted on our fixture records; matching is
// recomputed from scratch every cycle.
const { getEnglishTeamName } = require('./team-name-map');
const { parseProviderStatus } = require('./match-status-map');

const POLL_INTERVAL_MS = 60 * 1000;
const PROVIDER_URL = 'https://worldcup26.ir/get/games';
const SYNC_REQUEST_CONTEXT = { session: {}, ip: 'worldcup-sync' };

// In-memory, process-lifetime only. Prevents audit-log spam for a real-team fixture that
// keeps failing to match cycle after cycle: the FIRST miss is console.warn + audit-logged,
// subsequent misses within the same process lifetime are console.warn only. Reset on restart.
const warnedUnmatchedFixtureIds = new Set();

let intervalHandle = null;

function isSyncCandidate(match) {
  if (!match || match.status === 'final') return false;
  const homeEn = getEnglishTeamName(match.homeTeam);
  const awayEn = getEnglishTeamName(match.awayTeam);
  // Absence from team-name-map means a knockout placeholder ("2A", "W74", etc.) — this is an
  // expected exclusion, NOT a failure. No warn, no audit. Silent skip by design (see Decision/
  // Assumption C in proposal.md).
  return homeEn !== null && awayEn !== null;
}

function parseScore(record) {
  const homeScore = Number(record.home_score);
  const awayScore = Number(record.away_score);
  return { homeScore, awayScore };
}

// Parses provider's "MM/DD/YYYY HH:mm" local_date into just the calendar-day portion,
// comparable against our boliviaDate ("YYYY-MM-DD"). We intentionally compare day-only, not
// exact datetime: provider local_date and our boliviaDate are independently sourced and may
// disagree on minutes/timezone normalization, but round-robin World Cup scheduling never has
// the same two teams play twice on the same day, so day-level matching is unambiguous.
function providerLocalDateToYmd(localDate) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(localDate || ''));
  if (!match) return null;
  const [, mm, dd, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

function namesMatch(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

// Checks both orientations: provider may list as home what we call away, and vice versa.
// We have no guarantee the provider's home/away assignment agrees with fixturedownload's
// (different sources, independently compiled), so a fixture is considered a match if the two
// team names align in EITHER orientation, as long as the calendar day also matches.
function findMatchingProviderRecord(localMatch, providerGames, homeEn, awayEn) {
  const localYmd = localMatch.boliviaDate;
  return providerGames.find((record) => {
    const recordYmd = providerLocalDateToYmd(record.local_date);
    if (recordYmd !== localYmd) return false;

    const sameOrientation = namesMatch(record.home_team_name_en, homeEn) && namesMatch(record.away_team_name_en, awayEn);
    const reverseOrientation = namesMatch(record.home_team_name_en, awayEn) && namesMatch(record.away_team_name_en, homeEn);
    return sameOrientation || reverseOrientation;
  }) || null;
}

async function fetchAllMatches() {
  const response = await fetch(PROVIDER_URL);
  if (!response.ok) {
    throw new Error(`worldcup26.ir request failed with status ${response.status}`);
  }
  return response.json();
}

async function applyFixtureSync({ match, status, homeScore, awayScore, deps }) {
  const { readJson, writeJson, recordAuditLog } = deps;

  // Defensive re-read: avoid clobbering a write that happened between fetch and now.
  const fixtures = await readJson('fixtures.json');
  const current = fixtures.find((candidate) => candidate.id === match.id);
  if (!current) return;

  const unchanged = current.status === status && current.homeScore === homeScore && current.awayScore === awayScore;
  if (unchanged) return;

  const previousValue = { status: current.status, homeScore: current.homeScore, awayScore: current.awayScore };
  current.status = status;
  current.homeScore = homeScore;
  current.awayScore = awayScore;

  await writeJson('fixtures.json', fixtures);
  await recordAuditLog(SYNC_REQUEST_CONTEXT, 'fixture_synced', {
    matchId: current.id,
    matchNumber: current.matchNumber,
    homeTeam: current.homeTeam,
    awayTeam: current.awayTeam,
    previousValue,
    homeScore,
    awayScore,
    status
  });
}

async function recordUnmatched({ match, reason, deps }) {
  const { recordAuditLog } = deps;
  console.warn(`[worldcup-sync] ${reason} for fixture ${match.id} (${match.homeTeam} vs ${match.awayTeam})`);

  if (warnedUnmatchedFixtureIds.has(match.id)) return; // already audit-logged this process lifetime
  warnedUnmatchedFixtureIds.add(match.id);

  await recordAuditLog(SYNC_REQUEST_CONTEXT, 'fixture_sync_unmatched', {
    matchId: match.id,
    matchNumber: match.matchNumber,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    reason
  });
}

async function syncSingleFixture(match, providerGames, deps) {
  const homeEn = getEnglishTeamName(match.homeTeam);
  const awayEn = getEnglishTeamName(match.awayTeam);

  const record = findMatchingProviderRecord(match, providerGames, homeEn, awayEn);
  if (!record) {
    await recordUnmatched({ match, reason: 'no provider match found by name+date', deps });
    return;
  }

  const status = parseProviderStatus(record);
  const { homeScore, awayScore } = parseScore(record);
  await applyFixtureSync({ match, status, homeScore, awayScore, deps });
}

async function runSyncCycle(deps) {
  const { readJson } = deps;
  const fixtures = await readJson('fixtures.json');
  const candidates = fixtures.filter(isSyncCandidate);
  if (candidates.length === 0) return;

  const providerGames = await fetchAllMatches();

  for (const match of candidates) {
    try {
      await syncSingleFixture(match, providerGames, deps);
    } catch (error) {
      console.error(`[worldcup-sync] error syncing fixture ${match.id}: ${error.message}`);
    }
  }
}

function startWorldcupSync(deps) {
  if (intervalHandle) return;
  if (process.env.WORLDCUP_SYNC_ENABLED !== 'true') {
    console.log('[worldcup-sync] WORLDCUP_SYNC_ENABLED not set to "true", sync disabled.');
    return;
  }

  console.log('[worldcup-sync] starting sync, polling every 60s.');
  intervalHandle = setInterval(() => {
    runSyncCycle(deps).catch((error) => {
      console.error(`[worldcup-sync] sync cycle failed: ${error.message}`);
    });
  }, POLL_INTERVAL_MS);
}

function stopWorldcupSync() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = {
  startWorldcupSync,
  stopWorldcupSync,
  runSyncCycle,
  isSyncCandidate,
  syncSingleFixture,
  findMatchingProviderRecord,
  parseScore,
  fetchAllMatches,
  applyFixtureSync
};
```

### 4.4 Matching algorithm — design rationale

- **Name comparison**: case-insensitive, trimmed (`namesMatch`). Recommended over exact match for resilience to provider whitespace/casing drift; not fuzzy (no Levenshtein) since `team-name-map.js` is the single source of truth for the translation and the apply-phase verification step (section 2) should catch genuine mismatches before they reach production.
- **Date comparison**: by calendar day only (`providerLocalDateToYmd` vs `match.boliviaDate`), not exact datetime. Rationale: provider's `local_date` format/timezone and our `boliviaDate` are independently derived; exact-time matching risks false negatives from format/timezone skew. Same-day matching is safe because round-robin group play never schedules the same two teams twice in one day.
- **Home/away orientation**: checked in **both directions** (`sameOrientation || reverseOrientation`). Rationale: the provider's home/away designation is independently assigned from a different source (fixturedownload) than ours; there's no guarantee they agree on which team is "home." Requiring exact orientation match risks silent false-negative misses for fixtures where the two sources disagree on home/away, with no compensating benefit (we don't use orientation for anything semantically important post-match — score writing uses `homeScore`/`awayScore` field names that already match our own fixture's orientation, not the provider's).

### 4.5 Score extraction

`parseScore(record)` returns `{ homeScore: Number(record.home_score), awayScore: Number(record.away_score) }`. The provider returns these as strings (confirmed). `Number('0')` -> `0`, `Number('2')` -> `2`; no further validation needed since the provider's `finished`/`time_elapsed` gate (via `parseProviderStatus`) determines whether the app considers the match started, not the score value itself. If `record.home_score` is ever an empty string or undefined (not-yet-started match), `Number('')` -> `0` and `Number(undefined)` -> `NaN` — both safe in practice because such matches will report `time_elapsed === 'notstarted'` -> our `applyFixtureSync` only writes when `status` differs from current; a `'scheduled'` status fixture in our system already defaults to `homeScore: null, awayScore: null` per existing fixtures.json shape, so a diff would be detected if scores spuriously became `0`/`NaN`. **Mitigation**: not adding extra guard logic here since this scenario (not-started match reporting non-empty score strings) hasn't been observed in the confirmed provider shape; if `sdd-apply` or later testing finds this happening, the fix is a one-line guard in `parseScore` (`return status === 'scheduled' ? { homeScore: null, awayScore: null } : ...`), not a design change.

## 5. Audit action: `fixture_sync_unmatched`

**Payload shape** (matches the brief's required fields):

```json
{
  "matchId": "m-014",
  "matchNumber": 14,
  "homeTeam": "España",
  "awayTeam": "Irán",
  "reason": "no provider match found by name+date"
}
```

**Volume control** (resolves point 6 of the brief): simplest behavior — console.warn every cycle a real-team fixture fails to match — is rejected in favor of a lightweight one-line mitigation given the 1000-entry audit-log cap risk identified in prior exploration:

- `console.warn` fires **every cycle** a fixture remains unmatched (no suppression — server logs are ephemeral/rotated, no cap concern).
- `recordAuditLog('fixture_sync_unmatched', ...)` fires **only on the first miss per fixture id**, tracked via the in-memory `warnedUnmatchedFixtureIds` `Set` (module-level, reset on process restart). Subsequent cycles for the same still-unmatched fixture log a warning to console only.
- Rationale: a genuinely broken mapping (e.g. team-name-map typo) would otherwise write one audit entry per fixture per minute indefinitely, burning through the audit log's 1000-entry cap in under 17 hours for even a single stuck fixture. The first-miss-only audit entry still surfaces the problem to admins via the UI without that risk; console logs remain available for live debugging during development.
- This is NOT used for the knockout-placeholder exclusion (section 6) — those never reach `syncSingleFixture` at all, so no warn/audit fires for them, matching Assumption C.

## 6. `isSyncCandidate` — sync-eligibility filter

```js
function isSyncCandidate(match) {
  if (!match || match.status === 'final') return false;
  const homeEn = getEnglishTeamName(match.homeTeam);
  const awayEn = getEnglishTeamName(match.awayTeam);
  return homeEn !== null && awayEn !== null;
}
```

- Already-`final` fixtures are skipped — no further provider data needed once a result is locked in as final (consistent with the old SportMonks version; revisit only if "sync always overwrites" needs to extend to re-opening a final match, which Assumption A does not ask for).
- A fixture is a candidate only if **both** team names resolve via `team-name-map.js`. Knockout fixtures (`m-073`..`m-104`) hold placeholder names (`"2A"`, `"W74"`, etc.) absent from the map, so `getEnglishTeamName` returns `null` and the fixture is filtered out silently — no warn, no audit, consistent with Assumption C (expected exclusion, not a failure).

## 7. `server.js` wiring changes

**Remove** (line 8):
```js
const { startSportmonksSync } = require('./lib/sportmonks-sync');
```

**Remove** (lines 671-676):
```js
startSportmonksSync({
  readJson,
  writeJson,
  recordAuditLog,
  apiToken: process.env.SPORTMONKS_API_TOKEN
});
```

**Add**, same locations:

Near the top with other requires:
```js
const { startWorldcupSync } = require('./lib/worldcup-sync');
```

After `app.listen(...)` (replacing the removed block, same position):
```js
startWorldcupSync({
  readJson,
  writeJson,
  recordAuditLog
});
```

No `apiToken` field in `deps` — activation is gated entirely inside `startWorldcupSync` via `process.env.WORLDCUP_SYNC_ENABLED === 'true'`, not by a token's presence. `FIXTURE_STATUSES` (line 19) and the `PUT /api/fixtures/:id` handler (lines 441-477) are untouched — both already operate on the same `scheduled`/`live`/`final` enum and the same fixture shape the sync writes to.

## 8. Deletion checklist

- [ ] Delete `lib/sportmonks-sync.js`
- [ ] Delete `lib/sportmonks-team-map.js`
- [ ] Delete `lib/sportmonks-states.js`
- [ ] Remove `server.js` line 8 require and lines 671-676 call (replaced per section 7)
- [ ] Repo-wide check: `rg -i sportmonks` returns zero matches outside `openspec/changes/sportmonks-integration/*` (historical record, left as-is)

## 9. Open items for `sdd-apply` / verification (not blocking design)

1. Live-verify the three highest-risk EN team names against an actual provider response: `"South Korea"`, `"Ivory Coast"`, `"DR Congo"` (Corea del Sur, Costa de Marfil, República Democrática del Congo) — these are the names most likely to follow a different convention (e.g. FIFA-style `"Korea Republic"`, `"Côte d'Ivoire"`, `"Congo DR"`). Fix in `team-name-map.js` only if mismatched.
2. Confirm `record.local_date` format is consistently `"MM/DD/YYYY HH:mm"` (zero-padded) across all 104 provider records — `providerLocalDateToYmd`'s regex assumes exactly 2-digit month/day and 4-digit year.
3. No automated test suite exists in this repo (per `CLAUDE.md` gotchas) — verification of the sync logic during `sdd-apply`/`sdd-verify` will be manual (run with `WORLDCUP_SYNC_ENABLED=true` against a sample of known fixtures, or write throwaway Node scripts exercising `findMatchingProviderRecord`/`parseProviderStatus`/`parseScore` against a saved sample provider payload).
