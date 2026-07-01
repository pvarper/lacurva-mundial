// Behavioural tests for the knockout propagation feature.
//
// Five scenarios, each one a regression risk for the propagation layer
// plus the API response shape:
//   1. Initial propagation — upstream finalises, downstream shows the
//      right advancer on the next read.
//   2. Upstream correction — re-saving an already-final upstream with a
//      new winner still flows through to non-final downstream slots
//      (because the data file keeps the live placeholder, and the API
//      resolves it on every read).
//   3. Downstream finalization — a downstream match whose slots are
//      still placeholders can be finalised, and the snapshot step
//      resolves the placeholders at write time when the upstream chain
//      bottoms out.
//   4. Bracket linkage after finalization — once a match is final,
//      `homeTeamRef` / `awayTeamRef` must still be present in the API
//      response so the bracket connector keeps the upstream link.
//   5. Draw + advancer — a draw finalised with an explicit advancer
//      propagates that advancer downstream (the draw branch reads
//      `match.advancer`, not the score comparison).
//
// Uses the built-in `node:test` runner; run with `pnpm test:unit`.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  propagateKnockoutWinner,
  resolveFixtureTeams,
  resolveKnockoutTeams,
  extractBracketReference,
  decorateFixturesForResponse,
  KNOCKOUT_PHASES
} = require('../lib/knockout-propagation');

function mkR16(matchNumber, home, away, { status = 'scheduled', homeScore = null, awayScore = null, advancer = null, penaltyHomeScore = null, penaltyAwayScore = null } = {}) {
  return {
    id: `m-r16-${matchNumber}`,
    matchNumber,
    date: `2026-06-2${matchNumber % 9}T19:00:00.000Z`,
    boliviaDate: '2026-06-28',
    boliviaTime: '15:00',
    homeTeam: home,
    awayTeam: away,
    homeScore,
    awayScore,
    status,
    phase: '16vos',
    roundName: '16vos',
    group: null,
    city: 'Test City',
    stadium: 'Test Stadium',
    stadiumCommonName: 'Test Common',
    source: 'test',
    advancer,
    penaltyHomeScore,
    penaltyAwayScore
  };
}

function mkQF(matchNumber, home, away) {
  return {
    id: `m-qf-${matchNumber}`,
    matchNumber,
    date: '2026-07-04T21:00:00.000Z',
    boliviaDate: '2026-07-04',
    boliviaTime: '17:00',
    homeTeam: home,
    awayTeam: away,
    homeScore: null,
    awayScore: null,
    status: 'scheduled',
    phase: '8vos',
    roundName: '8vos',
    group: null,
    city: 'Test City',
    stadium: 'Test Stadium',
    stadiumCommonName: 'Test Common',
    source: 'test'
  };
}

function mkSF(matchNumber, home, away) {
  return {
    id: `m-sf-${matchNumber}`,
    matchNumber,
    date: '2026-07-08T20:00:00.000Z',
    boliviaDate: '2026-07-08',
    boliviaTime: '16:00',
    homeTeam: home,
    awayTeam: away,
    homeScore: null,
    awayScore: null,
    status: 'scheduled',
    phase: 'Semifinal',
    roundName: 'Semifinal',
    group: null,
    city: 'Test City',
    stadium: 'Test Stadium',
    stadiumCommonName: 'Test Common',
    source: 'test'
  };
}

function mkFinal(matchNumber, home, away) {
  return {
    id: `m-final-${matchNumber}`,
    matchNumber,
    date: '2026-07-15T20:00:00.000Z',
    boliviaDate: '2026-07-15',
    boliviaTime: '16:00',
    homeTeam: home,
    awayTeam: away,
    homeScore: null,
    awayScore: null,
    status: 'scheduled',
    phase: 'Final',
    roundName: 'Final',
    group: null,
    city: 'Test City',
    stadium: 'Test Stadium',
    stadiumCommonName: 'Test Common',
    source: 'test'
  };
}

// ---- 1. Initial propagation -------------------------------------------------

