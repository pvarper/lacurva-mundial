// Background sync that polls worldcup26.ir on a configurable interval and writes fixture
// status/score changes into data/fixtures.json, mirroring the audit shape used by the manual
// PUT /api/fixtures/:id route (fixture_updated) under a distinct `fixture_synced` action.
//
// Settings-driven: enabled state and poll interval come from data/settings.json's
// `worldcupSync` field, passed in by the caller as `syncSettings` (see server.js wiring).
//
// Matching strategy: by translated team name (ES->EN via lib/team-name-map.js) + same-day
// date comparison. NEVER by provider `id` — confirmed live that provider id does not
// correspond to our matchNumber (e.g. provider id=13 is Iran/New Zealand; our matchNumber 13
// is Saudi Arabia/Uruguay). No external id is persisted on our fixture records; matching is
// recomputed from scratch every cycle.
const { getEnglishTeamName } = require('./team-name-map');
const { parseProviderStatus } = require('./match-status-map');
const { propagateKnockoutWinner } = require('./knockout-propagation');

const PROVIDER_URL = 'https://worldcup26.ir/get/games';

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

// Parses provider's "MM/DD/YYYY HH:mm" local_date into a Date (UTC midnight of that
// calendar day) so it can be diffed against our boliviaDate.
function providerLocalDateToUtcDate(localDate) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(localDate || ''));
  if (!match) return null;
  const [, mm, dd, yyyy] = match;
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`);
}

// provider local_date is stadium-local time; our boliviaDate is Bolivia-local time. These are
// different timezones, so matches kicking off near midnight in either timezone can land on
// different calendar days (confirmed live: 4/72 fixtures off by exactly one day at the
// boundary). We tolerate a 1-day difference rather than requiring an exact match — team-name
// matching (both orientations) is already unique per fixture in round-robin scheduling, so a
// loose date check is just a sanity tie-breaker, not the primary matching signal.
const DATE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

function datesWithinTolerance(localYmd, providerLocalDate) {
  const localDate = new Date(`${localYmd}T00:00:00.000Z`);
  const providerDate = providerLocalDateToUtcDate(providerLocalDate);
  if (Number.isNaN(localDate.getTime()) || !providerDate || Number.isNaN(providerDate.getTime())) return false;
  return Math.abs(localDate.getTime() - providerDate.getTime()) <= DATE_TOLERANCE_MS;
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
    if (!datesWithinTolerance(localYmd, record.local_date)) return false;

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
  const { readJson, writeJson } = deps;

  // Defensive re-read: avoid clobbering a write that happened between fetch and now.
  const fixtures = await readJson('fixtures.json');
  const current = fixtures.find((candidate) => candidate.id === match.id);
  if (!current) return;

  // Scheduled (not-started) matches must never carry a score. The provider sends "0"
  // placeholders for not-yet-started matches; parseScore() turns that into a real 0,
  // indistinguishable from an actual 0-0 result. Force null here, at the single
  // persistence decision point, so no call path can bypass it.
  if (status === 'scheduled') {
    homeScore = null;
    awayScore = null;
  }

  const unchanged = current.status === status && current.homeScore === homeScore && current.awayScore === awayScore;
  if (unchanged) return;

  current.status = status;
  current.homeScore = homeScore;
  current.awayScore = awayScore;
  // Mirrors PUT /api/fixtures/:id: a non-draw knockout finalisation from
  // the provider resolves the next-round slot placeholder (e.g. "W74") in
  // the same write. Draws stay no-ops until an admin sets advancer manually.
  propagateKnockoutWinner(fixtures, current);

  await writeJson('fixtures.json', fixtures);
}

async function recordUnmatched({ match, reason }) {
  console.warn(`[worldcup-sync] ${reason} for fixture ${match.id} (${match.homeTeam} vs ${match.awayTeam})`);

  if (warnedUnmatchedFixtureIds.has(match.id)) return; // already warned this process lifetime
  warnedUnmatchedFixtureIds.add(match.id);
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
