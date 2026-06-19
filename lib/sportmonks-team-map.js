// Static translation table: fixtures.json team name (homeTeam/awayTeam) -> SportMonks team id.
//
// IMPORTANT: every id below is a PLACEHOLDER (null).
// TODO: confirm via live SportMonks API call once a paid plan covering the World Cup is active.
// The current account is on the SportMonks Football Free Plan, which only covers a handful of
// minor leagues (Danish Superliga, Scottish Premiership + playoffs) and does NOT cover the
// World Cup. Team search/reference endpoints return empty results under this plan, so real
// ids could not be resolved during this implementation pass.
//
// `isSyncCandidate` in lib/sportmonks-sync.js skips any fixture whose team has no resolved
// (non-null) id, so leaving every entry as `null` makes the sync a safe no-op until this
// table is filled in with real ids.
const TEAM_ID_BY_NAME = {
  Alemania: null,
  'Arabia Saudita': null,
  Argelia: null,
  Argentina: null,
  Australia: null,
  Austria: null,
  'Bosnia y Herzegovina': null,
  Brasil: null,
  Bélgica: null,
  'Cabo Verde': null,
  Canadá: null,
  Catar: null,
  Chequia: null,
  Colombia: null,
  'Corea del Sur': null,
  'Costa de Marfil': null,
  Croacia: null,
  Curazao: null,
  Ecuador: null,
  Egipto: null,
  Escocia: null,
  España: null,
  'Estados Unidos': null,
  Francia: null,
  Ghana: null,
  Haití: null,
  Inglaterra: null,
  Irak: null,
  Irán: null,
  Japón: null,
  Jordania: null,
  Marruecos: null,
  México: null,
  Noruega: null,
  'Nueva Zelanda': null,
  Panamá: null,
  Paraguay: null,
  'Países Bajos': null,
  Portugal: null,
  'República Democrática del Congo': null,
  Senegal: null,
  Sudáfrica: null,
  Suecia: null,
  Suiza: null,
  Turquía: null,
  Túnez: null,
  Uruguay: null,
  Uzbekistán: null
};

function getTeamId(teamName) {
  return Object.prototype.hasOwnProperty.call(TEAM_ID_BY_NAME, teamName) ? TEAM_ID_BY_NAME[teamName] : null;
}

module.exports = { TEAM_ID_BY_NAME, getTeamId };
