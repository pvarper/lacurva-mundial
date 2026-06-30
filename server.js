const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { startWorldcupSync, stopWorldcupSync } = require('./lib/worldcup-sync');
const { abbreviateTeamName } = require('./lib/team-abbrev');

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET environment variable is required in production.');
}

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_MAX_AGE_MS = Number(process.env.SESSION_MAX_AGE_MS) || 120 * 60 * 1000;
const DATA_DIR = path.join(__dirname, 'data');
const FIXTURE_STATUSES = new Set(['scheduled', 'live', 'final']);
const KNOCKOUT_PHASES = new Set(['16vos', '8vos', '4vos', 'Semifinal', 'Final']);

const SETTINGS_DEFAULTS = {
  predictionLockMs: 1 * 60 * 1000,
  lockoutAttempts: 3,
  lockoutDurationMs: 10 * 60 * 1000,
  maxTemporaryLockouts: 3,
  lockoutResetMs: 60 * 60 * 1000,
  worldcupSync: {
    enabled: false,
    pollIntervalMs: 10 * 1000
  },
  fixtureRefreshMs: 30 * 1000,
  standingsTiebreak: {
    exactCountEnabled: true,
    goalDiffOnThreeEnabled: true,
    goalDiffOnZeroEnabled: true,
    exactPlusAdvancerCountEnabled: true,
    goalDiffOnKnockoutEnabled: true
  },
  standingsPhaseScope: 'all',
  visibilityGroupDetail: true,
  visibilityKnockoutDetail: true
};

let settingsCache = { ...SETTINGS_DEFAULTS };

const rules = [
  { title: 'Resultado exacto', description: 'Si acertás el marcador exacto del partido, sumás 5 puntos.' },
  { title: 'Ganador o empate', description: 'Si acertás el ganador o el empate, pero no el resultado exacto, sumás 3 puntos.' },
  { title: 'Bonus clasificado (desde 16vos)', description: 'A partir de 16vos de final, sumás 3 puntos adicionales si acertás el equipo que clasifica. Si pronosticaste empate, debés elegir explícitamente quién clasifica. Si pronosticaste un ganador, ese equipo es tu clasificado implícito — no necesitás elegirlo por separado. El bonus se suma sobre los puntos base: resultado exacto + clasificador correcto = 8 puntos, ganador correcto (sin exacto) + clasificador correcto = 6 puntos, empate real + clasificador correcto (desde predicción no-empate) = 3 puntos.' },
  { title: 'Tiempo válido para predicciones (desde 16vos)', description: 'A partir de 16vos de final, tu predicción cubre el resultado al final del tiempo reglamentario (90 min) más los dos tiempos suplementarios de 15 min cada uno, si los hubiera. No se considera el resultado de los penales.' },
  { title: 'Sin acierto', description: 'Si no acertás resultado exacto, ganador ni empate, sumás 0 puntos.' },
  { title: 'Cierre de predicciones', description: 'Cada partido se bloquea 1 minuto antes del inicio.' },
  { title: 'Picks especiales', description: 'Campeón (+10), subcampeón (+6) y goleador (+4) se pueden editar hasta 1 minuto antes del primer partido de 8vos.' },
  { title: 'Bonus final', description: 'Los bonus especiales recién se suman cuando la final figure como FINALIZADO. Si varios usuarios aciertan, todos reciben el puntaje completo.' },
  { title: 'Partidos sin resultado final', description: 'Los partidos sin marcador final todavía no suman puntos.' },
  { title: 'Desempate 1 (fase de grupos): aciertos exactos', description: 'Si dos o más usuarios empatan en puntos, gana quien tenga más resultados exactos (5 puntos) en partidos de fase de grupos.', settingsKey: 'exactCountEnabled', phaseScope: 'groups' },
  { title: 'Desempate 2 (fase de grupos): diferencia de gol en aciertos de 3 puntos', description: 'Si persiste el empate, gana quien tenga menor diferencia de gol acumulada en los partidos de fase de grupos donde acertó ganador o empate sin el resultado exacto.', settingsKey: 'goalDiffOnThreeEnabled', phaseScope: 'groups' },
  { title: 'Desempate 3 (fase de grupos): diferencia de gol en partidos sin acierto', description: 'Si persiste el empate, gana quien tenga menor diferencia de gol acumulada en los partidos de fase de grupos donde no sumó puntos.', settingsKey: 'goalDiffOnZeroEnabled', phaseScope: 'groups' },
  { title: 'Desempate 4 (16vos en adelante): aciertos exacto + clasificado (8 pts)', description: 'Una vez que empieza la fase eliminatoria, este set de reglas reemplaza a las 3 anteriores. Gana quien tenga más partidos de 16vos/8vos/4tos/semifinal/final donde acertó marcador exacto Y equipo clasificado (8 puntos: 5 base + 3 bonus).', settingsKey: 'exactPlusAdvancerCountEnabled', phaseScope: 'knockout' },
  { title: 'Desempate 5 (16vos en adelante): diferencia de gol acumulada', description: 'Si persiste el empate, gana quien tenga menor diferencia de gol acumulada en los partidos eliminatorios. Para cada partido de 16vos/8vos/4tos/semifinal/final se suma la diferencia absoluta entre su predicción y el resultado real; si el usuario NO presentó predicción para ese partido, se suma la cantidad total de goles reales del partido (suma del marcador final).', settingsKey: 'goalDiffOnKnockoutEnabled', phaseScope: 'knockout' },
  { title: 'Desempate final: división del premio', description: 'Si el empate persiste después de aplicar las reglas activas de la fase actual, el monto correspondiente se divide en partes iguales entre los usuarios empatados.' }
];

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      fontSrc: ["'self'", 'https://cdn.jsdelivr.net', 'data:'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'https://cdn.jsdelivr.net'],
      ...(process.env.NODE_ENV !== 'production' && { 'upgrade-insecure-requests': null })
    }
  }
}));
app.use(express.json());
app.use(session({
  name: 'lacurva.sid',
  secret: process.env.SESSION_SECRET || 'change-this-session-secret-for-production',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE_MS
  }
}));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/flag-icons', express.static(path.join(__dirname, 'node_modules/flag-icons')));

async function readJson(fileName) {
  const filePath = path.join(DATA_DIR, fileName);
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content);
}

const writeLocks = new Map();

