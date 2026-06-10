const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const express = require('express');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_MAX_AGE_MS = 5 * 60 * 1000;
const PREDICTION_LOCK_MS = 10 * 60 * 1000;
const DATA_DIR = path.join(__dirname, 'data');
const FIXTURE_STATUSES = new Set(['scheduled', 'live', 'final']);

const rules = [
  { title: 'Resultado exacto', description: 'Si acertás el marcador exacto del partido, sumás 5 puntos.' },
  { title: 'Ganador o empate', description: 'Si acertás el ganador o el empate, pero no el resultado exacto, sumás 3 puntos.' },
  { title: 'Sin acierto', description: 'Si no acertás resultado exacto, ganador ni empate, sumás 0 puntos.' },
  { title: 'Cierre de predicciones', description: 'Cada partido se bloquea 10 minutos antes del inicio.' },
  { title: 'Partidos sin resultado final', description: 'Los partidos sin marcador final todavía no suman puntos.' }
];

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

async function writeJson(fileName, data) {
  const filePath = path.join(DATA_DIR, fileName);
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const attemptedHash = crypto.scryptSync(password, salt, 64);
  const savedHash = Buffer.from(hash, 'hex');
  return savedHash.length === attemptedHash.length && crypto.timingSafeEqual(savedHash, attemptedHash);
}

function sanitizeUser(user) {
  return { id: user.id, username: user.username, role: user.role, active: user.active !== false };
}

async function recordAuditLog(req, action, detail = {}) {
  try {
    const logs = await readJson('audit-log.json');
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
    await writeJson('audit-log.json', logs.slice(-1000));
  } catch (error) {
    console.error('Could not write audit log:', error.message);
  }
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

function isPredictionLocked(match) {
  return new Date(match.date).getTime() - Date.now() <= PREDICTION_LOCK_MS;
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

app.post('/api/login', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const users = await readJson('users.json');
  const user = users.find((candidate) => candidate.username.toLowerCase() === username.toLowerCase());

  if (!user || user.active === false || !verifyPassword(password, user.passwordHash)) {
    await recordAuditLog(req, 'login_failed', { username });
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  req.session.regenerate((error) => {
    if (error) return res.status(500).json({ error: 'Could not create session.' });
    req.session.user = sanitizeUser(user);
    recordAuditLog(req, 'login_success', { userId: user.id, username: user.username, role: user.role });
    return res.json({ user: req.session.user });
  });
});

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

app.post('/api/audit/navigation', requireAuth, async (req, res) => {
  const view = String(req.body.view || '').trim();
  const publicViews = ['fixturesView', 'predictionsView', 'standingsView', 'rulesView'];
  const adminViews = ['usersView', 'auditView'];
  if (!publicViews.includes(view) && !adminViews.includes(view)) {
    return res.status(400).json({ error: 'Invalid view.' });
  }
  if (adminViews.includes(view) && req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  await recordAuditLog(req, 'menu_viewed', { view });
  res.json({ ok: true });
});

app.get('/api/audit-log', requireAdmin, async (req, res) => {
  const logs = await readJson('audit-log.json');
  res.json(logs.slice().reverse());
});

app.get('/api/session', (req, res) => {
  res.json({ user: req.session.user || null, inactivityLimitMs: SESSION_MAX_AGE_MS });
});

app.get('/api/users', requireAdmin, async (req, res) => {
  const users = await readJson('users.json');
  res.json(users.map(sanitizeUser));
});

app.post('/api/users', requireAdmin, async (req, res) => {
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
    passwordHash: hashPassword(password)
  };
  users.push(user);
  await writeJson('users.json', users);
  await recordAuditLog(req, 'user_created', { targetUserId: user.id, targetUsername: user.username, targetRole: user.role });
  return res.status(201).json({ user: sanitizeUser(user) });
});

app.put('/api/users/:id', requireAdmin, async (req, res) => {
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
  if (password) user.passwordHash = hashPassword(password);
  await writeJson('users.json', users);
  if (user.id === req.session.user.id) req.session.user = sanitizeUser(user);
  await recordAuditLog(req, 'user_updated', { targetUserId: user.id, targetUsername: user.username, targetRole: user.role, active: user.active !== false, passwordChanged: Boolean(password) });
  return res.json({ user: sanitizeUser(user) });
});

app.patch('/api/users/:id/deactivate', requireAdmin, async (req, res) => {
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
});

app.get('/api/fixtures', requireAuth, async (req, res) => {
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
});

app.put('/api/fixtures/:id', requireAdmin, async (req, res) => {
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

  match.status = status;
  match.homeScore = homeScore;
  match.awayScore = awayScore;
  await writeJson('fixtures.json', fixtures);
  await recordAuditLog(req, 'fixture_updated', {
    matchId,
    matchNumber: match.matchNumber,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    homeScore,
    awayScore,
    status
  });
  res.json({ match: { ...match, locked: isPredictionLocked(match) } });
});

app.get('/api/predictions', requireAuth, async (req, res) => {
  const [fixtures, predictions] = await Promise.all([readJson('fixtures.json'), readJson('predictions.json')]);
  const userPredictions = predictions.filter((prediction) => prediction.userId === req.session.user.id);
  const merged = fixtures.map((match) => ({
    ...match,
    locked: isPredictionLocked(match),
    prediction: userPredictions.find((prediction) => prediction.matchId === match.id) || null
  }));
  res.json(merged);
});

app.post('/api/predictions', requireAuth, async (req, res) => {
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
});

app.get('/api/standings', requireAuth, async (req, res) => {
  const [users, fixtures, predictions] = await Promise.all([
    readJson('users.json'),
    readJson('fixtures.json'),
    readJson('predictions.json')
  ]);
  const standings = users.filter((user) => user.role !== 'admin' && user.active !== false).map((user) => {
    const userPredictions = predictions.filter((prediction) => prediction.userId === user.id);
    const points = userPredictions.reduce((total, prediction) => {
      const match = fixtures.find((candidate) => candidate.id === prediction.matchId);
      return match ? total + calculatePredictionPoints(prediction, match) : total;
    }, 0);
    return { userId: user.id, username: user.username, points };
  }).sort((a, b) => b.points - a.points || a.username.localeCompare(b.username));
  res.json(standings);
});

app.get('/api/standings/:userId', requireAuth, async (req, res) => {
  const userId = String(req.params.userId || '');
  if (req.session.user.role !== 'admin' && req.session.user.id !== userId) {
    return res.status(403).json({ error: 'You can only view your own standing detail.' });
  }

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
});

app.get('/api/rules', requireAuth, (req, res) => {
  res.json({ rules });
});

app.listen(PORT, () => {
  console.log(`La Curva Mundial running at http://localhost:${PORT}`);
});