test('initial propagation: upstream finalises, downstream resolves to the advancer', () => {
  // #73 is a 16vos with concrete teams. #89 is the 8vos that takes its
  // winner. After finalising #73, a read of #89 must show the resolved
  // advancer name, not the placeholder.
  const fixtures = [
    mkR16(73, 'Sudafrica', 'Canada', { status: 'final', homeScore: 0, awayScore: 1 }),
    mkQF(89, 'W73', 'W75')
  ];
  // Ensure the other upstream is also final so its placeholder resolves
  // too, otherwise the test would mix a resolved slot with an unresolved
  // one. That is fine for a focused test, but #89 is a downstream of
  // #73 and #75, so we just want to verify the W73 → Sudafrica/Canada
  // branch.
  const resolved = resolveKnockoutTeams(fixtures);
  const qf = resolved.find((m) => m.matchNumber === 89);
  assert.equal(qf.homeTeam, 'Canada', 'W73 must resolve to the winner of #73 (away won 0-1)');
  assert.equal(qf.awayTeam, 'W75', 'unresolved upstream must pass through, not throw');
});

// ---- 2. Upstream correction -------------------------------------------------

test('upstream correction: re-saving a final upstream with a new winner updates downstream on read', () => {
  // First state: #73 is final with home winner (1-0). #89 is non-final
  // with placeholder. The API resolution shows "Sudafrica" in #89.
  let fixtures = [
    mkR16(73, 'Sudafrica', 'Canada', { status: 'final', homeScore: 1, awayScore: 0 }),
    mkQF(89, 'W73', 'W75')
  ];
  assert.equal(resolveKnockoutTeams(fixtures).find((m) => m.matchNumber === 89).homeTeam, 'Sudafrica');

  // Correction: the admin re-saves #73 with a reversed score. The data
  // file's #89 still has the live "W73" placeholder; the next read
  // resolves it to the new winner automatically. This is the whole point
  // of keeping the placeholder token in the data file.
  const r16 = fixtures.find((m) => m.matchNumber === 73);
  r16.homeScore = 0;
  r16.awayScore = 2;
  r16.advancer = null;
  assert.equal(resolveKnockoutTeams(fixtures).find((m) => m.matchNumber === 89).homeTeam, 'Canada');

  // The placeholder token is still in the data file (we did not touch
  // it). The upstream correction auto-propagated without a downstream
  // write.
  assert.equal(fixtures.find((m) => m.matchNumber === 89).homeTeam, 'W73');
});

// ---- 3. Downstream finalization --------------------------------------------

test('downstream finalization: a downstream with placeholders can be finalised, snapshot resolves when upstream is final', () => {
  // #73 final, #75 final. #89 (8vos) is non-final with two placeholders.
  // Finalising #89 with 1-0 must:
  //   - succeed (the old rejection of placeholder finalization is gone)
  //   - snapshot "W73" → "Canada" (away won #73) and "W75" → winner of #75
  //   - stamp homeTeamRef = 73 and awayTeamRef = 75 so the bracket keeps
  //     the upstream link
  const fixtures = [
    mkR16(73, 'Sudafrica', 'Canada', { status: 'final', homeScore: 0, awayScore: 1 }),
    mkR16(75, 'Paises Bajos', 'Marruecos', { status: 'final', homeScore: 1, awayScore: 1, advancer: 'Marruecos' }),
    mkQF(89, 'W73', 'W75')
  ];

  const qf = fixtures.find((m) => m.matchNumber === 89);
  qf.status = 'final';
  qf.homeScore = 1;
  qf.awayScore = 0;

  const updates = propagateKnockoutWinner(fixtures, qf);
  assert.equal(updates.length, 1, 'one snapshot update expected');
  assert.equal(qf.homeTeam, 'Canada', 'home placeholder resolved and snapshotted');
  assert.equal(qf.awayTeam, 'Marruecos', 'away placeholder resolved and snapshotted');
  assert.equal(qf.homeTeamRef, 73, 'home upstream ref stamped at snapshot time');
  assert.equal(qf.awayTeamRef, 75, 'away upstream ref stamped at snapshot time');
});

test('downstream finalization: a downstream with placeholders can be finalised even when upstream is not final', () => {
  // #73 is NOT final yet. #89 (8vos) has a placeholder. Finalising #89
  // with 1-0 must:
  //   - succeed (no rejection)
  //   - leave homeTeam as the placeholder (no concrete name to snapshot)
  //   - stamp homeTeamRef = 73 so the bracket keeps the upstream link
  //   - the read-time resolution will pick up the real winner once #73
  //     is final
  const fixtures = [
    mkR16(73, 'Sudafrica', 'Canada'),
    mkQF(89, 'W73', 'W75')
  ];

  const qf = fixtures.find((m) => m.matchNumber === 89);
  qf.status = 'final';
  qf.homeScore = 1;
  qf.awayScore = 0;

  const updates = propagateKnockoutWinner(fixtures, qf);
  assert.equal(updates.length, 0, 'no snapshot update when upstream chain is unresolved');
  assert.equal(qf.homeTeam, 'W73', 'placeholder left as-is when upstream is not final');
  assert.equal(qf.homeTeamRef, 73, 'home upstream ref still stamped at snapshot time');
  assert.equal(qf.awayTeamRef, 75, 'away upstream ref still stamped at snapshot time');

  // Read-time resolution still works.
  const resolved = resolveKnockoutTeams(fixtures).find((m) => m.matchNumber === 89);
  assert.equal(resolved.homeTeam, 'W73', 'placeholder still passes through at read time');
});

