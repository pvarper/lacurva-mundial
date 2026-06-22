const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { startWorldcupSync, stopWorldcupSync } = require('./lib/worldcup-sync');

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET environment variable is required in production.');
}

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_MAX_AGE_MS = 120 * 60 * 1000;
const DATA_DIR = path.join(__dirname, 'data');
const FIXTURE_STATUSES = new Set(['scheduled', 'live', 'final']);

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
  fixtureRefreshMs: 30 * 1000
};

let settingsCache = { ...SETTINGS_DEFAULTS };

const rules = [
  { title: 'Resultado exacto', description: 'Si acertás el marcador exacto del partido, sumás 5 puntos.' },
  { title: 'Ganador o empate', description: 'Si acertás el ganador o el empate, pero no el resultado exacto, sumás 3 puntos.' },
  { title: 'Sin acierto', description: 'Si no acertás resultado exacto, ganador ni empate, sumás 0 puntos.' },
  { title: 'Cierre de predicciones', description: 'Cada partido se bloquea 1 minuto antes del inicio.' },
  { title: 'Partidos sin resultado final', description: 'Los partidos sin marcador final todavía no suman puntos.' }
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
    settingsCache = await readJson('settings.json');
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

function getOutcome(homeScore, awayScore) {
  if (homeScore > awayScore) return 'home';
  if (homeScore < awayScore) return 'away';
  return 'draw';
}

function calculatePredictionPoints(prediction, match) {
  if (match.status !== 'final' || match.homeScore === null || match.awayScore === null) return 0;
  const exactScore = prediction.homeScore === match.homeScore && prediction.awayScore === match.awayScore;
  if (exactScore) return 5;
  const predictedOutcome = getOutcome(prediction.homeScore, prediction.awayScore);
  const actualOutcome = getOutcome(match.homeScore, match.awayScore);
  return predictedOutcome === actualOutcome ? 3 : 0;
}

function parseFixtureScore(value) {
  if (value === null || value === '') return null;
  const score = Number(value);
  return Number.isInteger(score) && score >= 0 ? score : NaN;
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
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
  const publicViews = ['fixturesView', 'predictionsView', 'standingsView', 'rulesView', 'activityView'];
  const adminViews = ['usersView', 'auditView'];
  if (!publicViews.includes(view) && !adminViews.includes(view)) {
    return res.status(400).json({ error: 'Invalid view.' });
  }
  if (adminViews.includes(view) && req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
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
  res.json({ user: req.session.user || null, inactivityLimitMs: SESSION_MAX_AGE_MS });
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

  const previousValue = { status: match.status, homeScore: match.homeScore, awayScore: match.awayScore };
  match.status = status;
  match.homeScore = homeScore;
  match.awayScore = awayScore;
  await writeJson('fixtures.json', fixtures);
  await recordAuditLog(req, 'fixture_updated', {
    matchId,
    matchNumber: match.matchNumber,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    previousValue,
    homeScore,
    awayScore,
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

  const predictions = await readJson('predictions.json');
  const existing = predictions.find((prediction) => prediction.userId === req.session.user.id && prediction.matchId === matchId);
  const action = existing ? 'prediction_updated' : 'prediction_created';

  if (existing) {
    existing.homeScore = homeScore;
    existing.awayScore = awayScore;
    existing.updatedAt = new Date().toISOString();
  } else {
    predictions.push({
      id: crypto.randomUUID(),
      userId: req.session.user.id,
      matchId,
      homeScore,
      awayScore,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  await writeJson('predictions.json', predictions);
  await recordAuditLog(req, action, { matchId, matchNumber: match.matchNumber, homeTeam: match.homeTeam, awayTeam: match.awayTeam, homeScore, awayScore });
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
  const [users, fixtures, predictions] = await Promise.all([
    readJson('users.json'),
    readJson('fixtures.json'),
    readJson('predictions.json')
  ]);
  const liveMatch = fixtures.find((m) => m.status === 'live') || null;
  const standings = users.filter((user) => user.role !== 'admin' && user.active !== false).map((user) => {
    const userPredictions = predictions.filter((prediction) => prediction.userId === user.id);
    const points = userPredictions.reduce((total, prediction) => {
      const match = fixtures.find((candidate) => candidate.id === prediction.matchId);
      return match ? total + calculatePredictionPoints(prediction, match) : total;
    }, 0);
    const livePrediction = liveMatch
      ? (userPredictions.find((p) => p.matchId === liveMatch.id) || null)
      : null;
    return { userId: user.id, username: user.username, points, livePrediction };
  }).sort((a, b) => b.points - a.points || a.username.localeCompare(b.username));
  res.json({ standings, liveMatch });
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

app.put('/api/settings', requireAdmin, asyncHandler(async (req, res) => {
  const body = req.body || {};
  const merged = {
    ...settingsCache,
    worldcupSync: { ...settingsCache.worldcupSync }
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

  const [users, fixtures, predictions] = await Promise.all([
    readJson('users.json'),
    readJson('fixtures.json'),
    readJson('predictions.json')
  ]);
  const user = users.find((candidate) => candidate.id === userId && candidate.role !== 'admin' && candidate.active !== false);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const userPredictions = predictions.filter((prediction) => prediction.userId === user.id);
  const details = fixtures.map((match) => {
    const prediction = userPredictions.find((candidate) => candidate.matchId === match.id) || null;
    const points = prediction ? calculatePredictionPoints(prediction, match) : 0;
    return {
      matchId: match.id,
      matchNumber: match.matchNumber,
      boliviaDate: match.boliviaDate,
      boliviaTime: match.boliviaTime,
      phase: match.phase,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      status: match.status,
      prediction,
      points
    };
  });
  const totalPoints = details.reduce((total, detail) => total + detail.points, 0);
  await recordAuditLog(req, 'standing_detail_viewed', { targetUserId: user.id, targetUsername: user.username });
  res.json({ user: sanitizeUser(user), totalPoints, details });
}));

app.get('/api/rules', requireAuth, (req, res) => {
  res.json({ rules });
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
