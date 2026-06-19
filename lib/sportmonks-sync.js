// Background sync that polls SportMonks every 60 seconds and writes fixture status/score
// changes into data/fixtures.json, mirroring the audit shape used by the manual
// PUT /api/fixtures/:id route (fixture_updated) under a distinct `fixture_synced` action.
//
// Opt-in: only starts when SPORTMONKS_API_TOKEN is set (see server.js wiring).
//
// NOTE: as of this implementation, lib/sportmonks-team-map.js has every team id set to
// `null` because the active SportMonks account (Football Free Plan) does not cover the
// World Cup. `isSyncCandidate` below skips any fixture with an unresolved team id, so this
// module is a safe no-op in practice until the team map and state map are filled in with
// real values from a paid plan. See those files' TODO comments.
const { getTeamId } = require('./sportmonks-team-map');
const { mapStateIdToStatus } = require('./sportmonks-states');

const POLL_INTERVAL_MS = 60 * 1000;
const SPORTMONKS_BASE_URL = 'https://api.sportmonks.com/v3/football';
const SYNC_REQUEST_CONTEXT = { session: {}, ip: 'sportmonks-sync' };
const FUTURE_WINDOW_MS = 24 * 60 * 60 * 1000;

let intervalHandle = null;

function isSyncCandidate(match) {
  if (!match || match.status === 'final') return false;
  const homeTeamId = getTeamId(match.homeTeam);
  const awayTeamId = getTeamId(match.awayTeam);
  if (homeTeamId === null || awayTeamId === null) {
    const unmapped = homeTeamId === null ? match.homeTeam : match.awayTeam;
    console.warn(`[sportmonks-sync] no team mapping for "${unmapped}", skipping fixture ${match.id}`);
    return false;
  }

  const kickoff = new Date(match.date || match.boliviaDate || 0);
  if (Number.isNaN(kickoff.getTime())) return true;
  return kickoff.getTime() <= Date.now() + FUTURE_WINDOW_MS;
}

function formatDateParam(match) {
  const kickoff = new Date(match.date || match.boliviaDate || 0);
  if (Number.isNaN(kickoff.getTime())) return null;
  return kickoff.toISOString().slice(0, 10);
}

function extractCurrentScore(fixturePayload, homeTeamId, awayTeamId) {
  const scores = Array.isArray(fixturePayload?.scores) ? fixturePayload.scores : [];
  const current = scores.filter((entry) => entry?.description === 'CURRENT');

  let homeScore = null;
  let awayScore = null;
  for (const entry of current) {
    const goals = entry?.score?.goals;
    const participantId = entry?.score?.participant_id;
    if (goals === undefined || goals === null) continue;
    if (participantId === homeTeamId) homeScore = goals;
    if (participantId === awayTeamId) awayScore = goals;
  }
  return { homeScore, awayScore };
}

function pickMatchingFixture(payload, homeTeamId, awayTeamId) {
  const candidates = Array.isArray(payload?.data) ? payload.data : [];
  return candidates.find((fixture) => {
    const participants = Array.isArray(fixture?.participants) ? fixture.participants : [];
    const ids = new Set(participants.map((p) => p.id));
    return ids.has(homeTeamId) && ids.has(awayTeamId);
  }) || null;
}

async function fetchSportmonksFixture({ homeTeamId, dateParam, apiToken }) {
  const url = `${SPORTMONKS_BASE_URL}/fixtures/teams/${homeTeamId}/between/${dateParam}/${dateParam}?include=scores;participants`;
  const response = await fetch(url, { headers: { Authorization: apiToken } });
  if (!response.ok) {
    throw new Error(`SportMonks request failed with status ${response.status}`);
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

async function syncSingleFixture(match, deps) {
  const { apiToken } = deps;
  const homeTeamId = getTeamId(match.homeTeam);
  const awayTeamId = getTeamId(match.awayTeam);
  const dateParam = formatDateParam(match);
  if (!dateParam) return;

  const payload = await fetchSportmonksFixture({ homeTeamId, dateParam, apiToken });
  const fixturePayload = pickMatchingFixture(payload, homeTeamId, awayTeamId);
  if (!fixturePayload) return;

  const status = mapStateIdToStatus(fixturePayload.state_id);
  if (status === null) {
    console.warn(`[sportmonks-sync] unrecognized state_id ${fixturePayload.state_id} for fixture ${match.id}, skipping`);
    return;
  }

  const { homeScore, awayScore } = extractCurrentScore(fixturePayload, homeTeamId, awayTeamId);
  await applyFixtureSync({ match, status, homeScore, awayScore, deps });
}

async function runSyncCycle(deps) {
  const { readJson } = deps;
  const fixtures = await readJson('fixtures.json');
  const candidates = fixtures.filter(isSyncCandidate);

  for (const match of candidates) {
    try {
      await syncSingleFixture(match, deps);
    } catch (error) {
      console.error(`[sportmonks-sync] error syncing fixture ${match.id}: ${error.message}`);
    }
  }
}

function startSportmonksSync(deps) {
  if (intervalHandle) return;
  if (!deps?.apiToken) {
    console.log('[sportmonks-sync] SPORTMONKS_API_TOKEN not set, sync disabled.');
    return;
  }

  console.log('[sportmonks-sync] starting sync, polling every 60s.');
  intervalHandle = setInterval(() => {
    runSyncCycle(deps).catch((error) => {
      console.error(`[sportmonks-sync] sync cycle failed: ${error.message}`);
    });
  }, POLL_INTERVAL_MS);
}

function stopSportmonksSync() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = {
  startSportmonksSync,
  stopSportmonksSync,
  runSyncCycle,
  isSyncCandidate,
  syncSingleFixture,
  pickMatchingFixture,
  extractCurrentScore,
  applyFixtureSync
};
