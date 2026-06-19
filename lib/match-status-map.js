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
