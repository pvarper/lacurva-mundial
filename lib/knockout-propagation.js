// Resolves winner/loser placeholders in knockout fixtures.
//
// Downstream knockout fixtures reference the result of an upstream match by
// a short token ("W73" = winner of match 73, "L101" = loser of match 101).
// Two things need to happen with that token:
//
// 1. At READ time (API response, scoring, bracket rendering), the token is
//    replaced with the current winner/loser of the upstream match. This is
//    the `resolveFixtureTeams` / `resolveKnockoutTeams` family below. It is
//    a pure function: it does not mutate the input, does not require the
//    upstream to be final (unresolvable placeholders pass through), and is
//    memoized + cycle-protected so chains like W97 -> W89 -> W74 -> "Paraguay"
//    resolve in a single pass.
//
// 2. At WRITE time (admin saves a knockout fixture result, or the background
//    worldcup sync finalises one), the placeholders in the SAVED fixture
//    itself are snapshotted to the current resolved team name. This is what
//    `propagateKnockoutWinner` does. It deliberately does NOT mutate any
//    other fixture: downstream fixtures keep their placeholder token, which
//    is the live reference that lets a later correction to an upstream
//    result automatically flow through to every non-final downstream slot
//    on the next read.
//
// Why both? Because a final match's `homeTeam`/`awayTeam` must be a concrete
// team name (scoring and audit compare it against user predictions by string
// equality), and a non-final downstream fixture's `homeTeam`/`awayTeam`
// should stay a live reference so corrections are not lost.
//
// Already-final downstream fixtures are explicitly NOT re-snapshotted when
// an upstream is corrected. The snapshot was taken at the moment that
// downstream match was finalised, and changing it after the fact would
// silently rewrite a saved result and any user prediction that referenced
// it. The admin can re-save the downstream fixture manually if the upstream
// correction is meant to flow downstream.
const KNOCKOUT_PHASES = new Set(['16vos', '8vos', '4vos', 'Semifinal', 'Final']);
const PLACEHOLDER_PATTERN = /^[WL](\d+)$/;

function isKnockout(match) {
  return match && KNOCKOUT_PHASES.has(match.phase);
}

function getOutcome(homeScore, awayScore) {
  if (homeScore > awayScore) return 'home';
  if (homeScore < awayScore) return 'away';
  return 'draw';
}

function resolveAdvancerAndLoser(match) {
  if (!isKnockout(match)) return null;
  if (match.status !== 'final') return null;
  if (match.homeScore === null || match.homeScore === undefined) return null;
  if (match.awayScore === null || match.awayScore === undefined) return null;
  if (typeof match.homeTeam !== 'string' || typeof match.awayTeam !== 'string') return null;

  const outcome = getOutcome(match.homeScore, match.awayScore);
  if (outcome === 'draw') {
    if (!match.advancer) return null;
    if (match.advancer !== match.homeTeam && match.advancer !== match.awayTeam) return null;
    const loser = match.advancer === match.homeTeam ? match.awayTeam : match.homeTeam;
    return { advancer: match.advancer, loser };
  }
  return {
    advancer: outcome === 'home' ? match.homeTeam : match.awayTeam,
    loser: outcome === 'home' ? match.awayTeam : match.homeTeam
  };
}

// Returns the upstream match number a `homeTeam`/`awayTeam` token points at,
// or null if the value is not a placeholder. Used by the API response to
// expose the structural bracket reference to the frontend, which needs the
// match number to draw connector lines even when the resolved name is
// shown in the card body.
function extractBracketReference(value) {
  if (typeof value !== 'string') return null;
  const match = PLACEHOLDER_PATTERN.exec(value.trim());
  return match ? Number(match[1]) : null;
}

// Returns a new fixture object whose homeTeam/awayTeam placeholders are
// replaced with the current resolved team name from the upstream final in
// `fixtures`. Pure: does not mutate `fixture` or `fixtures`. Unresolvable
// placeholders (upstream not final, or a chain that doesn't bottom out) are
// left as-is. Cycle-protected so a malformed token chain cannot loop.
function resolveFixtureTeams(fixtures, fixture) {
  if (!fixture) return fixture;
  if (!Array.isArray(fixtures)) return { ...fixture };

  const cache = new Map();
  const visiting = new Set();

  function resolveToken(token) {
    if (typeof token !== 'string') return token;
    const refMatch = PLACEHOLDER_PATTERN.exec(token.trim());
    if (!refMatch) return token;

    const cacheKey = token.trim();
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    if (visiting.has(cacheKey)) return token;
    visiting.add(cacheKey);

    const matchNumber = Number(refMatch[1]);
    const kind = cacheKey[0];
    const upstream = fixtures.find((candidate) => candidate.matchNumber === matchNumber);
    let result = token;
    if (upstream) {
      const resolved = resolveAdvancerAndLoser(upstream);
      if (resolved) {
        const name = kind === 'W' ? resolved.advancer : resolved.loser;
        // The resolved name itself may be a placeholder (e.g. a chain
        // W97 -> W89 -> W74). Recurse to fully resolve.
        result = resolveToken(name);
      }
    }

    visiting.delete(cacheKey);
    cache.set(cacheKey, result);
    return result;
  }

  return {
    ...fixture,
    homeTeam: resolveToken(fixture.homeTeam),
    awayTeam: resolveToken(fixture.awayTeam)
  };
}

