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
  // expected exclusion, NOT a failure. No warn, no audit. Silent skip by design.
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
  const payload = await response.json();
  // Confirmed live: the provider wraps the match list in a `games` envelope
  // (`{ "games": [...] }`), it does not return a bare array.
  return Array.isArray(payload?.games) ? payload.games : [];
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