async function writeJson(fileName, data) {
  const pending = writeLocks.get(fileName) ?? Promise.resolve();
  let releaseLock;
  const acquired = new Promise((resolve) => { releaseLock = resolve; });
  writeLocks.set(fileName, pending.then(() => acquired));

  await pending;
  try {
    const filePath = path.join(DATA_DIR, fileName);
    const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`);
    await fs.rename(tempPath, filePath);
  } finally {
    releaseLock();
  }
}

async function readAuditLogs() {
  try {
    return await readJson('audit-log.json');
  } catch (error) {
    console.error('Could not read audit log:', error.message);
    return [];
  }
}

async function loadSettings() {
  try {
    const stored = await readJson('settings.json');
    settingsCache = {
      ...SETTINGS_DEFAULTS,
      ...stored,
      worldcupSync: { ...SETTINGS_DEFAULTS.worldcupSync, ...stored.worldcupSync },
      standingsTiebreak: { ...SETTINGS_DEFAULTS.standingsTiebreak, ...stored.standingsTiebreak }
    };
  } catch (error) {
    console.error('Could not read settings, falling back to defaults:', error.message);
    settingsCache = { ...SETTINGS_DEFAULTS };
    await writeJson('settings.json', settingsCache);
  }
}

async function applySettings(newSettings) {
  const previous = settingsCache;
  settingsCache = newSettings;
  await writeJson('settings.json', newSettings);

  const syncChanged = !previous ||
    previous.worldcupSync.enabled !== newSettings.worldcupSync.enabled ||
    previous.worldcupSync.pollIntervalMs !== newSettings.worldcupSync.pollIntervalMs;

  if (syncChanged) {
    stopWorldcupSync();
    startWorldcupSync({ readJson, writeJson }, newSettings.worldcupSync);
  }
}

function scrypt(password, salt, keylen) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)).toString('hex');
  return `${salt}:${hash}`;
}

async function verifyPassword(password, storedHash) {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const attemptedHash = await scrypt(password, salt, 64);
  const savedHash = Buffer.from(hash, 'hex');
  return savedHash.length === attemptedHash.length && crypto.timingSafeEqual(savedHash, attemptedHash);
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    active: user.active !== false,
    permanentlyBlocked: user.permanentlyBlocked === true,
    lockedUntil: user.lockedUntil || null
  };
}

const BOLIVIA_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' });

function boliviaDateOf(timestamp) {
  return BOLIVIA_DATE_FORMATTER.format(new Date(timestamp));
}

function todayBoliviaDate() {
  return BOLIVIA_DATE_FORMATTER.format(new Date());
}

async function recordAuditLog(req, action, detail = {}) {
  try {
    const logs = await readAuditLogs();
    logs.push({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      userId: req.session?.user?.id || detail.userId || null,
      username: req.session?.user?.username || detail.username || null,
      role: req.session?.user?.role || detail.role || null,
      action,
      detail,
      ip: req.ip
    });
    await writeJson('audit-log.json', logs);
  } catch (error) {
    console.error('Could not write audit log:', error.message);
  }
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  return next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  return next();
}

function getLockoutStatus(user) {
  if (user.permanentlyBlocked) return { blocked: true, permanent: true, remainingMs: null };
  if (user.lockedUntil) {
    const remainingMs = new Date(user.lockedUntil).getTime() - Date.now();
    if (remainingMs > 0) return { blocked: true, permanent: false, remainingMs };
  }
  return { blocked: false };
}

function resetStaleCounters(user) {
  if (user.permanentlyBlocked) return false;
  const lastFailed = user.lastFailedAt ? new Date(user.lastFailedAt).getTime() : null;
  if (!lastFailed) return false;
  if (Date.now() - lastFailed < settingsCache.lockoutResetMs) return false;
  user.failedAttempts = 0;
  user.lockedUntil = null;
  user.temporaryLockoutCount = 0;
  user.lastFailedAt = null;
  return true;
}

async function recordFailedAttempt(user, users) {
  user.lastFailedAt = new Date().toISOString();
  user.failedAttempts = (user.failedAttempts || 0) + 1;
  if (user.failedAttempts >= settingsCache.lockoutAttempts) {
    user.lockedUntil = new Date(Date.now() + settingsCache.lockoutDurationMs).toISOString();
    user.failedAttempts = 0;
    user.temporaryLockoutCount = (user.temporaryLockoutCount || 0) + 1;
    if (user.temporaryLockoutCount >= settingsCache.maxTemporaryLockouts) {
      user.permanentlyBlocked = true;
    }
  }
  await writeJson('users.json', users);
}

async function clearFailedAttempts(user, users) {
  user.failedAttempts = 0;
  user.lockedUntil = null;
  user.temporaryLockoutCount = 0;
  await writeJson('users.json', users);
}

function isPredictionLocked(match) {
  return match.status !== 'scheduled' ||
    new Date(match.date).getTime() - Date.now() <= settingsCache.predictionLockMs;
}

function getPicksLockState(fixtures) {
  const roundOf8 = fixtures
    .filter((fixture) => fixture.phase === '8vos')
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!roundOf8.length) {
    return {
      locked: false,
      lockAt: null,
      firstR8Kickoff: null
    };
  }

  const firstR8Kickoff = roundOf8[0].date;
  const lockAtDate = new Date(new Date(firstR8Kickoff).getTime() - 60 * 1000);

  return {
    locked: Date.now() >= lockAtDate.getTime(),
    lockAt: lockAtDate.toISOString(),
    firstR8Kickoff
  };
}

function getPicksOptions(fixtures, scorers) {
  const teams = new Set();
  const r16 = (fixtures || []).filter((fixture) => fixture.phase === '16vos');
  for (const fixture of r16) {
    for (const key of ['homeTeam', 'awayTeam']) {
      const value = String(fixture[key] || '').trim();
      if (value) teams.add(value);
    }
  }
  const scorerNames = new Set();
  for (const scorer of scorers || []) {
    const name = String(scorer && scorer.playerName || '').trim();
    if (name) scorerNames.add(name);
  }
  return {
    teams: [...teams].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })),
    scorerNames: [...scorerNames].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
  };
}

function validatePicksBody(body = {}, { teams = [], scorerNames = [] } = {}) {
  const fields = ['champion', 'runnerUp', 'topScorer'];
  const normalized = {};
  const teamSet = new Set(teams);
  const scorerSet = new Set(scorerNames);

  for (const field of fields) {
    const value = String(body[field] || '').trim();
    if (!value || value.length > 80) {
      return {
        ok: false,
        error: `${field} must be between 1 and 80 characters.`
      };
    }
    normalized[field] = value;
  }

  if (!teamSet.has(normalized.champion)) {
    return {
      ok: false,
      error: 'El campeón debe ser uno de los equipos disponibles.'
    };
  }

  if (!teamSet.has(normalized.runnerUp)) {
    return {
      ok: false,
      error: 'El subcampeón debe ser uno de los equipos disponibles.'
    };
  }

  if (!scorerSet.has(normalized.topScorer)) {
    return {
      ok: false,
      error: 'El goleador debe ser uno de los goleadores disponibles.'
    };
  }

  if (normalized.champion === normalized.runnerUp) {
    return {
      ok: false,
      error: 'El campeón y el subcampeón no pueden ser el mismo equipo.'
    };
  }

  return { ok: true, value: normalized };
}

function validateScorerBody(body = {}) {
  const playerName = String(body.playerName || '').trim();
  const team = String(body.team || '').trim();
  const goals = Number(body.goals);
  const matchesPlayed = Number(body.matchesPlayed);

  if (!playerName || playerName.length > 80) {
    return { ok: false, error: 'playerName must be between 1 and 80 characters.' };
  }

  if (!team || team.length > 80) {
    return { ok: false, error: 'team must be between 1 and 80 characters.' };
  }

  if (!Number.isInteger(goals) || goals < 0) {
    return { ok: false, error: 'goals must be a non-negative integer.' };
  }

  if (!Number.isInteger(matchesPlayed) || matchesPlayed < 0) {
    return { ok: false, error: 'matchesPlayed must be a non-negative integer.' };
  }

  return {
    ok: true,
    value: {
      playerName,
      team,
      goals,
      matchesPlayed
    }
  };
}

function formatPopupPickRow(row) {
  return {
    userId: row.userId,
    user: row.username,
    champion: row.champion,
    runnerUp: row.runnerUp,
    topScorer: row.topScorer,
    updatedBy: row.updatedBy || null,
    updatedAt: row.updatedAt || null
  };
}

function normalizeComparisonValue(value) {
  return String(value || '').trim().toLocaleLowerCase('es');
}

function getFinalBonusOutcome(fixtures, scorers) {
  const finalMatch = fixtures.find((fixture) => fixture.roundName === 'Final')
    || fixtures.find((fixture) => fixture.phase === 'Final' && fixture.matchNumber === 104);
  if (!finalMatch || finalMatch.status !== 'final') {
    return {
      isFinalComplete: false,
      champion: null,
      runnerUp: null,
      topScorers: []
    };
  }

  let champion = null;
  let runnerUp = null;
  if (finalMatch.homeScore > finalMatch.awayScore) {
    champion = finalMatch.homeTeam;
    runnerUp = finalMatch.awayTeam;
  } else if (finalMatch.awayScore > finalMatch.homeScore) {
    champion = finalMatch.awayTeam;
    runnerUp = finalMatch.homeTeam;
  }

  const topGoalCount = scorers.reduce((maxGoals, scorer) => Math.max(maxGoals, scorer.goals || 0), -1);
  const topScorers = topGoalCount < 0
    ? []
    : scorers
      .filter((scorer) => scorer.goals === topGoalCount)
      .map((scorer) => scorer.playerName);

  return {
    isFinalComplete: true,
    champion,
    runnerUp,
    topScorers
  };
}

function calculatePickBonus(pick, outcome) {
  if (!pick || !outcome.isFinalComplete) return 0;

  let bonusPoints = 0;
  const champion = normalizeComparisonValue(outcome.champion);
  const runnerUp = normalizeComparisonValue(outcome.runnerUp);
  const topScorers = new Set(outcome.topScorers.map(normalizeComparisonValue));

  if (champion && normalizeComparisonValue(pick.champion) === champion) bonusPoints += 10;
  if (runnerUp && normalizeComparisonValue(pick.runnerUp) === runnerUp) bonusPoints += 6;
  if (topScorers.size && topScorers.has(normalizeComparisonValue(pick.topScorer))) bonusPoints += 4;

  return bonusPoints;
}

function buildStandingsRows(users, fixtures, predictions, picks, scorers, phaseScope = 'all') {
  const includePhase = (match) => {
    const isKnockout = KNOCKOUT_PHASES.has(match.phase);
    if (phaseScope === 'groups') return !isKnockout;
    if (phaseScope === 'knockout') return isKnockout;
    return true;
  };
  const userIdsWithPhasePredictions = computeUserIdsWithPhasePredictions(fixtures, predictions, phaseScope);
  const liveMatches = fixtures
    .filter((match) => match.status === 'live' && includePhase(match))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 2)
    .map((match) => ({
      id: match.id,
      matchNumber: match.matchNumber,
      date: match.date,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeTeamShort: abbreviateTeamName(match.homeTeam),
      awayTeamShort: abbreviateTeamName(match.awayTeam),
      homeScore: match.homeScore,
      awayScore: match.awayScore
    }));
  const picksByUserId = new Map(picks.map((pick) => [pick.userId, pick]));
  const bonusOutcome = getFinalBonusOutcome(fixtures, scorers);

  const standings = users.filter((user) => {
    if (user.role === 'admin') return false;
    if (user.active !== false) return true;
    return userIdsWithPhasePredictions.has(user.id);
  }).map((user) => {
    const userPredictions = predictions.filter((prediction) => prediction.userId === user.id);
    const userPredictionByMatchId = new Map(userPredictions.map((prediction) => [prediction.matchId, prediction]));
    let points = 0;
    let exactCount = 0;
    let threeCount = 0;
    let zeroCount = 0;
    let goalDiffOnThree = 0;
    let goalDiffOnZero = 0;
    let exactPlusAdvancerCount = 0;
    let sixCount = 0;
    let goalDiffOnKnockout = 0;
    let fiveCount = 0;

    userPredictions.forEach((prediction) => {
      const match = fixtures.find((candidate) => candidate.id === prediction.matchId);
      if (!match) return;
      if (!includePhase(match)) return;
      const predictionPoints = calculatePredictionPoints(prediction, match);
      const advancerBonus = calculateAdvancerBonus(prediction, match);
      const totalMatchPoints = predictionPoints + advancerBonus;
      points += totalMatchPoints;
      if (match.status !== 'final' || match.homeScore === null || match.awayScore === null) return;
      const isKnockout = KNOCKOUT_PHASES.has(match.phase);
      if (!isKnockout) {
        if (predictionPoints === 5) {
          exactCount += 1;
        } else if (predictionPoints === 3) {
          threeCount += 1;
          goalDiffOnThree += predictionGoalDiff(prediction, match);
        } else {
          zeroCount += 1;
          goalDiffOnZero += predictionGoalDiff(prediction, match);
        }
      } else {
        if (totalMatchPoints === 8) {
          exactPlusAdvancerCount += 1;
        } else if (totalMatchPoints === 6) {
          sixCount += 1;
        } else if (totalMatchPoints === 5) {
          fiveCount += 1;
        } else if (totalMatchPoints === 3) {
          threeCount += 1;
        } else {
          zeroCount += 1;
        }
      }
    });

    // R5 (16vos en adelante): lower accumulated goal difference across ALL
    // knockout matches in scope. For each final knockout match the user
    // predicted, add the absolute difference between prediction and actual
    // result on each side. For each final knockout match the user did NOT
    // predict, add the total real goals scored (home + away) in that match.
    fixtures.forEach((match) => {
      if (!includePhase(match)) return;
      if (!KNOCKOUT_PHASES.has(match.phase)) return;
      if (match.status !== 'final' || match.homeScore === null || match.awayScore === null) return;
      const prediction = userPredictionByMatchId.get(match.id);
      if (prediction) {
        goalDiffOnKnockout += predictionGoalDiff(prediction, match);
      } else {
        goalDiffOnKnockout += match.homeScore + match.awayScore;
      }
    });

    const pick = picksByUserId.get(user.id) || null;
    const bonusPoints = calculatePickBonus(pick, bonusOutcome);
    const livePredictions = Object.fromEntries(liveMatches.map((match) => [
      match.id,
      userPredictions.find((prediction) => prediction.matchId === match.id) || null
    ]));

    return {
      userId: user.id,
      username: user.username,
      points,
      bonusPoints,
      totalPoints: points + bonusPoints,
      exactCount,
      threeCount,
      zeroCount,
      goalDiffOnThree,
      goalDiffOnZero,
      exactPlusAdvancerCount,
      sixCount,
      goalDiffOnKnockout,
      fiveCount,
      livePredictions,
      pick
    };
  });

  const tiebreak = settingsCache.standingsTiebreak || SETTINGS_DEFAULTS.standingsTiebreak;
  const currentPhase = fixtures.some((m) => KNOCKOUT_PHASES.has(m.phase) && m.status === 'final')
    ? 'knockout'
    : 'groups';
  function compareRank(a, b) {
    const pointsDiff = b.points - a.points;
    if (pointsDiff !== 0) return pointsDiff;
    if (currentPhase === 'knockout') {
      return (
        (tiebreak.exactPlusAdvancerCountEnabled ? b.exactPlusAdvancerCount - a.exactPlusAdvancerCount : 0) ||
        (tiebreak.goalDiffOnKnockoutEnabled ? a.goalDiffOnKnockout - b.goalDiffOnKnockout : 0)
      );
    }
    return (
      (tiebreak.exactCountEnabled ? b.exactCount - a.exactCount : 0) ||
      (tiebreak.goalDiffOnThreeEnabled ? a.goalDiffOnThree - b.goalDiffOnThree : 0) ||
      (tiebreak.goalDiffOnZeroEnabled ? a.goalDiffOnZero - b.goalDiffOnZero : 0)
    );
  }

  standings.sort((a, b) => compareRank(a, b) || a.username.localeCompare(b.username));
  let rank = 1;
  standings.forEach((row, index) => {
    if (index > 0 && compareRank(standings[index - 1], row) !== 0) rank += 1;
    row.rank = rank;
  });

  return { standings, liveMatches };
}

function getOutcome(homeScore, awayScore) {
  if (homeScore > awayScore) return 'home';
  if (homeScore < awayScore) return 'away';
  return 'draw';
}

function computeUserIdsWithPhasePredictions(fixtures, predictions, phaseScope) {
  const userHasGroups = new Set();
  const userHasKnockout = new Set();
  const phaseByFixtureId = new Map(fixtures.map((f) => [f.id, f.phase]));
  for (const prediction of predictions) {
    const phase = phaseByFixtureId.get(prediction.matchId);
    if (!phase) continue;
    if (KNOCKOUT_PHASES.has(phase)) userHasKnockout.add(prediction.userId);
    else if (phase === 'Fase de Grupos') userHasGroups.add(prediction.userId);
  }
  if (phaseScope === 'groups') return userHasGroups;
  if (phaseScope === 'knockout') return userHasKnockout;
  return new Set([...userHasGroups, ...userHasKnockout]);
}

function calculatePredictionPoints(prediction, match) {
  if (match.status !== 'final' || match.homeScore === null || match.awayScore === null) return 0;
  const exactScore = prediction.homeScore === match.homeScore && prediction.awayScore === match.awayScore;
  if (exactScore) return 5;
  const predictedOutcome = getOutcome(prediction.homeScore, prediction.awayScore);
  const actualOutcome = getOutcome(match.homeScore, match.awayScore);
  return predictedOutcome === actualOutcome ? 3 : 0;
}

function calculateAdvancerBonus(prediction, match) {
  if (!KNOCKOUT_PHASES.has(match.phase)) return 0;
  if (match.status !== 'final' || match.homeScore === null || match.awayScore === null) return 0;

  const actualOutcome = getOutcome(match.homeScore, match.awayScore);
  // Draw result requires explicit advancer (set by admin after penalties)
  if (actualOutcome === 'draw' && !match.advancer) return 0;
  const actualAdvancer = match.advancer || (actualOutcome === 'home' ? match.homeTeam : match.awayTeam);

  const predictedOutcome = getOutcome(prediction.homeScore, prediction.awayScore);
  let predictedAdvancer;

  if (predictedOutcome === 'draw') {
    if (!prediction.advancer) return 0;
    predictedAdvancer = prediction.advancer;
  } else {
    predictedAdvancer = predictedOutcome === 'home' ? match.homeTeam : match.awayTeam;
  }

  return predictedAdvancer === actualAdvancer ? 3 : 0;
}

function predictionGoalDiff(prediction, match) {
  return Math.abs(prediction.homeScore - match.homeScore) + Math.abs(prediction.awayScore - match.awayScore);
}

function parseFixtureScore(value) {
  if (value === null || value === '') return null;
  const score = Number(value);
  return Number.isInteger(score) && score >= 0 ? score : NaN;
}

const loginLimiter = rateLimit({
  windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts. Please try again later.' }
});

app.post('/api/login', loginLimiter, asyncHandler(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (username.length === 0 || username.length > 64 || password.length === 0 || password.length > 128) {
    return res.status(400).json({ error: 'Invalid credentials format.' });
  }

  const users = await readJson('users.json');
  const user = users.find((candidate) => candidate.username.toLowerCase() === username.toLowerCase());

  if (!user || user.active === false) {
    await recordAuditLog(req, 'login_failed', { username });
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  if (resetStaleCounters(user)) await writeJson('users.json', users);

  const lockout = getLockoutStatus(user);
  if (lockout.blocked) {
    if (lockout.permanent) {
      await recordAuditLog(req, 'login_blocked_permanent', { username });
      return res.status(423).json({ error: 'Your account has been permanently blocked. Contact an administrator.' });
    }
    const remainingSecs = Math.ceil(lockout.remainingMs / 1000);
    await recordAuditLog(req, 'login_blocked_temporary', { username, remainingSecs });
    return res.status(423).json({ error: `Account temporarily locked. Try again in ${remainingSecs} seconds.`, remainingSecs });
  }

  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk) {
    await recordFailedAttempt(user, users);
    const lockoutAfter = getLockoutStatus(user);
    await recordAuditLog(req, 'login_failed', { username, failedAttempts: user.failedAttempts, temporaryLockoutCount: user.temporaryLockoutCount });
    if (lockoutAfter.blocked && lockoutAfter.permanent) {
      return res.status(423).json({ error: 'Your account has been permanently blocked. Contact an administrator.' });
    }
    if (lockoutAfter.blocked) {
      return res.status(423).json({ error: `Account temporarily locked for ${settingsCache.lockoutDurationMs / 60000} minutes due to repeated failed attempts.`, remainingSecs: Math.ceil(settingsCache.lockoutDurationMs / 1000) });
    }
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  await clearFailedAttempts(user, users);
  req.session.regenerate((error) => {
    if (error) return res.status(500).json({ error: 'Could not create session.' });
    req.session.user = sanitizeUser(user);
    recordAuditLog(req, 'login_success', { userId: user.id, username: user.username, role: user.role });
    return res.json({ user: req.session.user });
  });
}));

app.post('/api/logout', requireAuth, (req, res) => {
  const user = req.session.user;
  const ip = req.ip;
  req.session.destroy((error) => {
    if (error) return res.status(500).json({ error: 'Could not close session.' });
    res.clearCookie('lacurva.sid');
    recordAuditLog({ session: { user }, ip }, 'logout', { userId: user.id, username: user.username, role: user.role });
    return res.json({ ok: true });
  });
});

app.post('/api/audit/navigation', requireAuth, asyncHandler(async (req, res) => {
  const view = String(req.body.view || '').trim();
  const publicViews = ['fixturesView', 'predictionsView', 'picksView', 'standingsView', 'standingsDetailView', 'standingsDetailKnockoutView', 'rulesView', 'activityView', 'scorersView'];
  const adminViews = ['usersView', 'auditView', 'settingsView'];
  if (!publicViews.includes(view) && !adminViews.includes(view)) {
    return res.status(400).json({ error: 'Invalid view.' });
  }
  if (adminViews.includes(view) && req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  // Mirror the data-enforcement guard so a non-admin cannot fire audit
  // events for a detail table that the admin has hidden. Admins are always
  // allowed, matching the data path.
  if (req.session.user.role !== 'admin') {
    if (view === 'standingsDetailView' && settingsCache.visibilityGroupDetail === false) {
      return res.status(403).json({ error: 'This standings table is not available for your account.' });
    }
    if (view === 'standingsDetailKnockoutView' && settingsCache.visibilityKnockoutDetail === false) {
      return res.status(403).json({ error: 'This standings table is not available for your account.' });
    }
  }
  await recordAuditLog(req, 'menu_viewed', { view });
  res.json({ ok: true });
}));

app.get('/api/audit-log', requireAdmin, asyncHandler(async (req, res) => {
  const logs = await readAuditLogs();
  const requestedDate = req.query.date;

  if (requestedDate === 'all') {
    return res.json(logs.slice().reverse());
  }

  let targetDate = todayBoliviaDate();
  if (requestedDate !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(requestedDate))) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }
    targetDate = requestedDate;
  }

  const filtered = logs.filter((entry) => boliviaDateOf(entry.timestamp) === targetDate);
  return res.json(filtered.slice().reverse());
}));

app.get('/api/session', (req, res) => {
  res.json({ user: req.session.user || null, inactivityLimitMs: SESSION_MAX_AGE_MS, fixtureRefreshMs: settingsCache.fixtureRefreshMs });
});

app.get('/api/users', requireAdmin, asyncHandler(async (req, res) => {
  const users = await readJson('users.json');
  res.json(users.map(sanitizeUser));
}));

app.post('/api/users', requireAdmin, asyncHandler(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const role = req.body.role === 'admin' ? 'admin' : 'user';

  if (username.length < 3 || password.length < 6) {
    return res.status(400).json({ error: 'Username must have 3 characters and password must have 6 characters.' });
  }

  const users = await readJson('users.json');
  const exists = users.some((user) => user.username.toLowerCase() === username.toLowerCase());
  if (exists) return res.status(409).json({ error: 'Username already exists.' });

  const user = {
    id: crypto.randomUUID(),
    username,
    role,
    active: true,
    passwordHash: await hashPassword(password),
    failedAttempts: 0,
    lockedUntil: null,
    temporaryLockoutCount: 0,
    permanentlyBlocked: false
  };
  users.push(user);
  await writeJson('users.json', users);
  await recordAuditLog(req, 'user_created', { targetUserId: user.id, targetUsername: user.username, targetRole: user.role });
  return res.status(201).json({ user: sanitizeUser(user) });
}));

app.put('/api/users/:id', requireAdmin, asyncHandler(async (req, res) => {
  const userId = String(req.params.id || '');
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const role = req.body.role === 'admin' ? 'admin' : 'user';
  const active = req.body.active !== false;

  if (username.length < 3) {
    return res.status(400).json({ error: 'Username must have at least 3 characters.' });
  }
  if (password && password.length < 6) {
    return res.status(400).json({ error: 'Password must have at least 6 characters.' });
  }

  const users = await readJson('users.json');
  const user = users.find((candidate) => candidate.id === userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const usernameTaken = users.some((candidate) => candidate.id !== userId && candidate.username.toLowerCase() === username.toLowerCase());
  if (usernameTaken) return res.status(409).json({ error: 'Username already exists.' });
  if (user.id === req.session.user.id && (!active || role !== 'admin')) {
    return res.status(400).json({ error: 'You cannot remove your own admin access.' });
  }

  user.username = username;
  user.role = role;
  user.active = active;
  if (password) user.passwordHash = await hashPassword(password);
  await writeJson('users.json', users);
  if (user.id === req.session.user.id) req.session.user = sanitizeUser(user);
  await recordAuditLog(req, 'user_updated', { targetUserId: user.id, targetUsername: user.username, targetRole: user.role, active: user.active !== false, passwordChanged: Boolean(password) });
  return res.json({ user: sanitizeUser(user) });
}));

app.patch('/api/users/:id/deactivate', requireAdmin, asyncHandler(async (req, res) => {
  const userId = String(req.params.id || '');
  const users = await readJson('users.json');
  const user = users.find((candidate) => candidate.id === userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.id === req.session.user.id) {
    return res.status(400).json({ error: 'You cannot deactivate your own user.' });
  }
  user.active = false;
  await writeJson('users.json', users);
  await recordAuditLog(req, 'user_deactivated', { targetUserId: user.id, targetUsername: user.username });
  return res.json({ user: sanitizeUser(user) });
}));

app.patch('/api/users/:id/unblock', requireAdmin, asyncHandler(async (req, res) => {
  const userId = String(req.params.id || '');
  const users = await readJson('users.json');
  const user = users.find((candidate) => candidate.id === userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  user.permanentlyBlocked = false;
  user.lockedUntil = null;
  user.failedAttempts = 0;
  user.temporaryLockoutCount = 0;
  await writeJson('users.json', users);
  await recordAuditLog(req, 'user_unblocked', { targetUserId: user.id, targetUsername: user.username });
  return res.json({ user: sanitizeUser(user) });
}));

app.get('/api/fixtures', requireAuth, asyncHandler(async (req, res) => {
  const fixtures = await readJson('fixtures.json');
  const date = String(req.query.date || '').trim();
  const team = String(req.query.team || '').trim().toLowerCase();
  const phase = String(req.query.phase || '').trim();
  const filtered = fixtures.filter((match) => {
    const matchesDate = !date || match.boliviaDate === date;
    const matchesTeam = !team || match.homeTeam.toLowerCase().includes(team) || match.awayTeam.toLowerCase().includes(team);
    const matchesPhase = !phase || match.phase === phase;
    return matchesDate && matchesTeam && matchesPhase;
  });
  res.json(filtered.map((match) => ({ ...match, locked: isPredictionLocked(match) })));
}));

app.put('/api/fixtures/:id', requireAdmin, asyncHandler(async (req, res) => {
  const matchId = String(req.params.id || '');
  const status = String(req.body.status || '').trim();
  const homeScore = parseFixtureScore(req.body.homeScore);
  const awayScore = parseFixtureScore(req.body.awayScore);

  if (!FIXTURE_STATUSES.has(status)) {
    return res.status(400).json({ error: 'Invalid fixture status.' });
  }
  if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) {
    return res.status(400).json({ error: 'Scores must be non-negative integers.' });
  }
  if ((status === 'live' || status === 'final') && (homeScore === null || awayScore === null)) {
    return res.status(400).json({ error: 'Live and final matches require both scores.' });
  }

  const fixtures = await readJson('fixtures.json');
  const match = fixtures.find((candidate) => candidate.id === matchId);
  if (!match) return res.status(404).json({ error: 'Match not found.' });

  const isKnockoutMatch = KNOCKOUT_PHASES.has(match.phase);
  const isDrawResult = homeScore !== null && awayScore !== null && homeScore === awayScore && status === 'final';
  let advancer = null;
  let penaltyHomeScore = null;
  let penaltyAwayScore = null;
  if (isKnockoutMatch && isDrawResult) {
    advancer = String(req.body.advancer || '').trim() || null;
    if (advancer && advancer !== match.homeTeam && advancer !== match.awayTeam) {
      return res.status(400).json({ error: 'advancer must be one of the match teams.' });
    }
    const rawPh = req.body.penaltyHomeScore;
    const rawPa = req.body.penaltyAwayScore;
    const ph = rawPh !== null && rawPh !== undefined && rawPh !== '' ? Number(rawPh) : null;
    const pa = rawPa !== null && rawPa !== undefined && rawPa !== '' ? Number(rawPa) : null;
    if ((ph !== null && (!Number.isInteger(ph) || ph < 0)) || (pa !== null && (!Number.isInteger(pa) || pa < 0))) {
      return res.status(400).json({ error: 'Penalty scores must be non-negative integers.' });
    }
    if ((ph !== null) !== (pa !== null)) {
      return res.status(400).json({ error: 'Both penalty scores must be provided together.' });
    }
    penaltyHomeScore = ph;
    penaltyAwayScore = pa;
  }

  const previousValue = { status: match.status, homeScore: match.homeScore, awayScore: match.awayScore, advancer: match.advancer, penaltyHomeScore: match.penaltyHomeScore, penaltyAwayScore: match.penaltyAwayScore };
  match.status = status;
  match.homeScore = homeScore;
  match.awayScore = awayScore;
  match.advancer = advancer;
  match.penaltyHomeScore = penaltyHomeScore;
  match.penaltyAwayScore = penaltyAwayScore;
  await writeJson('fixtures.json', fixtures);
  await recordAuditLog(req, 'fixture_updated', {
    matchId,
    matchNumber: match.matchNumber,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    previousValue,
    homeScore,
    awayScore,
    advancer,
    penaltyHomeScore,
    penaltyAwayScore,
    status
  });
  res.json({ match: { ...match, locked: isPredictionLocked(match) } });
}));

app.get('/api/predictions', requireAuth, asyncHandler(async (req, res) => {
  const [fixtures, predictions] = await Promise.all([readJson('fixtures.json'), readJson('predictions.json')]);
  const userPredictions = predictions.filter((prediction) => prediction.userId === req.session.user.id);
  const merged = fixtures.map((match) => ({
    ...match,
    locked: isPredictionLocked(match),
    prediction: userPredictions.find((prediction) => prediction.matchId === match.id) || null
  }));
  res.json(merged);
}));

app.post('/api/predictions', requireAuth, asyncHandler(async (req, res) => {
  const matchId = String(req.body.matchId || '');
  const homeScore = Number(req.body.homeScore);
  const awayScore = Number(req.body.awayScore);

  if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0) {
    return res.status(400).json({ error: 'Scores must be non-negative integers.' });
  }

  const fixtures = await readJson('fixtures.json');
  const match = fixtures.find((candidate) => candidate.id === matchId);
  if (!match) return res.status(404).json({ error: 'Match not found.' });
  if (isPredictionLocked(match)) return res.status(423).json({ error: 'This match is locked for predictions.' });

  const isKnockout = KNOCKOUT_PHASES.has(match.phase);
  const isDraw = homeScore === awayScore;
  let advancer = null;
  if (isKnockout && isDraw) {
    advancer = String(req.body.advancer || '').trim() || null;
    if (!advancer) {
      return res.status(400).json({ error: 'advancer is required for knockout draws.' });
    }
    if (advancer !== match.homeTeam && advancer !== match.awayTeam) {
      return res.status(400).json({ error: 'advancer must be one of the match teams.' });
    }
  }

  const predictions = await readJson('predictions.json');
  const existing = predictions.find((prediction) => prediction.userId === req.session.user.id && prediction.matchId === matchId);
  const action = existing ? 'prediction_updated' : 'prediction_created';

  if (existing) {
    existing.homeScore = homeScore;
    existing.awayScore = awayScore;
    existing.advancer = advancer;
    existing.updatedAt = new Date().toISOString();
  } else {
    predictions.push({
      id: crypto.randomUUID(),
      userId: req.session.user.id,
      matchId,
      homeScore,
      awayScore,
      advancer,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  await writeJson('predictions.json', predictions);
  await recordAuditLog(req, action, { matchId, matchNumber: match.matchNumber, homeTeam: match.homeTeam, awayTeam: match.awayTeam, homeScore, awayScore, advancer });
  res.json({ ok: true });
}));

app.get('/api/picks', requireAuth, asyncHandler(async (req, res) => {
  const [users, fixtures, picks, scorers] = await Promise.all([
    readJson('users.json'),
    readJson('fixtures.json'),
    readJson('picks.json'),
    readJson('scorers.json')
  ]);
  const lockState = getPicksLockState(fixtures);
  const currentPick = picks.find((pick) => pick.userId === req.session.user.id) || null;
  const picksByUserId = new Map(picks.map((pick) => [pick.userId, pick]));
  const rows = users
    .filter((user) => user.active !== false && user.role !== 'admin')
    .map((user) => {
      const pick = picksByUserId.get(user.id);
      return formatPopupPickRow({
        userId: user.id,
        username: user.username,
        champion: pick?.champion || '',
        runnerUp: pick?.runnerUp || '',
        topScorer: pick?.topScorer || '',
        updatedBy: pick?.updatedBy || null,
        updatedAt: pick?.updatedAt || null
      });
    });
  const { teams } = getPicksOptions(fixtures, scorers);

  res.json({
    pick: currentPick,
    picks: rows,
    teams,
    ...lockState
  });
}));

app.post('/api/picks', requireAuth, asyncHandler(async (req, res) => {
  const [fixtures, picks, scorers] = await Promise.all([
    readJson('fixtures.json'),
    readJson('picks.json'),
    readJson('scorers.json')
  ]);
  const lockState = getPicksLockState(fixtures);
  const isAdmin = req.session.user.role === 'admin';

  if (lockState.locked && !isAdmin) {
    return res.status(423).json({ error: 'picks_locked' });
  }

  const options = getPicksOptions(fixtures, scorers);
  const validation = validatePicksBody(req.body, options);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }

  const existing = picks.find((pick) => pick.userId === req.session.user.id);
  if (existing) {
    return res.status(409).json({ error: 'Picks already exist for this user.' });
  }

  const timestamp = new Date().toISOString();
  const pick = {
    id: crypto.randomUUID(),
    userId: req.session.user.id,
    username: req.session.user.username,
    ...validation.value,
    submittedAt: timestamp,
    updatedAt: timestamp,
    updatedBy: 'user'
  };

  picks.push(pick);
  await writeJson('picks.json', picks);
  await recordAuditLog(req, 'pick_created', {
    targetUserId: pick.userId,
    targetUsername: pick.username,
    picks: validation.value,
    updatedBy: pick.updatedBy
  });

  res.status(201).json({
    pick,
    picks: picks.map(formatPopupPickRow),
    teams: options.teams,
    ...lockState
  });
}));

app.put('/api/picks', requireAuth, asyncHandler(async (req, res) => {
  const [fixtures, picks, scorers] = await Promise.all([
    readJson('fixtures.json'),
    readJson('picks.json'),
    readJson('scorers.json')
  ]);
  const lockState = getPicksLockState(fixtures);
  const isAdmin = req.session.user.role === 'admin';

  if (lockState.locked && !isAdmin) {
    return res.status(423).json({ error: 'picks_locked' });
  }

  const options = getPicksOptions(fixtures, scorers);
  const validation = validatePicksBody(req.body, options);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }

  const pick = picks.find((candidate) => candidate.userId === req.session.user.id);
  if (!pick) {
    return res.status(404).json({ error: 'Picks not found.' });
  }

  Object.assign(pick, validation.value, {
    username: req.session.user.username,
    updatedAt: new Date().toISOString(),
    updatedBy: 'user'
  });

  await writeJson('picks.json', picks);
  await recordAuditLog(req, 'pick_updated', {
    targetUserId: pick.userId,
    targetUsername: pick.username,
    picks: validation.value,
    updatedBy: pick.updatedBy
  });

  res.json({
    pick,
    picks: picks.map(formatPopupPickRow),
    teams: options.teams,
    ...lockState
  });
}));

app.get('/api/scorers', requireAuth, asyncHandler(async (req, res) => {
  const scorers = await readJson('scorers.json');
  res.json({
    source: 'manual',
    scorers
  });
}));

app.post('/api/admin/scorers', requireAdmin, asyncHandler(async (req, res) => {
  const validation = validateScorerBody(req.body);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }

  const scorers = await readJson('scorers.json');
  const timestamp = new Date().toISOString();
  const scorer = {
    id: crypto.randomUUID(),
    ...validation.value,
    source: 'manual',
    createdAt: timestamp,
    lastUpdated: timestamp,
    updatedBy: `admin:${req.session.user.id}`
  };

  scorers.push(scorer);
  await writeJson('scorers.json', scorers);
  await recordAuditLog(req, 'scorer_manual_create', {
    scorerId: scorer.id,
    playerName: scorer.playerName,
    team: scorer.team,
    goals: scorer.goals,
    matchesPlayed: scorer.matchesPlayed,
    updatedBy: scorer.updatedBy
  });

  res.status(201).json({ scorer });
}));

app.put('/api/admin/scorers/:id', requireAdmin, asyncHandler(async (req, res) => {
  const validation = validateScorerBody(req.body);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }

  const scorerId = String(req.params.id || '');
  const scorers = await readJson('scorers.json');
  const scorer = scorers.find((candidate) => candidate.id === scorerId);
  if (!scorer) {
    return res.status(404).json({ error: 'Scorer not found.' });
  }

  Object.assign(scorer, validation.value, {
    source: 'manual',
    lastUpdated: new Date().toISOString(),
    updatedBy: `admin:${req.session.user.id}`
  });

  await writeJson('scorers.json', scorers);
  await recordAuditLog(req, 'scorer_manual_update', {
    scorerId: scorer.id,
    playerName: scorer.playerName,
    team: scorer.team,
    goals: scorer.goals,
    matchesPlayed: scorer.matchesPlayed,
    updatedBy: scorer.updatedBy
  });

  res.json({ scorer });
}));

app.delete('/api/admin/scorers/:id', requireAdmin, asyncHandler(async (req, res) => {
  const scorerId = String(req.params.id || '');
  const scorers = await readJson('scorers.json');
  const scorerIndex = scorers.findIndex((candidate) => candidate.id === scorerId);
  if (scorerIndex === -1) {
    return res.status(404).json({ error: 'Scorer not found.' });
  }

  const [deletedScorer] = scorers.splice(scorerIndex, 1);
  await writeJson('scorers.json', scorers);
  await recordAuditLog(req, 'scorer_manual_delete', {
    scorerId: deletedScorer.id,
    playerName: deletedScorer.playerName,
    team: deletedScorer.team,
    goals: deletedScorer.goals,
    matchesPlayed: deletedScorer.matchesPlayed,
    updatedBy: `admin:${req.session.user.id}`
  });

  res.json({ ok: true });
}));

app.get('/api/recent-predictions', requireAuth, asyncHandler(async (req, res) => {
  const [users, fixtures, predictions] = await Promise.all([
    readJson('users.json'),
    readJson('fixtures.json'),
    readJson('predictions.json')
  ]);
  const activeUsers = users.filter(u => u.active !== false);
  const feed = predictions
    .map(p => {
      const user = activeUsers.find(u => u.id === p.userId);
      const match = fixtures.find(f => f.id === p.matchId);
      if (!user || !match) return null;
      return {
        id: p.id,
        username: user.username,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        matchDate: match.boliviaDate,
        predHome: p.homeScore,
        predAway: p.awayScore,
        updatedAt: p.updatedAt
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 60);
  res.json(feed);
}));

app.get('/api/standings', requireAuth, asyncHandler(async (req, res) => {
  const phaseScope = req.query.phase !== undefined
    ? normalizeStandingsPhaseScope(req.query.phase)
    : (settingsCache.standingsPhaseScope || SETTINGS_DEFAULTS.standingsPhaseScope);
  // Only the explicit `?phase=groups` and `?phase=knockout` requests are the
  // detail-table data path. The main standings view either omits the
  // parameter (falls back to `standingsPhaseScope`) or sends `?phase=all`,
  // both of which must remain available to every authenticated user.
  if (!isStandingsDetailPhaseAllowed(req, phaseScope)) {
    return res.status(403).json({ error: 'This standings table is not available for your account.' });
  }
  const [users, fixtures, predictions, picks, scorers] = await Promise.all([
    readJson('users.json'),
    readJson('fixtures.json'),
    readJson('predictions.json'),
    readJson('picks.json'),
    readJson('scorers.json')
  ]);
  const { standings, liveMatches } = buildStandingsRows(users, fixtures, predictions, picks, scorers, phaseScope);
  res.json({ standings, liveMatches, phaseScope });
}));

app.get('/api/prize-pool', requireAuth, asyncHandler(async (req, res) => {
  const prizePool = await readJson('prize-pool.json');
  res.json(prizePool);
}));

app.put('/api/prize-pool', requireAdmin, asyncHandler(async (req, res) => {
  const amount = Number(req.body.amount);
  const payouts = Array.isArray(req.body.payouts) ? req.body.payouts : [];
  const normalizedPayouts = [1, 2, 3].map((place) => {
    const payout = payouts.find((candidate) => Number(candidate.place) === place) || {};
    return { place, percent: Number(payout.percent) };
  });
  const totalPercent = normalizedPayouts.reduce((total, payout) => total + payout.percent, 0);

  if (!Number.isFinite(amount) || amount < 0) {
    return res.status(400).json({ error: 'Prize amount must be a non-negative number.' });
  }
  if (normalizedPayouts.some((payout) => !Number.isFinite(payout.percent) || payout.percent < 0 || payout.percent > 100)) {
    return res.status(400).json({ error: 'Prize percentages must be numbers between 0 and 100.' });
  }
  if (totalPercent !== 100) {
    return res.status(400).json({ error: 'Prize percentages must add up to 100.' });
  }

  const prizePool = { amount, currency: 'Bs', payouts: normalizedPayouts };
  await writeJson('prize-pool.json', prizePool);
  await recordAuditLog(req, 'prize_pool_updated', prizePool);
  res.json(prizePool);
}));

app.get('/api/settings', requireAdmin, (req, res) => {
  res.json(settingsCache);
});

app.get('/api/visibility', requireAuth, (req, res) => {
  res.json({
    groupDetail: settingsCache.visibilityGroupDetail !== false,
    knockoutDetail: settingsCache.visibilityKnockoutDetail !== false
  });
});

app.put('/api/settings', requireAdmin, asyncHandler(async (req, res) => {
  const body = req.body || {};
  const merged = {
    ...settingsCache,
    worldcupSync: { ...settingsCache.worldcupSync },
    standingsTiebreak: { ...settingsCache.standingsTiebreak }
  };

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  if (body.predictionLockMs !== undefined) {
    const value = Number(body.predictionLockMs);
    if (!isFiniteNumber(value) || !Number.isInteger(value) || value < 0 || value > 3600000) {
      return res.status(400).json({ error: 'predictionLockMs must be an integer between 0 and 3600000.' });
    }
    merged.predictionLockMs = value;
  }

  if (body.lockoutAttempts !== undefined) {
    const value = Number(body.lockoutAttempts);
    if (!isFiniteNumber(value) || !Number.isInteger(value) || value < 1 || value > 20) {
      return res.status(400).json({ error: 'lockoutAttempts must be an integer between 1 and 20.' });
    }
    merged.lockoutAttempts = value;
  }

  if (body.lockoutDurationMs !== undefined) {
    const value = Number(body.lockoutDurationMs);
    if (!isFiniteNumber(value) || !Number.isInteger(value) || value < 1000 || value > 86400000) {
      return res.status(400).json({ error: 'lockoutDurationMs must be an integer between 1000 and 86400000.' });
    }
    merged.lockoutDurationMs = value;
  }

  if (body.maxTemporaryLockouts !== undefined) {
    const value = Number(body.maxTemporaryLockouts);
    if (!isFiniteNumber(value) || !Number.isInteger(value) || value < 1 || value > 20) {
      return res.status(400).json({ error: 'maxTemporaryLockouts must be an integer between 1 and 20.' });
    }
    merged.maxTemporaryLockouts = value;
  }

  if (body.lockoutResetMs !== undefined) {
    const value = Number(body.lockoutResetMs);
    if (!isFiniteNumber(value) || !Number.isInteger(value) || value < 1000 || value > 604800000) {
      return res.status(400).json({ error: 'lockoutResetMs must be an integer between 1000 and 604800000.' });
    }
    merged.lockoutResetMs = value;
  }

  if (body.worldcupSync && typeof body.worldcupSync === 'object') {
    if (body.worldcupSync.enabled !== undefined) {
      if (typeof body.worldcupSync.enabled !== 'boolean') {
        return res.status(400).json({ error: 'worldcupSync.enabled must be a boolean.' });
      }
      merged.worldcupSync.enabled = body.worldcupSync.enabled;
    }
    if (body.worldcupSync.pollIntervalMs !== undefined) {
      const value = Number(body.worldcupSync.pollIntervalMs);
      if (!isFiniteNumber(value) || !Number.isInteger(value) || value < 5000 || value > 300000) {
        return res.status(400).json({ error: 'worldcupSync.pollIntervalMs must be an integer between 5000 and 300000.' });
      }
      merged.worldcupSync.pollIntervalMs = value;
    }
  }

  if (body.fixtureRefreshMs !== undefined) {
    const value = Number(body.fixtureRefreshMs);
    if (!isFiniteNumber(value) || !Number.isInteger(value) || value < 5000 || value > 300000) {
      return res.status(400).json({ error: 'fixtureRefreshMs must be an integer between 5000 and 300000.' });
    }
    merged.fixtureRefreshMs = value;
  }

  if (body.standingsTiebreak && typeof body.standingsTiebreak === 'object') {
    for (const key of [
      'exactCountEnabled',
      'goalDiffOnThreeEnabled',
      'goalDiffOnZeroEnabled',
      'exactPlusAdvancerCountEnabled',
      'goalDiffOnKnockoutEnabled'
    ]) {
      if (body.standingsTiebreak[key] !== undefined) {
        if (typeof body.standingsTiebreak[key] !== 'boolean') {
          return res.status(400).json({ error: `standingsTiebreak.${key} must be a boolean.` });
        }
        merged.standingsTiebreak[key] = body.standingsTiebreak[key];
      }
    }
  }

  if (body.standingsPhaseScope !== undefined) {
    const value = String(body.standingsPhaseScope).trim().toLowerCase();
    if (value !== 'all' && value !== 'groups' && value !== 'knockout') {
      return res.status(400).json({ error: 'standingsPhaseScope must be "all", "groups", or "knockout".' });
    }
    merged.standingsPhaseScope = value;
  }

  if (body.visibilityGroupDetail !== undefined) {
    if (typeof body.visibilityGroupDetail !== 'boolean') {
      return res.status(400).json({ error: 'visibilityGroupDetail must be a boolean.' });
    }
    merged.visibilityGroupDetail = body.visibilityGroupDetail;
  }

  if (body.visibilityKnockoutDetail !== undefined) {
    if (typeof body.visibilityKnockoutDetail !== 'boolean') {
      return res.status(400).json({ error: 'visibilityKnockoutDetail must be a boolean.' });
    }
    merged.visibilityKnockoutDetail = body.visibilityKnockoutDetail;
  }

  if (merged.lockoutResetMs < merged.lockoutDurationMs) {
    return res.status(400).json({ error: 'lockoutResetMs must be greater than or equal to lockoutDurationMs.' });
  }

  const previousSettings = settingsCache;
  await applySettings(merged);
  await recordAuditLog(req, 'settings_updated', { previous: previousSettings, updated: merged });
  res.json(merged);
}));

app.get('/api/standings/:userId', requireAuth, asyncHandler(async (req, res) => {
  const userId = String(req.params.userId || '');
  const phaseScope = normalizeStandingsPhaseScope(req.query.phase);

  const [users, fixtures, predictions, picks, scorers] = await Promise.all([
    readJson('users.json'),
    readJson('fixtures.json'),
    readJson('predictions.json'),
    readJson('picks.json'),
    readJson('scorers.json')
  ]);
  const userIdsWithPhasePredictions = computeUserIdsWithPhasePredictions(fixtures, predictions, phaseScope);
  const user = users.find((candidate) => candidate.id === userId && candidate.role !== 'admin'
    && (candidate.active !== false || userIdsWithPhasePredictions.has(candidate.id)));
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const userPredictions = predictions.filter((prediction) => prediction.userId === user.id);
  const scopedFixtures = fixtures.filter((match) => {
    const isKnockout = KNOCKOUT_PHASES.has(match.phase);
    if (phaseScope === 'groups') return !isKnockout;
    if (phaseScope === 'knockout') return isKnockout;
    return true;
  });
  const details = scopedFixtures.map((match) => {
    const prediction = userPredictions.find((candidate) => candidate.matchId === match.id) || null;
    const predictionPoints = prediction ? calculatePredictionPoints(prediction, match) : 0;
    const advancerBonus = prediction ? calculateAdvancerBonus(prediction, match) : 0;
    const points = predictionPoints + advancerBonus;
    const predictedOutcome = prediction ? getOutcome(prediction.homeScore, prediction.awayScore) : null;
    const predictedAdvancer = !prediction || !KNOCKOUT_PHASES.has(match.phase)
      ? null
      : predictedOutcome === 'draw'
        ? prediction.advancer
        : predictedOutcome === 'home'
          ? match.homeTeam
          : match.awayTeam;
    return {
      matchId: match.id,
      matchNumber: match.matchNumber,
      boliviaDate: match.boliviaDate,
      boliviaTime: match.boliviaTime,
      phase: match.phase,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeTeamShort: abbreviateTeamName(match.homeTeam),
      awayTeamShort: abbreviateTeamName(match.awayTeam),
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      status: match.status,
      advancer: match.advancer || null,
      advancerShort: match.advancer ? abbreviateTeamName(match.advancer) : null,
      prediction,
      predictedAdvancer,
      predictedAdvancerShort: predictedAdvancer ? abbreviateTeamName(predictedAdvancer) : null,
      predictionPoints,
      advancerBonus,
      points
    };
  });
  const { standings } = buildStandingsRows(users, fixtures, predictions, picks, scorers, phaseScope);
  const standingRow = standings.find((row) => row.userId === user.id);
  const matchPoints = details.reduce((total, detail) => total + detail.points, 0);
  const bonusPoints = standingRow?.bonusPoints || 0;
  const totalPoints = matchPoints + bonusPoints;
  await recordAuditLog(req, 'standing_detail_viewed', { targetUserId: user.id, targetUsername: user.username });
  res.json({ user: sanitizeUser(user), matchPoints, bonusPoints, totalPoints, details, phaseScope });
}));

function normalizeStandingsPhaseScope(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'groups' || value === 'knockout') return value;
  return 'all';
}

// Server-side guard for the two detail tables behind `/api/standings?phase=`.
// Admins always see both detail tables. Non-admins are blocked when the
// corresponding admin setting is false. The main standings view (phase "all"
// or no explicit phase) is never blocked, and the per-user detail endpoint
// is intentionally not gated here — the per-user modal is reached from the
// main standings view and is not one of the "hidden detail tables".
function isStandingsDetailPhaseAllowed(req, phase) {
  if (req.session?.user?.role === 'admin') return true;
  if (phase === 'groups') return settingsCache.visibilityGroupDetail !== false;
  if (phase === 'knockout') return settingsCache.visibilityKnockoutDetail !== false;
  return true;
}

app.get('/api/rules', requireAuth, (req, res) => {
  const tiebreak = settingsCache.standingsTiebreak || SETTINGS_DEFAULTS.standingsTiebreak;
  const annotatedRules = rules.map((rule) => ({
    ...rule,
    enabled: rule.settingsKey ? Boolean(tiebreak[rule.settingsKey]) : true
  }));
  res.json({ rules: annotatedRules });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || err.status || 500;
  const isProduction = process.env.NODE_ENV === 'production';

  if (statusCode >= 500) {
    console.error({
      error: err.message,
      stack: err.stack,
      method: req.method,
      url: req.url,
      userId: req.session?.user?.id ?? null,
    });
  }

  const message = statusCode >= 500 && isProduction ? 'Internal server error.' : err.message;
  res.status(statusCode).json({ error: message });
});

async function boot() {
  await loadSettings();
  app.listen(PORT, () => {
    console.log(`La Curva Mundial running at http://localhost:${PORT}`);
  });
  startWorldcupSync({ readJson, writeJson }, settingsCache.worldcupSync);
}

boot();