test('downstream finalization: re-saving an already-final match does not clobber the stamped ref', () => {
  // After the first finalization, the ref is set. A re-save (e.g. score
  // correction) must not clear the ref, because the post-snapshot value
  // is a concrete team name (no placeholder to re-derive from).
  const fixtures = [
    mkR16(73, 'Sudafrica', 'Canada', { status: 'final', homeScore: 0, awayScore: 1 }),
    mkQF(89, 'W73', 'W75', { status: 'final', homeScore: 1, awayScore: 0, homeTeam: 'Canada', awayTeam: 'Nigeria' })
  ];
  // Pretend the prior code path stamped the refs.
  fixtures.find((m) => m.matchNumber === 89).homeTeamRef = 73;
  fixtures.find((m) => m.matchNumber === 89).awayTeamRef = 75;

  const qf = fixtures.find((m) => m.matchNumber === 89);
  qf.homeScore = 2; // score correction
  const updates = propagateKnockoutWinner(fixtures, qf);

  assert.equal(updates.length, 0, 'no snapshot update when the home/away name did not change');
  assert.equal(qf.homeTeamRef, 73, 'home ref preserved on re-save');
  assert.equal(qf.awayTeamRef, 75, 'away ref preserved on re-save');
});

// ---- 4. Bracket linkage after finalization ---------------------------------

test('bracket linkage after finalization: decorateFixturesForResponse exposes the stamped ref', () => {
  // #73 final. #89 finalised with homeTeam = 'Canada' (resolved) and
  // homeTeamRef = 73. The decorate step must surface homeTeamRef = 73 in
  // the response, NOT derive it from the post-snapshot 'Canada' string
  // (which has no bracket reference).
  const fixtures = [
    mkR16(73, 'Sudafrica', 'Canada', { status: 'final', homeScore: 0, awayScore: 1 }),
    mkQF(89, 'W73', 'W75', { status: 'final', homeScore: 1, awayScore: 0, homeTeam: 'Canada', awayTeam: 'Nigeria' })
  ];
  fixtures.find((m) => m.matchNumber === 89).homeTeamRef = 73;
  fixtures.find((m) => m.matchNumber === 89).awayTeamRef = 75;

  const decorated = decorateFixturesForResponse(fixtures);
  const qf = decorated.find((m) => m.matchNumber === 89);
  assert.equal(qf.homeTeamRef, 73, 'home ref from the persisted field');
  assert.equal(qf.awayTeamRef, 75, 'away ref from the persisted field');
  assert.equal(qf.homeTeam, 'Canada', 'the response still shows the resolved name');
});

test('bracket linkage: non-final downstream still exposes the ref via placeholder parsing', () => {
  // For a non-final downstream, the data file still holds the placeholder
  // (e.g. "W73"). The decoration should fall back to parsing the
  // placeholder so the bracket still draws a connector.
  const fixtures = [
    mkR16(73, 'Sudafrica', 'Canada', { status: 'final', homeScore: 0, awayScore: 1 }),
    mkQF(89, 'W73', 'W75')
  ];
  const decorated = decorateFixturesForResponse(fixtures);
  const qf = decorated.find((m) => m.matchNumber === 89);
  assert.equal(qf.homeTeamRef, 73, 'home ref derived from the placeholder');
  assert.equal(qf.awayTeamRef, 75, 'away ref derived from the placeholder');
});

test('bracket linkage: extractBracketReference returns null for non-placeholder strings', () => {
  assert.equal(extractBracketReference('Canada'), null);
  assert.equal(extractBracketReference(''), null);
  assert.equal(extractBracketReference(null), null);
  assert.equal(extractBracketReference(undefined), null);
  assert.equal(extractBracketReference(123), null);
  assert.equal(extractBracketReference('  W74  '), 74, 'trims whitespace');
  assert.equal(extractBracketReference('L102'), 102, 'loser placeholders are valid refs too');
});

