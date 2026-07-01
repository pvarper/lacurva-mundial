// Behavioural tests for the eliminated-teams helper.
//
// The helper turns a snapshot of `data/fixtures.json` into a Set of team
// names that have lost a knockout match (16vos onward). The contract is
// the source of truth for both the picks-options filter (which removes
// these teams from the champion / runner-up dropdowns) and the community
// table marker (which renders the pick with a strikethrough + red color).
//
// Four scenarios cover the spec's full surface:
//   1. Non-draw knockout loss — the lower-scoring team is eliminated.
//   2. Draw with explicit advancer — the non-advancer is eliminated.
//   3. Group-stage loss — does NOT eliminate a team (groups don't count).
//   4. Scheduled knockout — no elimination yet, regardless of placement.
//   5. Draw with no advancer — must NOT eliminate anyone (the match has
//      not been fully resolved; admin still has to set advancer).
//   6. Non-knockout draw with advancer (e.g. a corrupt record) — must NOT
//      eliminate anyone, because the elimination set is restricted to the
//      knockout phases.
//   7. Empty / malformed input — returns an empty Set without throwing.
//   8. Third-place match (phase "Final", roundName "Tercer Puesto") —
//      treated as knockout; the loser is added if it was finalised.
//
// Uses the built-in `node:test` runner; run with `pnpm test:unit`.

const test = require('node:test');
const assert = require('node:assert/strict');

const { getEliminatedTeams, KNOCKOUT_PHASES } = require('../lib/eliminated-teams');

function mkMatch({
  id = 'm',
  matchNumber = 1,
  phase = '16vos',
  homeTeam = 'Home',
  awayTeam = 'Away',
  homeScore = null,
  awayScore = null,
  status = 'scheduled',
  advancer = null,
  roundName
} = {}) {
  return {
    id,
    matchNumber,
    date: '2026-06-28T19:00:00.000Z',
    boliviaDate: '2026-06-28',
    boliviaTime: '15:00',
    homeTeam,
    awayTeam,
    homeScore,
    awayScore,
    status,
    phase,
    roundName: roundName || phase,
    group: null,
    city: 'Test',
    stadium: 'Test',
    stadiumCommonName: 'Test',
    source: 'test',
    advancer
  };
}

test('non-draw knockout loss: the lower-scoring team is eliminated', () => {
  const fixtures = [
    mkMatch({ matchNumber: 73, phase: '16vos', homeTeam: 'Sudafrica', awayTeam: 'Canada', homeScore: 0, awayScore: 1, status: 'final' })
  ];
  const eliminated = getEliminatedTeams(fixtures);
  assert.equal(eliminated.size, 1);
  assert.equal(eliminated.has('Sudafrica'), true, 'home lost 0-1 → eliminated');
  assert.equal(eliminated.has('Canada'), false);
});

test('non-draw knockout loss: away team can be the loser', () => {
  // The helper must not hard-code the loser as "home" — the side with the
  // lower score is the loser regardless of venue.
  const fixtures = [
    mkMatch({ matchNumber: 77, phase: '16vos', homeTeam: 'Francia', awayTeam: 'Suecia', homeScore: 3, awayScore: 0, status: 'final' })
  ];
  const eliminated = getEliminatedTeams(fixtures);
  assert.equal(eliminated.has('Suecia'), true);
  assert.equal(eliminated.has('Francia'), false);
});

test('draw with advancer: the non-advancer is the loser (penalty decided)', () => {
  // 1-1 draw, advancer = home → home advanced on penalties, away is out.
  const fixtures = [
    mkMatch({
      matchNumber: 74,
      phase: '16vos',
      homeTeam: 'Alemania',
      awayTeam: 'Paraguay',
      homeScore: 1,
      awayScore: 1,
      advancer: 'Alemania',
      status: 'final'
    })
  ];
  const eliminated = getEliminatedTeams(fixtures);
  assert.equal(eliminated.size, 1);
  assert.equal(eliminated.has('Paraguay'), true);
  assert.equal(eliminated.has('Alemania'), false);
});

test('draw with advancer: when advancer is the away side, the home is out', () => {
  // 1-1 draw, advancer = away (the typical WC scenario where the lower-
  // ranked side wins the shootout).
  const fixtures = [
    mkMatch({
      matchNumber: 75,
      phase: '16vos',
      homeTeam: 'Paises Bajos',
      awayTeam: 'Marruecos',
      homeScore: 1,
      awayScore: 1,
      advancer: 'Marruecos',
      status: 'final'
    })
  ];
  const eliminated = getEliminatedTeams(fixtures);
  assert.equal(eliminated.has('Paises Bajos'), true);
  assert.equal(eliminated.has('Marruecos'), false);
});

test('group-stage loss does NOT eliminate a team', () => {
  // A team can lose in groups and still advance (3rd-place spots), so the
  // elimination set is restricted to knockout phases.
  const fixtures = [
    mkMatch({
      matchNumber: 10,
      phase: 'Fase de Grupos',
      homeTeam: 'Japon',
      awayTeam: 'Brasil',
      homeScore: 0,
      awayScore: 4,
      status: 'final'
    })
  ];
  const eliminated = getEliminatedTeams(fixtures);
  assert.equal(eliminated.size, 0, 'groups do not eliminate');
});

