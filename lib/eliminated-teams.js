// Computes the set of teams that have been eliminated from the World Cup
// based on the current state of `data/fixtures.json`.
//
// A team is considered eliminated when it has lost a knockout match whose
// phase is part of the tournament's elimination bracket (16vos, 8vos, 4vos,
// Semifinal, Final). Group-stage losses do NOT eliminate a team because
// teams can still advance via the third-place spots.
//
// Per-match elimination rule:
//   - Non-draw finalised match  -> the team with the lower score is the
//     loser, hence eliminated.
//   - Draw finalised match that has an explicit advancer -> the team that
//     is NOT the advancer is eliminated. The advancer field is set by an
//     admin (or by the worldcup sync) after a penalty shootout, and is
//     the canonical signal of who survived a draw in a knockout round.
//   - Knockout match that is NOT finalised (status 'scheduled' or 'live',
//     or a draw with no advancer yet) -> no elimination from that match.
//
// This helper is intentionally pure and dependency-free: it only reads the
// fixtures array passed in and returns a new Set of strings. The caller
// (server.js) is responsible for reading the JSON file. This keeps the
// elimination logic testable in isolation, mirroring the pattern of
// `lib/knockout-propagation.js`.

const KNOCKOUT_PHASES = new Set(['16vos', '8vos', '4vos', 'Semifinal', 'Final']);

function isFinalised(match) {
  return match && match.status === 'final'
    && Number.isInteger(match.homeScore)
    && Number.isInteger(match.awayScore);
}

function resolveLoser(match) {
  if (match.homeScore > match.awayScore) return match.awayTeam;
  if (match.awayScore > match.homeScore) return match.homeTeam;
  // Draw: rely on the explicit advancer (set after penalties). If the
  // advancer is missing or not one of the two teams, the match has not
  // been fully resolved yet and contributes no eliminations.
  if (typeof match.advancer === 'string'
    && (match.advancer === match.homeTeam || match.advancer === match.awayTeam)) {
    return match.advancer === match.homeTeam ? match.awayTeam : match.homeTeam;
  }
  return null;
}

function getEliminatedTeams(fixtures) {
  const eliminated = new Set();
  if (!Array.isArray(fixtures)) return eliminated;

  for (const match of fixtures) {
    if (!match || !KNOCKOUT_PHASES.has(match.phase)) continue;
    if (typeof match.homeTeam !== 'string' || typeof match.awayTeam !== 'string') continue;
    if (!isFinalised(match)) continue;

    const loser = resolveLoser(match);
    if (loser) eliminated.add(loser);
  }

  return eliminated;
}

module.exports = {
  getEliminatedTeams,
  KNOCKOUT_PHASES
};
