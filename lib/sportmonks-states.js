// Maps SportMonks fixture `state_id` to the app's status vocabulary
// (scheduled | live | final — see FIXTURE_STATUSES in server.js).
//
// IMPORTANT: every id below is a PLACEHOLDER.
// TODO: confirm via live SportMonks API call once a paid plan covering the World Cup is active.
// The current account is on the SportMonks Football Free Plan, which does not cover the World
// Cup, so the official state reference (GET /football/states) could not be queried against a
// relevant fixture during this implementation pass. Values here are best-effort guesses based
// on SportMonks' commonly documented state ids and MUST be verified before relying on them.
const STATE_ID_TO_STATUS = {
  // "Not Started" — TODO: confirm via live SportMonks API call.
  1: 'scheduled',
  // Live sub-states (1st half, half-time, 2nd half, extra time, penalties) — TODO: confirm via live SportMonks API call.
  2: 'live',
  3: 'live',
  4: 'live',
  6: 'live',
  7: 'live',
  8: 'live',
  9: 'live',
  10: 'live',
  // Finished states (full-time, after extra time, after penalties) — TODO: confirm via live SportMonks API call.
  5: 'final',
  100: 'final',
  101: 'final'
};

function mapStateIdToStatus(stateId) {
  return STATE_ID_TO_STATUS[stateId] ?? null;
}

module.exports = { STATE_ID_TO_STATUS, mapStateIdToStatus };