test('scheduled knockout match contributes no elimination', () => {
  const fixtures = [
    mkMatch({ matchNumber: 73, phase: '16vos', homeTeam: 'Sudafrica', awayTeam: 'Canada', status: 'scheduled' })
  ];
  const eliminated = getEliminatedTeams(fixtures);
  assert.equal(eliminated.size, 0);
});

test('live knockout match contributes no elimination', () => {
  // The match is being played but is not final. Even if the score would
  // make one side the eventual loser, we wait for `status: final` to act
  // on it. This matches how the scoring engine works (no points while
  // the match is live or scheduled).
  const fixtures = [
    mkMatch({ matchNumber: 73, phase: '16vos', homeTeam: 'Sudafrica', awayTeam: 'Canada', homeScore: 0, awayScore: 2, status: 'live' })
  ];
  const eliminated = getEliminatedTeams(fixtures);
  assert.equal(eliminated.size, 0);
});

test('draw with no advancer contributes no elimination', () => {
  // A 1-1 draw saved without setting advancer is a half-finalised match
  // — admin has to follow up with the penalty winner. Until then, neither
  // team is recorded as eliminated.
  const fixtures = [
    mkMatch({ matchNumber: 73, phase: '16vos', homeTeam: 'Alemania', awayTeam: 'Paraguay', homeScore: 1, awayScore: 1, advancer: null, status: 'final' })
  ];
  const eliminated = getEliminatedTeams(fixtures);
  assert.equal(eliminated.size, 0);
});

test('draw with advancer that is not one of the two teams is treated as unresolved', () => {
  // Defensive: a corrupt advancer value must NOT be honoured. We only
  // trust advancer if it is exactly one of the two match teams.
  const fixtures = [
    mkMatch({
      matchNumber: 73,
      phase: '16vos',
      homeTeam: 'Alemania',
      awayTeam: 'Paraguay',
      homeScore: 1,
      awayScore: 1,
      advancer: 'Brasil',
      status: 'final'
    })
  ];
  const eliminated = getEliminatedTeams(fixtures);
  assert.equal(eliminated.size, 0);
});

test('knockout phases: every phase in the documented set is recognized', () => {
  // Sanity check on the exposed phase set. If the data file ever adds a
  // new phase (e.g. "3eros" for a third-place match), the helper should
  // be updated to include it. For now the WC data only uses the canonical
  // 16vos → 8vos → 4vos → Semifinal → Final chain.
  assert.deepEqual([...KNOCKOUT_PHASES].sort(), ['16vos', '4vos', '8vos', 'Final', 'Semifinal'].sort());
});

test('multi-phase chain: eliminated teams accumulate across the bracket', () => {
  // Two 16vos matches + one 8vos + one semifinal all finalised. Four teams
  // eliminated total, no duplicates.
  const fixtures = [
    mkMatch({ matchNumber: 73, phase: '16vos', homeTeam: 'Sudafrica', awayTeam: 'Canada', homeScore: 0, awayScore: 1, status: 'final' }),
    mkMatch({ matchNumber: 75, phase: '16vos', homeTeam: 'Brasil', awayTeam: 'Japon', homeScore: 2, awayScore: 1, status: 'final' }),
    mkMatch({ matchNumber: 89, phase: '8vos', homeTeam: 'Canada', awayTeam: 'Brasil', homeScore: 1, awayScore: 2, status: 'final' }),
    mkMatch({ matchNumber: 101, phase: 'Semifinal', homeTeam: 'Brasil', awayTeam: 'Argentina', homeScore: 0, awayScore: 2, status: 'final' })
  ];
  const eliminated = getEliminatedTeams(fixtures);
  assert.deepEqual([...eliminated].sort(), ['Brasil', 'Canada', 'Japon', 'Sudafrica'].sort());
});

test('third-place match: phase "Final" with roundName "Tercer Puesto" is still a knockout', () => {
  // The WC data has the third-place match with phase "Final" and
  // roundName "Tercer Puesto". Both sides of that match have already
  // been eliminated by losing their semifinal, but the helper still
  // needs to process it correctly if it were the source of a fresh
  // elimination (e.g. if advancer semantics ever changed).
  const fixtures = [
    mkMatch({
      matchNumber: 103,
      phase: 'Final',
      roundName: 'Tercer Puesto',
      homeTeam: 'Canada',
      awayTeam: 'Brasil',
      homeScore: 1,
      awayScore: 2,
      status: 'final'
    })
  ];
  const eliminated = getEliminatedTeams(fixtures);
  assert.equal(eliminated.has('Canada'), true);
  assert.equal(eliminated.has('Brasil'), false);
});

test('empty / malformed input returns an empty Set without throwing', () => {
  assert.equal(getEliminatedTeams(undefined).size, 0);
  assert.equal(getEliminatedTeams(null).size, 0);
  assert.equal(getEliminatedTeams([]).size, 0);
  // Per-fixture shape validation must skip bad rows silently so a single
  // corrupt record cannot break the picks-options response.
  assert.equal(getEliminatedTeams([null, undefined, {}]).size, 0);
  assert.equal(getEliminatedTeams([mkMatch({ homeTeam: 123, awayTeam: 'X', status: 'final', homeScore: 0, awayScore: 1 })]).size, 0);
});
