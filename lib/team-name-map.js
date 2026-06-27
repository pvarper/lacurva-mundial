// Static translation table: fixtures.json team name (homeTeam/awayTeam) -> the
// worldcup26.ir provider's English team name (home_team_name_en / away_team_name_en).
//
// SYNC-INTERNAL ONLY. This table exists purely to match local fixtures against the
// provider payload inside lib/worldcup-sync.js. The EN values here must never be
// written back to data/fixtures.json or surfaced in any API response/UI — fixtures.json
// homeTeam/awayTeam stay in Spanish, unchanged, always.
//
// Only real group-stage team names are listed here. Knockout-stage placeholder names
// ("2A", "W74", "1E", "L101", etc.) are deliberately absent — their absence is what makes
// isSyncCandidate() in lib/worldcup-sync.js skip them as expected, non-failure exclusions.
//
// Comparison against the provider is case-insensitive + trimmed (see findMatchingProviderRecord
// in lib/worldcup-sync.js), so exact casing here only needs to be readable/correct, not byte-exact.
// EXCEPTION: Curazao -> 'Curaçao' must keep the exact cedilla character — case-insensitive
// compare does NOT fix missing/extra diacritics, only case differences.
const TEAM_NAME_EN_BY_ES = {
  Alemania: 'Germany',
  'Arabia Saudita': 'Saudi Arabia',
  Argelia: 'Algeria',
  Argentina: 'Argentina',
  Australia: 'Australia',
  Austria: 'Austria',
  'Bosnia y Herzegovina': 'Bosnia and Herzegovina',
  Brasil: 'Brazil',
  Bélgica: 'Belgium',
  'Cabo Verde': 'Cape Verde',
  Canadá: 'Canada',
  Catar: 'Qatar',
  Chequia: 'Czech Republic',
  Colombia: 'Colombia',
  'Corea del Sur': 'South Korea',
  'Costa de Marfil': 'Ivory Coast',
  Croacia: 'Croatia',
  Curazao: 'Curaçao',
  Ecuador: 'Ecuador',
  Egipto: 'Egypt',
  Escocia: 'Scotland',
  España: 'Spain',
  'Estados Unidos': 'United States',
  Francia: 'France',
  Ghana: 'Ghana',
  Haití: 'Haiti',
  Inglaterra: 'England',
  Irak: 'Iraq',
  Irán: 'Iran',
  Japón: 'Japan',
  Jordania: 'Jordan',
  Marruecos: 'Morocco',
  México: 'Mexico',
  Noruega: 'Norway',
  'Nueva Zelanda': 'New Zealand',
  Panamá: 'Panama',
  Paraguay: 'Paraguay',
  'Países Bajos': 'Netherlands',
  Portugal: 'Portugal',
  'RD Congo': 'Democratic Republic of the Congo',
  Senegal: 'Senegal',
  Sudáfrica: 'South Africa',
  Suecia: 'Sweden',
  Suiza: 'Switzerland',
  Turquía: 'Turkey',
  Túnez: 'Tunisia',
  Uruguay: 'Uruguay',
  Uzbekistán: 'Uzbekistan'
};

function getEnglishTeamName(teamNameEs) {
  return Object.prototype.hasOwnProperty.call(TEAM_NAME_EN_BY_ES, teamNameEs)
    ? TEAM_NAME_EN_BY_ES[teamNameEs]
    : null;
}

module.exports = { TEAM_NAME_EN_BY_ES, getEnglishTeamName };