// Returns a new array of fixtures with placeholders resolved. See
// `resolveFixtureTeams` for the per-fixture semantics.
function resolveKnockoutTeams(fixtures) {
  if (!Array.isArray(fixtures)) return [];
  return fixtures.map((fixture) => resolveFixtureTeams(fixtures, fixture));
}

// Snapshots the resolved team name into the saved fixture when it is being
// finalised (or has just been re-finalised). Returns the list of snapshot
// updates applied to `fixtures` in place.
//
// Also stamps the upstream match number (`homeTeamRef` / `awayTeamRef`) on
// the fixture for every slot whose pre-snapshot value was a placeholder.
// This is the upstream linkage the bracket view needs: once a fixture is
// final the placeholder token in `homeTeam`/`awayTeam` is gone (replaced
// with the concrete advancer name), and without the persisted ref there
// is no way for the decoration layer to know which upstream match fed
// this slot. The ref is derived from the PRE-snapshot value, so it is set
// exactly once — the first time the slot transitions from a placeholder
// to a concrete name (or to "still a placeholder" if the upstream was not
// final at snapshot time; in the latter case the API still resolves it
// on every read, and the ref points the bracket at the right upstream).
//
// Deliberate non-goal: this function does NOT walk downstream fixtures and
// rewrite their placeholders. Downstream placeholders stay as live
// references in the data file; the API response path resolves them on read,
// so a later correction to an upstream result automatically re-propagates
// to every non-final downstream slot. Already-final downstream fixtures are
// explicitly not re-snapshotted from an upstream correction — see the file
// header for the policy rationale.
function propagateKnockoutWinner(fixtures, finishedMatch) {
  if (!Array.isArray(fixtures) || !finishedMatch) return [];
  if (!Number.isInteger(finishedMatch.matchNumber)) return [];
  if (finishedMatch.status !== 'final') return [];

  const previousHomeTeam = finishedMatch.homeTeam;
  const previousAwayTeam = finishedMatch.awayTeam;
  // Persist the upstream match number for any slot that is still a live
  // placeholder. Set BEFORE the snapshot so the ref is captured even when
  // the snapshot itself is a no-op (e.g. upstream not yet final, so the
  // resolved name still equals the placeholder).
  const previousHomeRef = extractBracketReference(previousHomeTeam);
  const previousAwayRef = extractBracketReference(previousAwayTeam);
  if (previousHomeRef !== null) finishedMatch.homeTeamRef = previousHomeRef;
  if (previousAwayRef !== null) finishedMatch.awayTeamRef = previousAwayRef;

  const resolved = resolveFixtureTeams(fixtures, finishedMatch);
  const updates = [];

  if (resolved.homeTeam !== previousHomeTeam || resolved.awayTeam !== previousAwayTeam) {
    finishedMatch.homeTeam = resolved.homeTeam;
    finishedMatch.awayTeam = resolved.awayTeam;
    updates.push({
      matchId: finishedMatch.id,
      matchNumber: finishedMatch.matchNumber,
      phase: finishedMatch.phase,
      previousHomeTeam,
      previousAwayTeam,
      newHomeTeam: resolved.homeTeam,
      newAwayTeam: resolved.awayTeam
    });
  }

  return updates;
}

// Resolves winner/loser placeholder tokens in every fixture and stamps the
// upstream match-number reference on each knockout slot. The API uses this
// for every response that includes fixtures so the client always sees the
// current advancer names while the data file keeps the live reference
// (which is what makes upstream corrections auto-propagate).
//
// The bracket reference is taken from the persisted `homeTeamRef` /
// `awayTeamRef` (stamped at snapshot time by `propagateKnockoutWinner`)
// and falls back to parsing the canonical pre-resolution `homeTeam` /
// `awayTeam` for non-final matches that still hold a live placeholder
// token. After a match is final the placeholder is gone, so the ref MUST
// come from the persisted field — this is the only thing that keeps the
// upstream linkage alive across finalization.
function decorateFixturesForResponse(fixtures) {
  if (!Array.isArray(fixtures)) return [];
  const resolved = resolveKnockoutTeams(fixtures);
  return fixtures.map((canonical, index) => {
    const fixture = resolved[index];
    if (!KNOCKOUT_PHASES.has(fixture.phase)) return fixture;
    const homeTeamRef = Number.isInteger(canonical.homeTeamRef)
      ? canonical.homeTeamRef
      : extractBracketReference(canonical.homeTeam);
    const awayTeamRef = Number.isInteger(canonical.awayTeamRef)
      ? canonical.awayTeamRef
      : extractBracketReference(canonical.awayTeam);
    const refFields = {};
    if (homeTeamRef !== null) refFields.homeTeamRef = homeTeamRef;
    if (awayTeamRef !== null) refFields.awayTeamRef = awayTeamRef;
    if (Object.keys(refFields).length === 0) return fixture;
    return { ...fixture, ...refFields };
  });
}

module.exports = {
  propagateKnockoutWinner,
  resolveFixtureTeams,
  resolveKnockoutTeams,
  resolveAdvancerAndLoser,
  extractBracketReference,
  decorateFixturesForResponse,
  KNOCKOUT_PHASES,
  PLACEHOLDER_PATTERN
};