test('bracket linkage: KNOCKOUT_PHASES is exposed and matches the documented set', () => {
  assert.deepEqual([...KNOCKOUT_PHASES].sort(), ['16vos', '4vos', '8vos', 'Final', 'Semifinal'].sort());
});

// ---- 5. Draw + advancer ----------------------------------------------------

test('draw + advancer: a draw finalised with advancer propagates the explicit advancer downstream', () => {
  // #73 is a 1-1 draw, admin sets advancer = Canada (the away side won
  // on penalties). The propagation must snapshot "Canada" as the advancer
  // when downstream #89 is read.
  const fixtures = [
    mkR16(73, 'Sudafrica', 'Canada', { status: 'final', homeScore: 1, awayScore: 1, advancer: 'Canada' }),
    mkQF(89, 'W73', 'W75')
  ];
  const resolved = resolveKnockoutTeams(fixtures).find((m) => m.matchNumber === 89);
  assert.equal(resolved.homeTeam, 'Canada', 'W73 resolves to the explicit advancer, not to home or away by score');
});

test('draw + advancer: a finalised downstream with a draw upstream stamps the ref AND keeps the snapshot', () => {
  // The full snapshot path with a draw upstream.
  const fixtures = [
    mkR16(73, 'Sudafrica', 'Canada', { status: 'final', homeScore: 1, awayScore: 1, advancer: 'Canada' }),
    mkQF(89, 'W73', 'W75')
  ];
  const qf = fixtures.find((m) => m.matchNumber === 89);
  qf.status = 'final';
  qf.homeScore = 2;
  qf.awayScore = 0;
  const updates = propagateKnockoutWinner(fixtures, qf);

  assert.equal(updates.length, 1);
  assert.equal(qf.homeTeam, 'Canada', 'draw upstream with explicit advancer propagates the advancer name');
  assert.equal(qf.homeTeamRef, 73, 'ref still stamped from the placeholder');
  assert.equal(qf.awayTeamRef, 75);
});

test('draw + advancer: chain resolution handles a multi-level draw chain', () => {
  // #73 is a 1-1 draw, advancer = Canada. #75 is a draw, advancer =
  // Marruecos. The downstream #89 (also a draw) must see both resolved
  // to their advancers and propagate them.
  const fixtures = [
    mkR16(73, 'Sudafrica', 'Canada', { status: 'final', homeScore: 1, awayScore: 1, advancer: 'Canada' }),
    mkR16(75, 'Paises Bajos', 'Marruecos', { status: 'final', homeScore: 2, awayScore: 2, advancer: 'Marruecos' }),
    mkQF(89, 'W73', 'W75')
  ];
  const resolved = resolveKnockoutTeams(fixtures).find((m) => m.matchNumber === 89);
  assert.equal(resolved.homeTeam, 'Canada');
  assert.equal(resolved.awayTeam, 'Marruecos');
});

// ---- Bonus: edge cases the propagation must NOT break ----------------------

test('non-final match: propagateKnockoutWinner is a no-op when status is not final', () => {
  const fixtures = [
    mkR16(73, 'Sudafrica', 'Canada', { status: 'final', homeScore: 0, awayScore: 1 }),
    mkQF(89, 'W73', 'W75')
  ];
  const qf = fixtures.find((m) => m.matchNumber === 89);
  qf.status = 'live';
  const updates = propagateKnockoutWinner(fixtures, qf);
  assert.equal(updates.length, 0);
  assert.equal(qf.homeTeam, 'W73', 'placeholder untouched on non-final save');
  assert.equal(qf.homeTeamRef, undefined, 'no ref stamped on non-final save');
});

test('cycle protection: a placeholder chain that loops back does not blow the stack', () => {
  // Pathological data: #73 and #75 both reference each other. The
  // resolver must bottom out gracefully and not infinite-recurse.
  const fixtures = [
    mkR16(73, 'W75', 'Canada', { status: 'final', homeScore: 1, awayScore: 0 }),
    mkR16(75, 'W73', 'Marruecos', { status: 'final', homeScore: 1, awayScore: 0 })
  ];
  const resolved = resolveKnockoutTeams(fixtures);
  // The cycle-protected resolver should return the original placeholder
  // tokens rather than stack-overflowing.
  assert.equal(resolved[0].homeTeam, 'W75');
  assert.equal(resolved[1].homeTeam, 'W73');
});
