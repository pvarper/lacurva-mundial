const state = {
  user: null,
  inactivityLimitMs: 120 * 60 * 1000,
  fixtureRefreshMs: 30 * 1000,
  inactivityTimer: null,
  fixtureRefreshTimer: null,
  currentView: null,
  predictions: [],
  picks: { pick: null, picks: [], locked: false, lockAt: null, firstR16Kickoff: null },
  scorers: { source: 'manual', scorers: [] },
  prizePool: null,
  auditLogs: [],
  dateCarouselIndex: 0,
  selectedPredDate: null,
};

const fixtureStatusLabels = {
  scheduled: 'Programado',
  live: 'EN VIVO',
  final: 'FINALIZADO'
};

const KNOCKOUT_PHASES = new Set(['16vos', '8vos', '4vos', 'Semifinal', 'Final']);

const TEAM_FLAGS = {
  'Alemania': 'de',
  'Arabia Saudita': 'sa',
  'Argelia': 'dz',
  'Argentina': 'ar',
  'Australia': 'au',
  'Austria': 'at',
  'Bosnia y Herzegovina': 'ba',
  'Brasil': 'br',
  'Bélgica': 'be',
  'Cabo Verde': 'cv',
  'Canadá': 'ca',
  'Catar': 'qa',
  'Chequia': 'cz',
  'Colombia': 'co',
  'Corea del Sur': 'kr',
  'Costa de Marfil': 'ci',
  'Croacia': 'hr',
  'Curazao': 'cw',
  'Ecuador': 'ec',
  'Egipto': 'eg',
  'Escocia': 'gb-sct',
  'España': 'es',
  'Estados Unidos': 'us',
  'Francia': 'fr',
  'Ghana': 'gh',
  'Haití': 'ht',
  'Inglaterra': 'gb-eng',
  'Irak': 'iq',
  'Irán': 'ir',
  'Japón': 'jp',
  'Jordania': 'jo',
  'Marruecos': 'ma',
  'México': 'mx',
  'Noruega': 'no',
  'Nueva Zelanda': 'nz',
  'Panamá': 'pa',
  'Paraguay': 'py',
  'Países Bajos': 'nl',
  'Portugal': 'pt',
  'República Democrática del Congo': 'cd',
  'Senegal': 'sn',
  'Sudáfrica': 'za',
  'Suecia': 'se',
  'Suiza': 'ch',
  'Turquía': 'tr',
  'Túnez': 'tn',
  'Uruguay': 'uy',
  'Uzbekistán': 'uz',
};

function teamFlag(name) {
  const code = TEAM_FLAGS[name];
  if (!code) return '';
  return `<span class="fi fi-${code} team-flag" aria-hidden="true"></span>`;
}

const elements = {
  loginView: document.querySelector('#loginView'),
  appView: document.querySelector('#appView'),
  loginForm: document.querySelector('#loginForm'),
  loginMessage: document.querySelector('#loginMessage'),
  sidebarCurrentUser: document.querySelector('#sidebarCurrentUser'),
  mobileCurrentUser: document.querySelector('#mobileCurrentUser'),
  logoutButton: document.querySelector('#logoutButton'),
  mobileLogoutButton: document.querySelector('#mobileLogoutButton'),
  hideSidebarButton: document.querySelector('#hideSidebarButton'),
  showSidebarButton: document.querySelector('#showSidebarButton'),
  menuButtons: document.querySelectorAll('.menu button[data-view], .bottom-nav-btn[data-view]'),
  views: document.querySelectorAll('.view'),
  usersMenu: document.querySelector('#usersMenu'),
  auditMenu: document.querySelector('#auditMenu'),
  createUserForm: document.querySelector('#createUserForm'),
  createUserMessage: document.querySelector('#createUserMessage'),
  usersTableBody: document.querySelector('#usersTableBody'),
  fixturesList: document.querySelector('#fixturesList'),
  fixturePhaseFilter: document.querySelector('#fixturePhaseFilter'),
  fixtureGroupFilter: document.querySelector('#fixtureGroupFilter'),
  clearFixtureFilters: document.querySelector('#clearFixtureFilters'),
  predictionsList: document.querySelector('#predictionsList'),
  predictionPhaseFilter: document.querySelector('#predictionPhaseFilter'),
  clearPredictionFilters: document.querySelector('#clearPredictionFilters'),
  picksMessage: document.querySelector('#picksMessage'),
  picksLockBanner: document.querySelector('#picksLockBanner'),
  picksFormContainer: document.querySelector('#picksFormContainer'),
  picksCommunityTableBody: document.querySelector('#picksCommunityTableBody'),
  dateCarouselTrack: document.querySelector('#dateCarouselTrack'),
  dateCarouselPrev: document.querySelector('#dateCarouselPrev'),
  dateCarouselNext: document.querySelector('#dateCarouselNext'),
  recentPredFeed: document.querySelector('#recentPredFeed'),
  activityFeed: document.querySelector('#activityFeed'),
  activityTeamFilter: document.querySelector('#activityTeamFilter'),
  clearActivityFilters: document.querySelector('#clearActivityFilters'),
  standingsBody: document.querySelector('#standingsBody'),
  standingDetail: document.querySelector('#standingDetail'),
  standingDetailModal: document.querySelector('#standingDetailModal'),
  standingDetailModalTitle: document.querySelector('#standingDetailModalTitle'),
  standingDetailModalPts: document.querySelector('.standing-detail-modal-pts'),
  standingDetailModalContent: document.querySelector('#standingDetailModalContent'),
  standingDetailModalClose: document.querySelector('#standingDetailModalClose'),
  prizePoolPanel: document.querySelector('#prizePoolPanel'),
  fixturesMessage: document.querySelector('#fixturesMessage'),
  predictionsMessage: document.querySelector('#predictionsMessage'),
  standingsMessage: document.querySelector('#standingsMessage'),
  scorersMessage: document.querySelector('#scorersMessage'),
  scorersBanner: document.querySelector('#scorersBanner'),
  scorersAdminForm: document.querySelector('#scorersAdminForm'),
  cancelScorerEditButton: document.querySelector('#cancelScorerEditButton'),
  scorersTableBody: document.querySelector('#scorersTableBody'),
  standingsDetailBody: document.querySelector('#standingsDetailBody'),
  standingsDetailMessage: document.querySelector('#standingsDetailMessage'),
  rulesList: document.querySelector('#rulesList'),
  auditLogBody: document.querySelector('#auditLogBody'),
  auditDateFilter: document.querySelector('#auditDateFilter'),
  auditUserFilter: document.querySelector('#auditUserFilter'),
  auditActionFilter: document.querySelector('#auditActionFilter'),
  clearAuditFilters: document.querySelector('#clearAuditFilters'),
  settingsView: document.querySelector('#settingsView'),
  settingsForm: document.querySelector('#settingsForm'),
  settingsMessage: document.querySelector('#settingsMessage')
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && state.user) {
    logout('Tu sesión expiró. Iniciá sesión nuevamente.');
    throw new Error('Session expired.');
  }
  if (!response.ok) throw new Error(data.error || 'Unexpected error.');
  return data;
}

function formatDate(value) {
  return new Intl.DateTimeFormat('es-BO', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/La_Paz'
  }).format(new Date(value));
}

function todayBoliviaDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date());
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character]);
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function setMessage(element, message, success = false) {
  element.textContent = message;
  element.classList.toggle('success', success);
}

function presentError(error) {
  if (error.message === 'picks_locked') {
    return 'Los picks especiales ya están cerrados para usuarios normales.';
  }
  return error.message;
}

function setSidebarVisible(visible) {
  elements.appView.classList.toggle('sidebar-collapsed', !visible);
  elements.showSidebarButton.classList.toggle('hidden', visible);
}


function resetInactivityTimer() {
  clearTimeout(state.inactivityTimer);
  if (!state.user) return;
  state.inactivityTimer = setTimeout(() => logout('Sesión cerrada por inactividad.'), state.inactivityLimitMs);
}

function showView(viewId) {
  state.currentView = viewId;
  elements.views.forEach((view) => view.classList.toggle('hidden', view.id !== viewId));
  elements.menuButtons.forEach((button) => button.classList.toggle('active', button.dataset.view === viewId));
  recordNavigation(viewId);
  if (viewId === 'fixturesView') {
    loadFixtures().catch(() => {});
    startFixtureAutoRefresh();
  } else {
    stopFixtureAutoRefresh();
  }
  if (viewId === 'usersView') loadUsers();
  if (viewId === 'predictionsView') {
    loadPredictions();
  }
  if (viewId === 'picksView') loadPicks();
  if (viewId === 'activityView') {
    loadPredictions();
  }
  if (viewId === 'standingsView') loadStandings();
  if (viewId === 'scorersView') loadScorers();
  if (viewId === 'standingsDetailView') loadStandingsDetail();
  if (viewId === 'rulesView') loadRules();
  if (viewId === 'auditView') loadAuditLog();
  if (viewId === 'settingsView') loadSettings();
}

function recordNavigation(viewId) {
  if (!state.user) return;
  api('/api/audit/navigation', { method: 'POST', body: JSON.stringify({ view: viewId }) }).catch(() => {});
}

function showAuthenticatedApp(user) {
  state.user = user;
  elements.loginView.classList.add('hidden');
  elements.appView.classList.remove('hidden');
  elements.sidebarCurrentUser.textContent = `${user.username} (${user.role})`;
  if (elements.mobileCurrentUser) elements.mobileCurrentUser.textContent = user.username;
  const isAdmin = user.role === 'admin';
  document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', !isAdmin));
  const adminLabel = document.querySelector('#adminSectionLabel');
  if (adminLabel) adminLabel.classList.toggle('hidden', !isAdmin);
  const bottomNav = document.querySelector('#bottomNav');
  if (bottomNav) bottomNav.classList.remove('hidden');
  showView('predictionsView');
  resetInactivityTimer();
}

function showLogin(message = '') {
  state.user = null;
  state.currentView = null;
  state.selectedPredDate = null;
  state.dateCarouselIndex = 0;
  clearTimeout(state.inactivityTimer);
  stopFixtureAutoRefresh();
  elements.appView.classList.add('hidden');
  elements.loginView.classList.remove('hidden');
  const bottomNav = document.querySelector('#bottomNav');
  if (bottomNav) bottomNav.classList.add('hidden');
  setMessage(elements.loginMessage, message);
}

async function logout(message = '') {
  try {
    if (state.user) await api('/api/logout', { method: 'POST' });
  } catch (_) {
    // If the session already expired, the UI still needs to return to login.
  }
  showLogin(message);
}

function startFixtureAutoRefresh() {
  stopFixtureAutoRefresh();
  state.fixtureRefreshTimer = setInterval(() => {
    if (state.currentView !== 'fixturesView') return;
    if (document.activeElement?.closest('.fixture-update-form')) return;
    loadFixtures().catch(() => {});
  }, state.fixtureRefreshMs);
}

function stopFixtureAutoRefresh() {
  clearInterval(state.fixtureRefreshTimer);
  state.fixtureRefreshTimer = null;
}

function fixtureStatusBadge(match) {
  const status = match.status || 'scheduled';
  const liveIcon = status === 'live' ? '<i class="bi bi-circle-fill" style="font-size:0.5rem"></i> ' : '';
  return `<span class="status fixture-status ${status}-status">${liveIcon}${escapeHtml(fixtureStatusLabels[status] || status)}</span>`;
}

function renderFixtureAdminForm(match) {
  if (state.user?.role !== 'admin') return '';
  const status = match.status || 'scheduled';
  const isKnockout = KNOCKOUT_PHASES.has(match.phase);
  const hasScore = match.homeScore !== null && match.awayScore !== null;
  const isDraw = hasScore && match.homeScore === match.awayScore;
  const showKnockoutExtras = isKnockout && isDraw && status === 'final';
  const hasPenalties = match.penaltyHomeScore !== null && match.penaltyHomeScore !== undefined;
  const advancerHtml = isKnockout ? `
    <select name="advancer" class="advancer-select${showKnockoutExtras ? '' : ' hidden'}">
      <option value="">— Clasifica —</option>
      <option value="${escapeHtml(match.homeTeam)}" ${match.advancer === match.homeTeam ? 'selected' : ''}>${escapeHtml(match.homeTeam)}</option>
      <option value="${escapeHtml(match.awayTeam)}" ${match.advancer === match.awayTeam ? 'selected' : ''}>${escapeHtml(match.awayTeam)}</option>
    </select>
    <label class="penalty-checkbox-label${showKnockoutExtras ? '' : ' hidden'}">
      Penales: <input type="checkbox" name="hasPenalties"${hasPenalties ? ' checked' : ''}>
    </label>
    <input name="penaltyHomeScore" type="number" min="0" step="1" value="${match.penaltyHomeScore ?? ''}" placeholder="Local" class="score-input penalty-input${showKnockoutExtras && hasPenalties ? '' : ' hidden'}">
    <span class="score-sep penalty-sep${showKnockoutExtras && hasPenalties ? '' : ' hidden'}">-</span>
    <input name="penaltyAwayScore" type="number" min="0" step="1" value="${match.penaltyAwayScore ?? ''}" placeholder="Visit." class="score-input penalty-input${showKnockoutExtras && hasPenalties ? '' : ' hidden'}">` : '';
  return `
    <button type="button" class="admin-toggle-btn" data-match-id="${escapeHtml(match.id)}">
      <i class="bi bi-pencil-square"></i> Editar resultado
    </button>
    <form class="fixture-update-form hidden" data-match-id="${escapeHtml(match.id)}" data-home-team="${escapeHtml(match.homeTeam)}" data-away-team="${escapeHtml(match.awayTeam)}" data-is-knockout="${isKnockout}">
      <div class="admin-score-row">
        <input name="homeScore" type="number" min="0" step="1" value="${match.homeScore ?? ''}" placeholder="—" class="score-input">
        <span class="score-sep">—</span>
        <input name="awayScore" type="number" min="0" step="1" value="${match.awayScore ?? ''}" placeholder="—" class="score-input">
        <select name="status" class="status-select">
          <option value="scheduled" ${status === 'scheduled' ? 'selected' : ''}>Programado</option>
          <option value="live" ${status === 'live' ? 'selected' : ''}>En vivo</option>
          <option value="final" ${status === 'final' ? 'selected' : ''}>Finalizado</option>
        </select>
        ${advancerHtml}
        <button type="submit" class="save-btn"><i class="bi bi-check-lg"></i> Guardar</button>
      </div>
    </form>
  `;
}

function renderFixtureCard(match, opts = {}) {
  const hasScore = match.homeScore !== null && match.awayScore !== null;
  const isLive = (match.status || 'scheduled') === 'live';
  const scoreHtml = hasScore
    ? `<div class="score-display">${match.homeScore} — ${match.awayScore}</div>`
    : `<div class="score-display vs">VS</div>`;

  const header = opts.inGroup
    ? `<div class="match-header"><div class="match-header-right">${fixtureStatusBadge(match)}</div></div>`
    : `<div class="match-header">
        <span class="match-phase">${escapeHtml(match.roundName || match.phase)} · #${match.matchNumber}</span>
        <div class="match-header-right">${fixtureStatusBadge(match)}</div>
      </div>`;

  const pred = opts.prediction || null;
  const hasPred = pred && pred.homeScore !== null && pred.homeScore !== undefined;
  const predBadge = hasPred
    ? `<span class="status final-status"><i class="bi bi-check2"></i> Mi predicción: ${pred.homeScore} — ${pred.awayScore}${pred.advancer ? ` · ${escapeHtml(pred.advancer)}` : ''}</span>`
    : '';
  const predAction = match.locked
    ? `<span class="locked"><i aria-hidden="true" class="bi bi-lock-fill"></i> Predicciones cerradas</span>`
    : `<button type="button" class="predict-open-btn"
        data-match-id="${escapeHtml(String(match.id))}"
        data-home-team="${escapeHtml(match.homeTeam)}"
        data-away-team="${escapeHtml(match.awayTeam)}"
        data-home-score="${hasPred ? pred.homeScore : ''}"
        data-away-score="${hasPred ? pred.awayScore : ''}"
        data-advancer="${hasPred && pred.advancer ? escapeHtml(pred.advancer) : ''}"
        data-raw-phase="${escapeHtml(match.phase)}"
        data-phase="${escapeHtml(match.roundName || match.phase)}"
        data-match-number="${match.matchNumber}">
        <i aria-hidden="true" class="bi bi-pencil-square"></i>
        ${hasPred ? 'Editar predicción' : 'Ingresar predicción'}
      </button>`;

  const knockoutInfoHtml = renderKnockoutResultInfo(match);

  return `
    <article class="match-card${isLive ? ' live-card' : ''}">
      ${header}
      <div class="match-teams">
        <span class="team-name home">${escapeHtml(match.homeTeam)}${teamFlag(match.homeTeam)}</span>
        ${scoreHtml}
        <span class="team-name away">${teamFlag(match.awayTeam)}${escapeHtml(match.awayTeam)}</span>
      </div>
      ${knockoutInfoHtml}
      <div class="match-meta-row">
        <span class="meta-item"><i aria-hidden="true" class="bi bi-clock"></i> ${escapeHtml(match.boliviaDate)} ${escapeHtml(match.boliviaTime)} BOL</span>
        <span class="meta-item"><i aria-hidden="true" class="bi bi-geo-alt"></i> ${escapeHtml(match.city)}</span>
      </div>
      <div class="card-footer">
        ${predBadge}
        ${predAction}
      </div>
      ${renderFixtureAdminForm(match)}
    </article>
  `;
}

function computeGroupStandings(matches) {
  const teams = {};
  for (const m of matches) {
    if (!teams[m.homeTeam]) teams[m.homeTeam] = { team: m.homeTeam, pj: 0, g: 0, e: 0, p: 0, gf: 0, gc: 0 };
    if (!teams[m.awayTeam]) teams[m.awayTeam] = { team: m.awayTeam, pj: 0, g: 0, e: 0, p: 0, gf: 0, gc: 0 };
    if ((m.status === 'final') && m.homeScore !== null && m.awayScore !== null) {
      const h = teams[m.homeTeam], a = teams[m.awayTeam];
      h.pj++; a.pj++;
      h.gf += m.homeScore; h.gc += m.awayScore;
      a.gf += m.awayScore; a.gc += m.homeScore;
      if (m.homeScore > m.awayScore) { h.g++; a.p++; }
      else if (m.homeScore < m.awayScore) { a.g++; h.p++; }
      else { h.e++; a.e++; }
    }
  }
  return Object.values(teams).sort((a, b) => {
    const pa = a.g * 3 + a.e, pb = b.g * 3 + b.e;
    if (pb !== pa) return pb - pa;
    const dga = a.gf - a.gc, dgb = b.gf - b.gc;
    if (dgb !== dga) return dgb - dga;
    return b.gf - a.gf;
  });
}

function renderGroupStandingsTable(teams) {
  const rankColors = ['#22c55e', '#22c55e', '#f59e0b', '#ef4444'];
  const rows = teams.map((t, i) => {
    const pts = t.g * 3 + t.e;
    const dg = t.gf - t.gc;
    const dgStr = dg > 0 ? `+${dg}` : String(dg);
    const color = rankColors[i] ?? '#94a3b8';
    const dgClass = dg > 0 ? 'gs-pos' : dg < 0 ? 'gs-neg' : '';
    return `<tr>
      <td><span class="gs-rank" style="background:${color}22;color:${color};border:1px solid ${color}44">${i + 1}</span></td>
      <td class="gs-team">${teamFlag(t.team)}${escapeHtml(t.team)}</td>
      <td>${t.pj}</td>
      <td class="${dgClass}">${dgStr}</td>
      <td><strong>${pts}</strong></td>
    </tr>`;
  }).join('');
  return `
    <table class="group-standings-table">
      <thead><tr><th>#</th><th>Selección</th><th>PJ</th><th>DG</th><th>PTS</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderGroupSection(groupName, matches, predMap = {}) {
  const standings = computeGroupStandings(matches);
  const standingsHtml = standings.length ? renderGroupStandingsTable(standings) : '';
  const cardsHtml = matches.map(m => renderFixtureCard(m, { inGroup: true, prediction: predMap[m.id] ?? null })).join('');
  return `
    <section class="group-section">
      <button type="button" class="group-header group-toggle-btn" aria-expanded="true">
        <div>
          <h2 class="group-name">Grupo ${escapeHtml(groupName)}</h2>
          <span class="group-meta">${matches.length} partido${matches.length !== 1 ? 's' : ''}</span>
        </div>
        <i class="bi bi-chevron-down group-chevron" aria-hidden="true"></i>
      </button>
      <div class="group-body">
        ${standingsHtml}
        <p class="group-matches-label">Partidos del Grupo</p>
        <div class="group-matches-grid">${cardsHtml}</div>
      </div>
    </section>`;
}

async function loadFixtures() {
  const params = new URLSearchParams();
  if (elements.fixturePhaseFilter.value) params.set('phase', elements.fixturePhaseFilter.value);
  const [fixtures, userPreds] = await Promise.all([
    api(`/api/fixtures?${params}`),
    api('/api/predictions').catch(() => [])
  ]);
  const predMap = Object.fromEntries(
    userPreds.filter(m => m.prediction).map(m => [String(m.id), m.prediction])
  );
  const groupFilter = elements.fixtureGroupFilter ? elements.fixtureGroupFilter.value : '';
  const filtered = groupFilter ? fixtures.filter(m => m.group === groupFilter) : fixtures;
  if (!filtered.length) {
    elements.fixturesList.classList.add('cards-grid');
    elements.fixturesList.innerHTML = '<p>No hay partidos para ese filtro.</p>';
    return;
  }
  const grouped = filtered.filter(m => m.group);
  const ungrouped = filtered.filter(m => !m.group);
  if (grouped.length) {
    elements.fixturesList.classList.remove('cards-grid');
    const groupMap = {};
    for (const m of grouped) {
      if (!groupMap[m.group]) groupMap[m.group] = [];
      groupMap[m.group].push(m);
    }
    const groupsHtml = Object.entries(groupMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([g, ms]) => renderGroupSection(g, ms.slice().sort((a, b) => `${a.boliviaDate} ${a.boliviaTime}`.localeCompare(`${b.boliviaDate} ${b.boliviaTime}`)), predMap))
      .join('');
    const knockoutHtml = ungrouped.length
      ? `<div class="cards-grid knockout-grid">${ungrouped.map(m => renderFixtureCard(m, { prediction: predMap[String(m.id)] ?? null })).join('')}</div>`
      : '';
    elements.fixturesList.innerHTML = groupsHtml + knockoutHtml;
  } else {
    elements.fixturesList.classList.add('cards-grid');
    elements.fixturesList.innerHTML = ungrouped.map(m => renderFixtureCard(m, { prediction: predMap[String(m.id)] ?? null })).join('');
  }
}

function clearFixtureFilters() {
  elements.fixturePhaseFilter.value = '';
  if (elements.fixtureGroupFilter) elements.fixtureGroupFilter.value = '';
  loadFixtures();
}

async function updateFixtureResult(form) {
  const matchId = form.dataset.matchId;
  const homeScore = form.elements.homeScore.value === '' ? null : Number(form.elements.homeScore.value);
  const awayScore = form.elements.awayScore.value === '' ? null : Number(form.elements.awayScore.value);
  const status = form.elements.status.value;
  const advancer = form.elements.advancer?.value || null;
  const hasPenalties = form.elements.hasPenalties?.checked || false;
  const penaltyHomeScore = hasPenalties && form.elements.penaltyHomeScore?.value !== '' ? Number(form.elements.penaltyHomeScore.value) : null;
  const penaltyAwayScore = hasPenalties && form.elements.penaltyAwayScore?.value !== '' ? Number(form.elements.penaltyAwayScore.value) : null;
  await api(`/api/fixtures/${encodeURIComponent(matchId)}`, {
    method: 'PUT',
    body: JSON.stringify({ homeScore, awayScore, status, advancer, penaltyHomeScore, penaltyAwayScore })
  });
  await loadFixtures();
}

async function loadUsers() {
  const users = await api('/api/users');
  elements.usersTableBody.innerHTML = users.map((user) => {
    let statusLabel, statusClass;
    if (user.permanentlyBlocked) {
      statusLabel = 'Bloqueado';
      statusClass = 'blocked-status';
    } else if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      statusLabel = 'Bloqueado temp.';
      statusClass = 'locked-status';
    } else if (!user.active) {
      statusLabel = 'Inactivo';
      statusClass = 'inactive-status';
    } else {
      statusLabel = 'Activo';
      statusClass = '';
    }
    const roleIcon = user.role === 'admin' ? '<i class="bi bi-shield-fill" style="color:#f2b705;margin-right:0.3rem"></i>' : '';
    const unblockButton = (user.permanentlyBlocked || (user.lockedUntil && new Date(user.lockedUntil) > new Date()))
      ? `<button type="button" class="secondary-button" data-action="unblock-user" data-user-id="${escapeHtml(user.id)}"><i class="bi bi-unlock"></i> Desbloquear</button>`
      : '';
    return `
    <tr data-user-id="${escapeHtml(user.id)}">
      <td class="font-medium">${escapeHtml(user.username)}</td>
      <td>${roleIcon}${escapeHtml(user.role)}</td>
      <td><span class="status ${statusClass}">${statusLabel}</span></td>
      <td class="actions-cell">
        <button type="button" class="secondary-button" data-action="edit-user" data-user-id="${escapeHtml(user.id)}"><i class="bi bi-pencil"></i> Editar</button>
        <button type="button" class="danger-button" data-action="deactivate-user" data-user-id="${escapeHtml(user.id)}" ${user.active && !user.permanentlyBlocked ? '' : 'disabled'}><i class="bi bi-person-x"></i> Desactivar</button>
        ${unblockButton}
      </td>
    </tr>`;
  }).join('');
}

async function editUser(userId) {
  const existingRow = elements.usersTableBody.querySelector(`.user-edit-row[data-user-id="${CSS.escape(userId)}"]`);
  if (existingRow) { existingRow.remove(); return; }
  const users = await api('/api/users');
  const user = users.find((candidate) => candidate.id === userId);
  if (!user) return;
  const row = elements.usersTableBody.querySelector(`tr[data-user-id="${CSS.escape(userId)}"]`);
  const editRow = document.createElement('tr');
  editRow.className = 'user-edit-row';
  editRow.dataset.userId = userId;
  editRow.innerHTML = `<td colspan="4">
    <form class="user-edit-form" data-user-id="${escapeHtml(userId)}">
      <label>Usuario <input name="username" value="${escapeHtml(user.username)}" required maxlength="64"></label>
      <label>Rol
        <select name="role">
          <option value="user"${user.role === 'user' ? ' selected' : ''}>user</option>
          <option value="admin"${user.role === 'admin' ? ' selected' : ''}>admin</option>
        </select>
      </label>
      <label>Nueva contraseña <input name="password" type="password" autocomplete="new-password" maxlength="128" placeholder="Dejar vacío para mantener"></label>
      <div class="form-actions">
        <button type="submit">Guardar</button>
        <button type="button" class="secondary-button" data-action="cancel-edit" data-user-id="${escapeHtml(userId)}">Cancelar</button>
      </div>
    </form>
  </td>`;
  row.after(editRow);
}

function deactivateUser(userId) {
  const existingRow = elements.usersTableBody.querySelector(`.user-confirm-row[data-user-id="${CSS.escape(userId)}"]`);
  if (existingRow) { existingRow.remove(); return; }
  const row = elements.usersTableBody.querySelector(`tr[data-user-id="${CSS.escape(userId)}"]`);
  const confirmRow = document.createElement('tr');
  confirmRow.className = 'user-confirm-row';
  confirmRow.dataset.userId = userId;
  confirmRow.innerHTML = `<td colspan="4" class="confirm-deactivate-cell">
    <span>¿Desactivar este usuario? No podrá iniciar sesión.</span>
    <button type="button" class="danger-button" data-action="confirm-deactivate" data-user-id="${escapeHtml(userId)}">Desactivar</button>
    <button type="button" class="secondary-button" data-action="cancel-edit" data-user-id="${escapeHtml(userId)}">Cancelar</button>
  </td>`;
  row.after(confirmRow);
}

function filteredPredictions() {
  const date = state.selectedPredDate;
  const phase = elements.predictionPhaseFilter.value;
  return state.predictions
    .filter((match) => {
      const matchesDate = !date || match.boliviaDate === date;
      const matchesPhase = !phase || match.phase === phase;
      return matchesDate && matchesPhase;
    })
    .sort((a, b) => {
      const dateA = `${a.boliviaDate} ${a.boliviaTime || ''}`;
      const dateB = `${b.boliviaDate} ${b.boliviaTime || ''}`;
      return dateA.localeCompare(dateB) || a.id - b.id;
    });
}

function renderPredictionCard(match) {
  const prediction = match.prediction || {};
  const hasPrediction = prediction.homeScore !== undefined && prediction.homeScore !== null;
  const predBadge = hasPrediction
    ? `<span class="status final-status"><i class="bi bi-check2"></i> Mi predicción: ${prediction.homeScore} — ${prediction.awayScore}${prediction.advancer ? ` · ${escapeHtml(prediction.advancer)}` : ''}</span>`
    : `<span class="status scheduled-status">Sin predicción</span>`;

  const actionArea = match.locked
    ? `<span class="locked"><i aria-hidden="true" class="bi bi-lock-fill"></i> Partido cerrado</span>`
    : `<button type="button" class="predict-open-btn"
        data-match-id="${escapeHtml(String(match.id))}"
        data-home-team="${escapeHtml(match.homeTeam)}"
        data-away-team="${escapeHtml(match.awayTeam)}"
        data-home-score="${prediction.homeScore ?? ''}"
        data-away-score="${prediction.awayScore ?? ''}"
        data-advancer="${prediction.advancer ? escapeHtml(prediction.advancer) : ''}"
        data-raw-phase="${escapeHtml(match.phase)}"
        data-phase="${escapeHtml(match.roundName || match.phase)}"
        data-match-number="${match.matchNumber}">
        <i aria-hidden="true" class="bi bi-pencil-square"></i>
        ${hasPrediction ? 'Editar predicción' : 'Ingresar predicción'}
      </button>`;

  const hasScore = match.homeScore !== null && match.homeScore !== undefined;
  const isLive = (match.status || 'scheduled') === 'live';
  const scoreDisplay = hasScore
    ? `<div class="score-display${isLive ? ' live' : ''}">${match.homeScore} — ${match.awayScore}</div>`
    : `<div class="score-display vs">VS</div>`;
  const knockoutInfo = renderKnockoutResultInfo(match);

  return `
    <article class="match-card${isLive ? ' live-card' : ''}">
      <div class="match-header">
        <span class="match-phase">${escapeHtml(match.roundName || match.phase)}${match.group ? ` · Grupo ${escapeHtml(match.group)}` : ''}</span>
        ${fixtureStatusBadge(match)}
      </div>
      <div class="match-teams">
        <span class="team-name home">${escapeHtml(match.homeTeam)}${teamFlag(match.homeTeam)}</span>
        ${scoreDisplay}
        <span class="team-name away">${teamFlag(match.awayTeam)}${escapeHtml(match.awayTeam)}</span>
      </div>
      ${knockoutInfo}
      <div class="match-meta-row">
        <span class="meta-item"><i aria-hidden="true" class="bi bi-clock"></i> ${escapeHtml(match.boliviaDate)} ${escapeHtml(match.boliviaTime)} BOL</span>
        <span class="meta-item"><i aria-hidden="true" class="bi bi-geo-alt"></i> ${escapeHtml(match.city)}</span>
      </div>
      <div class="card-footer">
        ${predBadge}
        ${actionArea}
      </div>
    </article>
  `;
}

function renderPredictions() {
  const matches = filteredPredictions();
  elements.predictionsList.innerHTML = matches.length ? matches.map(renderPredictionCard).join('') : '<p>No hay partidos para ese filtro.</p>';
}

function clearPredictionFilters() {
  elements.predictionPhaseFilter.value = '';
  renderPredictions();
}

function getUniquePredDates() {
  return [...new Set(state.predictions.map(m => m.boliviaDate))].sort();
}

function formatCarouselDate(d) {
  const [, m, day] = d.split('-');
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return { day: parseInt(day, 10), month: months[parseInt(m, 10) - 1] };
}

function renderDateCarousel() {
  const dates = getUniquePredDates();
  const total = dates.length;
  const idx = state.dateCarouselIndex;
  const visible = dates.slice(idx, idx + 3);

  const selIdx = dates.indexOf(state.selectedPredDate);
  elements.dateCarouselPrev.disabled = selIdx <= 0;
  elements.dateCarouselNext.disabled = selIdx >= total - 1;

  elements.dateCarouselTrack.innerHTML = visible.map(d => {
    const { day, month } = formatCarouselDate(d);
    const count = state.predictions.filter(m => m.boliviaDate === d).length;
    const isActive = d === state.selectedPredDate;
    return `
      <button class="date-pill${isActive ? ' active' : ''}" data-date="${d}" type="button">
        <span class="date-pill-label">${month}</span>
        <span class="date-pill-day">${day}</span>
        <span class="date-pill-count">${count} partido${count !== 1 ? 's' : ''}</span>
      </button>`;
  }).join('');
}

function selectPredDate(date) {
  state.selectedPredDate = date;
  renderDateCarousel();
  renderPredictions();
}

async function loadPredictions() {
  const prevDate = state.selectedPredDate;
  state.predictions = await api('/api/predictions');
  const dates = getUniquePredDates();
  if (dates.length) {
    if (prevDate && dates.includes(prevDate)) {
      state.selectedPredDate = prevDate;
      const idx = dates.indexOf(prevDate);
      state.dateCarouselIndex = Math.max(0, Math.min(idx - 1, dates.length - 3));
    } else {
      const today = todayBoliviaDate();
      const todayIdx = dates.findIndex(d => d >= today);
      const pick = todayIdx >= 0 ? todayIdx : dates.length - 1;
      state.dateCarouselIndex = Math.max(0, pick - 1);
      state.selectedPredDate = dates[pick];
    }
  }
  renderDateCarousel();
  renderPredictions();
  renderUserPredFeed();
  populateActivityTeamFilter();
  renderActivityFeed();
}

function calcPredPoints(match) {
  if (!match.prediction || match.status !== 'final' || match.homeScore === null || match.awayScore === null) return null;
  const p = match.prediction;
  const getOutcome = (h, a) => h > a ? 'home' : h < a ? 'away' : 'draw';
  if (p.homeScore === match.homeScore && p.awayScore === match.awayScore) {
    const base = 5;
    const advancerBonus = KNOCKOUT_PHASES.has(match.phase) && getOutcome(match.homeScore, match.awayScore) === 'draw' && p.advancer && match.advancer && p.advancer === match.advancer ? 3 : 0;
    return base + advancerBonus;
  }
  const predictedOutcome = getOutcome(p.homeScore, p.awayScore);
  const actualOutcome = getOutcome(match.homeScore, match.awayScore);
  if (predictedOutcome !== actualOutcome) return 0;
  const advancerBonus = KNOCKOUT_PHASES.has(match.phase) && predictedOutcome === 'draw' && p.advancer && match.advancer && p.advancer === match.advancer ? 3 : 0;
  return 3 + advancerBonus;
}

function renderKnockoutResultInfo(match) {
  if (!KNOCKOUT_PHASES.has(match.phase)) return '';
  if (match.status !== 'final' || match.homeScore === null || match.awayScore === null) return '';
  const parts = [];
  if (match.penaltyHomeScore !== null && match.penaltyHomeScore !== undefined &&
      match.penaltyAwayScore !== null && match.penaltyAwayScore !== undefined) {
    parts.push(`Penales: ${match.penaltyHomeScore}-${match.penaltyAwayScore}`);
  }
  if (match.advancer) parts.push(`Clasifica: ${escapeHtml(match.advancer)}`);
  if (!parts.length) return '';
  return `<div class="knockout-result-info">${parts.join(' · ')}</div>`;
}

function renderUserPredFeed() {
  // Legacy feed removed — activity moved to activityView
}

function getMatchdayLabel(roundName) {
  if (!roundName) return '';
  const m = roundName.match(/Fecha\s+(\d+)/i);
  return m ? `Fecha ${m[1]}` : roundName;
}

function populateActivityTeamFilter() {
  // text input — nothing to populate
}

function renderActivityFeed() {
  if (!elements.activityFeed) return;
  const teamQuery = elements.activityTeamFilter ? elements.activityTeamFilter.value.trim().toLowerCase() : '';
  const withPred = state.predictions
    .filter(m => {
      if (!m.prediction) return false;
      if (teamQuery && !m.homeTeam.toLowerCase().includes(teamQuery) && !m.awayTeam.toLowerCase().includes(teamQuery)) return false;
      return true;
    })
    .sort((a, b) => `${b.boliviaDate} ${b.boliviaTime}`.localeCompare(`${a.boliviaDate} ${a.boliviaTime}`) || b.id - a.id);
  if (!withPred.length) {
    elements.activityFeed.innerHTML = '<li class="pred-feed-item"><span class="pred-feed-match">Sin predicciones aún.</span></li>';
    return;
  }
  elements.activityFeed.innerHTML = withPred.map(m => {
    const p = m.prediction;
    const pts = calcPredPoints(m);
    const hasResult = m.status === 'final' && m.homeScore !== null;
    const knockoutInfo = hasResult ? renderKnockoutResultInfo(m) : '';
    const resultHtml = hasResult
      ? `<span class="pred-feed-result">${m.homeScore} — ${m.awayScore}</span>${knockoutInfo}`
      : `<span class="pred-feed-result pending">Sin resultado</span>`;
    const ptsHtml = pts !== null
      ? `<span class="pred-feed-pts pts-${pts}">${pts} pts</span>`
      : '';
    const matchdayLabel = getMatchdayLabel(m.roundName);
    const groupLabel = m.group ? `Grupo ${escapeHtml(m.group)}` : '';
    const metaParts = [matchdayLabel, groupLabel].filter(Boolean);
    const metaHtml = metaParts.length
      ? `<span class="pred-feed-meta">${metaParts.map(escapeHtml).join(' · ')}</span>`
      : '';
    return `
      <li class="pred-feed-item">
        <div class="pred-feed-body">
          <span class="pred-feed-date">${escapeHtml(m.boliviaDate)}</span>
          ${metaHtml}
          <span class="pred-feed-match">${escapeHtml(m.homeTeam)} vs ${escapeHtml(m.awayTeam)}</span>
          ${fixtureStatusBadge(m)}
          <div class="pred-feed-row">
            <span class="pred-feed-label">Resultado:</span> ${resultHtml}
            <span class="pred-feed-sep">·</span>
            <span class="pred-feed-label">Mi pred:</span>
            <span class="pred-feed-score">${p.homeScore} — ${p.awayScore}${p.advancer ? ` · Clasif: ${escapeHtml(p.advancer)}` : ''}</span>
            ${ptsHtml}
          </div>
        </div>
      </li>`;
  }).join('');
}

function formatLockBanner(lockState, adminBypass = false) {
  if (!lockState?.firstR16Kickoff) {
    return '<div class="picks-lock-banner muted">Aún no hay un partido de 16vos cargado para calcular el cierre.</div>';
  }

  if (lockState.locked) {
    return `<div class="picks-lock-banner ${adminBypass ? 'admin-open' : 'locked'}">
      <strong>${adminBypass ? 'Lock activo para usuarios' : 'Picks cerrados'}</strong>
      <span>${adminBypass ? 'Como admin todavía podés editar.' : 'El cierre ocurrió 1 minuto antes del primer partido de 16vos.'}</span>
    </div>`;
  }

  return `<div class="picks-lock-banner open">
    <strong>Picks abiertos</strong>
    <span>Se cierran el ${escapeHtml(formatDate(lockState.lockAt))}.</span>
  </div>`;
}

function uniqueScorerNames() {
  const seen = new Set();
  for (const scorer of state.scorers.scorers || []) {
    const name = String(scorer && scorer.playerName || '').trim();
    if (name) seen.add(name);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

function picksTeams() {
  const teams = Array.isArray(state.picks.teams) ? state.picks.teams : [];
  return [...teams].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

function buildPicksOptions({ allowed, current, exclude }) {
  const allowedList = Array.isArray(allowed) ? allowed : [];
  const currentValue = String(current || '').trim();
  const excludeValue = String(exclude || '').trim();
  const seen = new Set();
  const values = [];

  for (const value of allowedList) {
    const trimmed = String(value || '').trim();
    if (!trimmed || trimmed === excludeValue || seen.has(trimmed)) continue;
    seen.add(trimmed);
    values.push(trimmed);
  }

  if (currentValue && !seen.has(currentValue) && currentValue !== excludeValue) {
    values.push(currentValue);
  }

  return values;
}

function renderPicksSelect({ name, placeholder, allowed, current, exclude = '', required = true }) {
  const values = buildPicksOptions({ allowed, current, exclude });
  const currentValue = String(current || '').trim();
  const isValid = values.includes(currentValue);
  const options = [`<option value="" disabled ${required && !isValid ? 'selected' : ''}>${escapeHtml(placeholder)}</option>`];
  for (const value of values) {
    const selected = value === currentValue ? 'selected' : '';
    options.push(`<option value="${escapeHtml(value)}" ${selected}>${escapeHtml(value)}</option>`);
  }
  return `<select name="${escapeHtml(name)}" ${required ? 'required' : ''}>${options.join('')}</select>`;
}

function refreshRunnerUpOptions() {
  const form = elements.picksFormContainer.querySelector('#picksForm');
  if (!form) return;
  const championSelect = form.querySelector('select[name="champion"]');
  const runnerUpSelect = form.querySelector('select[name="runnerUp"]');
  if (!championSelect || !runnerUpSelect) return;
  const currentRunnerUp = runnerUpSelect.value;
  const championValue = championSelect.value;
  runnerUpSelect.innerHTML = renderPicksSelect({
    name: 'runnerUp',
    placeholder: 'Seleccioná…',
    allowed: picksTeams(),
    current: currentRunnerUp,
    exclude: championValue
  });
}

function renderPicksCommunityTable() {
  const rows = state.picks.picks || [];
  if (!elements.picksCommunityTableBody) return;
  elements.picksCommunityTableBody.innerHTML = rows.map((pick) => `
    <tr>
      <td>${escapeHtml(pick.user)}</td>
      <td>${escapeHtml(pick.champion || '—')}</td>
      <td>${escapeHtml(pick.runnerUp || '—')}</td>
      <td>${escapeHtml(pick.topScorer || '—')}</td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="muted-text">Todavía no hay picks guardados.</td></tr>';
}

function renderPicksView() {
  const pick = state.picks.pick || {};
  const isAdmin = state.user?.role === 'admin';
  const saveDisabled = state.picks.locked && !isAdmin;
  const teams = picksTeams();
  const scorers = uniqueScorerNames();
  const championValue = String(pick.champion || '').trim();
  elements.picksLockBanner.innerHTML = formatLockBanner(state.picks, isAdmin);
  elements.picksFormContainer.innerHTML = `
    <form id="picksForm" class="picks-form-grid">
      <article class="picks-card">
        <span class="picks-card-kicker">+10 puntos</span>
        <h3>Campeón</h3>
        ${renderPicksSelect({ name: 'champion', placeholder: 'Seleccioná…', allowed: teams, current: pick.champion })}
      </article>
      <article class="picks-card">
        <span class="picks-card-kicker">+6 puntos</span>
        <h3>Subcampeón</h3>
        ${renderPicksSelect({ name: 'runnerUp', placeholder: 'Seleccioná…', allowed: teams, current: pick.runnerUp, exclude: championValue })}
      </article>
      <article class="picks-card">
        <span class="picks-card-kicker">+4 puntos</span>
        <h3>Goleador</h3>
        ${renderPicksSelect({ name: 'topScorer', placeholder: 'Seleccioná…', allowed: scorers, current: pick.topScorer })}
      </article>
      <div class="picks-actions-row">
        <button type="submit" class="prediction-modal-submit" ${saveDisabled ? 'disabled' : ''}>
          <i aria-hidden="true" class="bi bi-check-lg"></i> Guardar picks
        </button>
      </div>
    </form>
  `;
  renderPicksCommunityTable();
}

async function loadPicks() {
  const [picksData, scorersData] = await Promise.all([api('/api/picks'), api('/api/scorers')]);
  state.picks = picksData;
  state.scorers = scorersData;
  renderPicksView();
}

function renderScorersView() {
  const scorers = state.scorers.scorers || [];
  const isAdmin = state.user?.role === 'admin';
  elements.scorersBanner.textContent = state.scorers.source === 'manual' ? 'Admin-maintained' : state.scorers.source;
  elements.scorersTableBody.innerHTML = scorers.map((scorer) => `
    <tr>
      <td>${escapeHtml(scorer.playerName)}</td>
      <td>${escapeHtml(scorer.team)}</td>
      <td>${escapeHtml(scorer.goals)}</td>
      <td>${escapeHtml(scorer.matchesPlayed)}</td>
      <td>${escapeHtml(scorer.source)}</td>
      <td class="${isAdmin ? '' : 'hidden'}">${isAdmin ? `
        <div class="scorers-table-actions">
          <button type="button" class="secondary-button" data-action="edit-scorer" data-scorer-id="${escapeHtml(scorer.id)}">Editar</button>
          <button type="button" class="danger-button" data-action="delete-scorer" data-scorer-id="${escapeHtml(scorer.id)}">Eliminar</button>
        </div>` : ''}</td>
    </tr>
  `).join('') || `<tr><td colspan="${isAdmin ? 6 : 5}" class="muted-text">No hay goleadores cargados todavía.</td></tr>`;
}

async function loadScorers() {
  state.scorers = await api('/api/scorers');
  renderScorersView();
}

function populateScorerForm(scorerId) {
  const scorer = (state.scorers.scorers || []).find((candidate) => candidate.id === scorerId);
  if (!scorer) return;
  elements.scorersAdminForm.elements.scorerId.value = scorer.id;
  elements.scorersAdminForm.elements.playerName.value = scorer.playerName;
  elements.scorersAdminForm.elements.team.value = scorer.team;
  elements.scorersAdminForm.elements.goals.value = scorer.goals;
  elements.scorersAdminForm.elements.matchesPlayed.value = scorer.matchesPlayed;
  elements.cancelScorerEditButton.classList.remove('hidden');
}

function resetScorerForm() {
  elements.scorersAdminForm.reset();
  elements.scorersAdminForm.elements.scorerId.value = '';
  elements.cancelScorerEditButton.classList.add('hidden');
}

async function loadStandings() {
  const [{ standings, liveMatches }, prizePool] = await Promise.all([api('/api/standings'), api('/api/prize-pool')]);
  state.prizePool = prizePool;
  renderPrizePool();
  closeStandingDetailModal();

  const standingsTable = elements.standingsBody.closest('table');
  const theadRow = standingsTable.querySelector('thead tr');
  const standingsColgroup = standingsTable.querySelector('#standingsColgroup');
  const liveColumns = liveMatches.map((match) => {
    const hasLiveScore = match.homeScore !== null && match.homeScore !== undefined
      && match.awayScore !== null && match.awayScore !== undefined;
    const liveScore = hasLiveScore
      ? `${escapeHtml(match.homeScore)} — ${escapeHtml(match.awayScore)}`
      : '—';

    return {
      id: match.id,
      header: `<th class="standings-live-th" title="${escapeHtml(match.homeTeam)} vs ${escapeHtml(match.awayTeam)}">${escapeHtml(match.homeTeamShort)} ${liveScore} ${escapeHtml(match.awayTeamShort)}</th>`
    };
  });
  const totalColumns = 6 + liveColumns.length;
  const equalColumnWidth = `${100 / totalColumns}%`;
  standingsColgroup.innerHTML = `
    <col class="standings-col-rank" style="width:${equalColumnWidth}">
    <col class="standings-col-user" style="width:${equalColumnWidth}">
    ${liveColumns.map(() => `<col class="standings-col-live" style="width:${equalColumnWidth}">`).join('')}
    <col class="standings-col-points" style="width:${equalColumnWidth}">
    <col class="standings-col-points" style="width:${equalColumnWidth}">
    <col class="standings-col-points" style="width:${equalColumnWidth}">
    <col class="standings-col-actions" style="width:${equalColumnWidth}">
  `;
  const liveHeader = liveColumns.map((column) => column.header).join('');
  theadRow.innerHTML = `<th class="standings-rank-th">Posición</th><th class="standings-user-th">Usuario</th>${liveHeader}<th class="standings-points-th">Partido</th><th class="standings-points-th">Bonus</th><th class="standings-points-th">Total</th><th class="standings-actions-th">Opciones</th>`;

  const TROPHY_ICONS = ['', 'bi-trophy-fill text-yellow-400', 'bi-trophy-fill text-slate-400', 'bi-trophy-fill text-amber-700'];
  elements.standingsBody.innerHTML = standings.map((row) => {
    const rank = row.rank;
    const trophy = rank <= 3
      ? ` <i class="bi ${TROPHY_ICONS[rank]}" aria-hidden="true"></i>`
      : '';
    const livePredCells = liveColumns.map((column) => {
      const prediction = row.livePredictions?.[column.id] || null;
      const predictionText = prediction
        ? `<strong>${escapeHtml(prediction.homeScore)} — ${escapeHtml(prediction.awayScore)}</strong>`
        : '<span class="muted-text">—</span>';
      return `<td class="standings-live-td">${predictionText}</td>`;
    }).join('');
    return `
      <tr>
        <td class="font-bold standings-rank-td">${rank}${trophy}</td>
        <td class="standings-user-td">${escapeHtml(row.username)}</td>
        ${livePredCells}
        <td class="standings-points-td"><strong style="color:#38bdf8;font-size:1rem">${row.points}</strong></td>
        <td class="standings-points-td"><strong style="color:#22c55e;font-size:1rem">${row.bonusPoints}</strong></td>
        <td class="standings-points-td"><strong style="color:#f2b705;font-size:1rem">${row.totalPoints}</strong></td>
        <td class="standings-actions-td">${canViewStandingDetail(row) ? `<button type="button" class="secondary-button icon-button" data-action="view-standing-detail" data-user-id="${escapeHtml(row.userId)}" title="Ver detalle" aria-label="Ver detalle"><i class="bi bi-eye" aria-hidden="true"></i></button>` : '<span class="muted-text">—</span>'}</td>
      </tr>
    `;
  }).join('');
}

async function loadStandingsDetail() {
  const { standings } = await api('/api/standings');
  const TROPHY_ICONS = ['', 'bi-trophy-fill text-yellow-400', 'bi-trophy-fill text-slate-400', 'bi-trophy-fill text-amber-700'];
  elements.standingsDetailBody.innerHTML = standings.map((row) => {
    const rank = row.rank;
    const trophy = rank <= 3
      ? ` <i class="bi ${TROPHY_ICONS[rank]}" aria-hidden="true"></i>`
      : '';
    return `
      <tr>
        <td class="font-bold">${rank}${trophy}</td>
        <td>${escapeHtml(row.username)}</td>
        <td><strong style="color:#38bdf8;font-size:1rem">${row.points}</strong></td>
        <td><strong style="color:#22c55e;font-size:1rem">${row.bonusPoints}</strong></td>
        <td><strong style="color:#f2b705;font-size:1rem">${row.totalPoints}</strong></td>
        <td>${row.exactCount}</td>
        <td>${row.threeCount}</td>
        <td>${row.zeroCount}</td>
        <td>${row.goalDiffOnThree}</td>
        <td>${row.goalDiffOnZero}</td>
      </tr>
    `;
  }).join('');
}

function formatPrizeAmount(amount, currency = 'Bs') {
  return `${Number(amount).toLocaleString('es-BO', { maximumFractionDigits: 2 })} ${escapeHtml(currency)}`;
}

function prizeAmountFor(payout) {
  return (Number(state.prizePool.amount) * Number(payout.percent)) / 100;
}

function renderPrizePool() {
  const prizePool = state.prizePool;
  const adminFields = state.user?.role === 'admin' ? `
    <form class="prize-edit-form" id="prizePoolForm">
      <label>Monto total <input name="amount" type="number" min="0" step="0.01" value="${prizePool.amount}" required></label>
      ${prizePool.payouts.map((payout) => `
        <label>${payout.place}° lugar (%) <input name="place${payout.place}" type="number" min="0" max="100" step="1" value="${payout.percent}" required></label>
      `).join('')}
      <button type="submit">Guardar premios</button>
    </form>
  ` : '';

  elements.prizePoolPanel.innerHTML = `
    <div class="prize-hero">
      <span class="eyebrow">Bolsa acumulada</span>
      <strong>${formatPrizeAmount(prizePool.amount, prizePool.currency)}</strong>
      <p>Premios para el podio final de La Curva Mundial.</p>
    </div>
    <div class="prize-split">
      ${prizePool.payouts.map((payout) => `
        <article>
          <span>${payout.place}° Lugar</span>
          <strong>${payout.percent}%</strong>
          <small>${formatPrizeAmount(prizeAmountFor(payout), prizePool.currency)}</small>
        </article>
      `).join('')}
    </div>
    ${adminFields}
  `;
}

async function updatePrizePool(form) {
  const amount = Number(form.elements.amount.value);
  const payouts = [1, 2, 3].map((place) => ({
    place,
    percent: Number(form.elements[`place${place}`].value)
  }));
  state.prizePool = await api('/api/prize-pool', {
    method: 'PUT',
    body: JSON.stringify({ amount, payouts })
  });
  renderPrizePool();
}

function renderSettingsForm(settings) {
  const form = elements.settingsForm;
  form.elements.predictionLockMs.value = settings.predictionLockMs;
  form.elements.lockoutAttempts.value = settings.lockoutAttempts;
  form.elements.lockoutDurationMs.value = settings.lockoutDurationMs;
  form.elements.maxTemporaryLockouts.value = settings.maxTemporaryLockouts;
  form.elements.lockoutResetMs.value = settings.lockoutResetMs;
  form.elements.worldcupSyncEnabled.checked = Boolean(settings.worldcupSync?.enabled);
  form.elements.worldcupSyncPollIntervalMs.value = settings.worldcupSync?.pollIntervalMs;
  form.elements.fixtureRefreshMs.value = settings.fixtureRefreshMs;
  form.elements.tiebreakExactCountEnabled.checked = Boolean(settings.standingsTiebreak?.exactCountEnabled);
  form.elements.tiebreakGoalDiffOnThreeEnabled.checked = Boolean(settings.standingsTiebreak?.goalDiffOnThreeEnabled);
  form.elements.tiebreakGoalDiffOnZeroEnabled.checked = Boolean(settings.standingsTiebreak?.goalDiffOnZeroEnabled);
}

async function loadSettings() {
  const settings = await api('/api/settings');
  renderSettingsForm(settings);
}

async function saveSettings(form) {
  const payload = {
    predictionLockMs: Number(form.elements.predictionLockMs.value),
    lockoutAttempts: Number(form.elements.lockoutAttempts.value),
    lockoutDurationMs: Number(form.elements.lockoutDurationMs.value),
    maxTemporaryLockouts: Number(form.elements.maxTemporaryLockouts.value),
    lockoutResetMs: Number(form.elements.lockoutResetMs.value),
    worldcupSync: {
      enabled: form.elements.worldcupSyncEnabled.checked,
      pollIntervalMs: Number(form.elements.worldcupSyncPollIntervalMs.value)
    },
    fixtureRefreshMs: Number(form.elements.fixtureRefreshMs.value),
    standingsTiebreak: {
      exactCountEnabled: form.elements.tiebreakExactCountEnabled.checked,
      goalDiffOnThreeEnabled: form.elements.tiebreakGoalDiffOnThreeEnabled.checked,
      goalDiffOnZeroEnabled: form.elements.tiebreakGoalDiffOnZeroEnabled.checked
    }
  };
  const updated = await api('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
  renderSettingsForm(updated);
  setMessage(elements.settingsMessage, 'Configuración guardada correctamente.', true);
}

function canViewStandingDetail() {
  return true;
}

function formatScore(homeScore, awayScore) {
  return homeScore === null || awayScore === null ? 'Pendiente' : `${homeScore} - ${awayScore}`;
}

function formatPrediction(prediction) {
  return prediction ? `${prediction.homeScore} - ${prediction.awayScore}` : 'Sin predicción';
}

function closeStandingDetailModal() {
  elements.standingDetailModal.classList.add('hidden');
  elements.standingDetailModalContent.innerHTML = '';
}

async function loadStandingDetail(userId) {
  const data = await api(`/api/standings/${encodeURIComponent(userId)}`);
  elements.standingDetailModalTitle.innerHTML =
    `<i class="bi bi-person-circle" aria-hidden="true" style="color:#f2b705;margin-right:0.4rem"></i>${escapeHtml(data.user.username)}`;
  elements.standingDetailModalPts.innerHTML =
    `Total: <strong style="color:#f2b705">${data.totalPoints}</strong> pts · Partido: <strong style="color:#38bdf8">${data.matchPoints}</strong> · Bonus: <strong style="color:#22c55e">${data.bonusPoints}</strong>`;
  elements.standingDetailModalContent.innerHTML = `
    <table>
      <thead>
        <tr><th>#</th><th>Fecha</th><th>Encuentro</th><th>Resultado</th><th>Predicción</th><th>Pts</th></tr>
      </thead>
      <tbody>
        ${data.details.map((detail) => {
          const pts = detail.points;
          const ptsColor = pts === 5 ? '#22c55e' : pts === 3 ? '#f2b705' : '#475569';
          return `
            <tr>
              <td>${detail.matchNumber}</td>
              <td>${escapeHtml(detail.boliviaDate)}</td>
              <td>${escapeHtml(detail.homeTeam)} vs ${escapeHtml(detail.awayTeam)}</td>
              <td>${escapeHtml(formatScore(detail.homeScore, detail.awayScore))}</td>
              <td>${escapeHtml(formatPrediction(detail.prediction))}</td>
              <td><strong style="color:${ptsColor}">${pts}</strong></td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
  elements.standingDetailModal.classList.remove('hidden');
}

async function loadRules() {
  const { rules } = await api('/api/rules');
  const icons = ['bi-star-fill', 'bi-check2-circle', 'bi-x-circle', 'bi-clock', 'bi-shield-check', 'bi-trophy'];
  elements.rulesList.innerHTML = rules.map((rule, i) => `
    <article class="rule-card${rule.enabled === false ? ' disabled' : ''}">
      <h3><i class="bi ${icons[i % icons.length]}" aria-hidden="true" style="color:#f2b705;margin-right:0.5rem"></i>${escapeHtml(rule.title)}</h3>
      <p>${escapeHtml(rule.description)}</p>
    </article>
  `).join('');
}

function actionLabel(action) {
  const labels = {
    login_success: 'Login correcto',
    login_failed: 'Login fallido',
    logout: 'Logout',
    menu_viewed: 'Menú visitado',
    user_created: 'Usuario creado',
    user_updated: 'Usuario editado',
      user_deactivated: 'Usuario desactivado',
      pick_created: 'Pick creado',
      pick_updated: 'Pick actualizado',
      pick_override: 'Pick sobrescrito',
      prediction_created: 'Predicción creada',
      prediction_updated: 'Predicción editada',
      scorer_manual_create: 'Goleador creado',
      scorer_manual_update: 'Goleador editado',
      scorer_manual_delete: 'Goleador eliminado',
      prize_pool_updated: 'Premios actualizados',
      standing_detail_viewed: 'Detalle de tabla visto'
    };
  return labels[action] || action;
}

function formatAuditDetail(detail) {
  if (!detail || typeof detail !== 'object') return '';
  if (detail.view) return `Vista: ${detail.view}`;
  if (detail.targetUsername) return `Usuario: ${detail.targetUsername}`;
  if (detail.playerName) return `Jugador: ${detail.playerName}`;
  if (detail.picks) return `Picks: ${detail.picks.champion} / ${detail.picks.runnerUp} / ${detail.picks.topScorer}`;
  if (detail.matchNumber) return `Partido ${detail.matchNumber}: ${detail.homeTeam} vs ${detail.awayTeam} (${detail.homeScore}-${detail.awayScore})`;
  if (detail.username) return `Usuario: ${detail.username}`;
  return JSON.stringify(detail);
}

async function loadAuditLog() {
  state.auditShowingAll = false;
  if (!elements.auditDateFilter.value) {
    elements.auditDateFilter.value = todayBoliviaDate();
  }
  state.auditLogs = await api('/api/audit-log?date=' + elements.auditDateFilter.value);
  renderAuditLog();
}

function filteredAuditLogs() {
  const user = elements.auditUserFilter.value.trim().toLowerCase();
  const action = elements.auditActionFilter.value;
  return state.auditLogs.filter((entry) => {
    const matchesUser = !user || String(entry.username || '').toLowerCase().includes(user);
    const matchesAction = !action || entry.action === action;
    return matchesUser && matchesAction;
  });
}

function renderAuditLog() {
  const logs = filteredAuditLogs();
  const actionIcons = {
    login_success: 'bi-box-arrow-in-right text-green-500',
    login_failed: 'bi-exclamation-triangle text-red-400',
    logout: 'bi-box-arrow-left text-slate-400',
    menu_viewed: 'bi-eye text-slate-400',
    user_created: 'bi-person-plus text-blue-400',
    user_updated: 'bi-pencil text-yellow-400',
    user_deactivated: 'bi-person-x text-red-400',
    prediction_created: 'bi-pencil-square text-green-400',
    prediction_updated: 'bi-arrow-clockwise text-yellow-400',
    standing_detail_viewed: 'bi-bar-chart text-slate-400',
  };
  elements.auditLogBody.innerHTML = logs.length ? logs.map((entry) => {
    const icon = actionIcons[entry.action] || 'bi-circle text-slate-500';
    return `
      <tr>
        <td style="font-size:0.75rem;white-space:nowrap">${escapeHtml(formatDate(entry.timestamp))}</td>
        <td class="font-medium">${escapeHtml(entry.username || 'Sistema')}</td>
        <td>${escapeHtml(entry.role || '—')}</td>
        <td><i class="bi ${icon}" aria-hidden="true"></i> ${escapeHtml(actionLabel(entry.action))}</td>
        <td style="color:#64748b;font-size:0.78rem">${escapeHtml(formatAuditDetail(entry.detail))}</td>
      </tr>
    `;
  }).join('') : '<tr><td colspan="5" style="text-align:center;color:#475569;padding:2rem">No hay acciones registradas.</td></tr>';
}

async function clearAuditFilters() {
  elements.auditUserFilter.value = '';
  elements.auditActionFilter.value = '';
  elements.auditDateFilter.value = '';
  state.auditShowingAll = true;
  state.auditLogs = await api('/api/audit-log?date=all');
  renderAuditLog();
}

elements.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(elements.loginMessage, '');
  const username = document.querySelector('#loginUsername').value;
  const password = document.querySelector('#loginPassword').value;
  try {
    const { user } = await api('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    elements.loginForm.reset();
    showAuthenticatedApp(user);
  } catch (error) {
    setMessage(elements.loginMessage, error.message);
  }
});

elements.createUserForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(elements.createUserMessage, '');
  const username = document.querySelector('#newUsername').value;
  const password = document.querySelector('#newPassword').value;
  const role = document.querySelector('#newRole').value;
  try {
    await api('/api/users', { method: 'POST', body: JSON.stringify({ username, password, role }) });
    elements.createUserForm.reset();
    await loadUsers();
    setMessage(elements.createUserMessage, 'Usuario creado correctamente.', true);
  } catch (error) {
    setMessage(elements.createUserMessage, error.message);
  }
});

elements.menuButtons.forEach((button) => {
  button.addEventListener('click', () => showView(button.dataset.view));
});

document.querySelectorAll('.password-toggle').forEach((btn) => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    const icon = btn.querySelector('i');
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    icon.className = isHidden ? 'bi bi-eye-slash' : 'bi bi-eye';
    btn.setAttribute('aria-label', isHidden ? 'Ocultar contraseña' : 'Mostrar contraseña');
  });
});

elements.hideSidebarButton.addEventListener('click', () => setSidebarVisible(false));
elements.showSidebarButton.addEventListener('click', () => setSidebarVisible(true));
elements.logoutButton.addEventListener('click', () => logout());
if (elements.mobileLogoutButton) elements.mobileLogoutButton.addEventListener('click', () => logout());
elements.usersTableBody.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, userId } = button.dataset;
  try {
    if (action === 'edit-user') await editUser(userId);
    if (action === 'deactivate-user') deactivateUser(userId);
    if (action === 'cancel-edit') button.closest('.user-edit-row, .user-confirm-row')?.remove();
    if (action === 'confirm-deactivate') {
      await api(`/api/users/${encodeURIComponent(userId)}/deactivate`, { method: 'PATCH' });
      await loadUsers();
      setMessage(elements.createUserMessage, 'Usuario desactivado correctamente.', true);
    }
    if (action === 'unblock-user') {
      await api(`/api/users/${encodeURIComponent(userId)}/unblock`, { method: 'PATCH' });
      await loadUsers();
      setMessage(elements.createUserMessage, 'Usuario desbloqueado correctamente.', true);
    }
  } catch (error) {
    setMessage(elements.createUserMessage, error.message);
  }
});
elements.usersTableBody.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target.closest('.user-edit-form');
  if (!form) return;
  const userId = form.dataset.userId;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const users = await api('/api/users');
    const user = users.find((candidate) => candidate.id === userId);
    if (!user) return;
    await api(`/api/users/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      body: JSON.stringify({ username: form.elements.username.value.trim(), role: form.elements.role.value, password: form.elements.password.value, active: user.active })
    });
    await loadUsers();
    setMessage(elements.createUserMessage, 'Usuario actualizado correctamente.', true);
  } catch (error) {
    setMessage(elements.createUserMessage, error.message);
    button.disabled = false;
  }
});
elements.picksFormContainer.addEventListener('change', (event) => {
  if (!event.target.matches('select[name="champion"]')) return;
  refreshRunnerUpOptions();
});
elements.picksFormContainer.addEventListener('submit', async (event) => {
  const form = event.target.closest('#picksForm');
  if (!form) return;
  event.preventDefault();
  const payload = {
    champion: form.elements.champion.value.trim(),
    runnerUp: form.elements.runnerUp.value.trim(),
    topScorer: form.elements.topScorer.value.trim()
  };
  const method = state.picks.pick ? 'PUT' : 'POST';
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api('/api/picks', { method, body: JSON.stringify(payload) });
    await loadPicks();
    setMessage(elements.picksMessage, 'Picks guardados correctamente.', true);
  } catch (error) {
    setMessage(elements.picksMessage, presentError(error));
  } finally {
    button.disabled = false;
  }
});
elements.standingsBody.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action="view-standing-detail"]');
  if (!button) return;
  try {
    await loadStandingDetail(button.dataset.userId);
  } catch (error) {
    setMessage(elements.standingsMessage, error.message);
  }
});
elements.scorersAdminForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const scorerId = form.elements.scorerId.value;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api(scorerId ? `/api/admin/scorers/${encodeURIComponent(scorerId)}` : '/api/admin/scorers', {
      method: scorerId ? 'PUT' : 'POST',
      body: JSON.stringify({
        playerName: form.elements.playerName.value.trim(),
        team: form.elements.team.value.trim(),
        goals: Number(form.elements.goals.value),
        matchesPlayed: Number(form.elements.matchesPlayed.value)
      })
    });
    resetScorerForm();
    await loadScorers();
    setMessage(elements.scorersMessage, 'Tabla de goleadores actualizada.', true);
    if (state.currentView === 'picksView') await loadPicks();
  } catch (error) {
    setMessage(elements.scorersMessage, presentError(error));
  } finally {
    button.disabled = false;
  }
});
elements.cancelScorerEditButton.addEventListener('click', resetScorerForm);
elements.scorersTableBody.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const scorerId = button.dataset.scorerId;
  try {
    if (button.dataset.action === 'edit-scorer') {
      populateScorerForm(scorerId);
      return;
    }
    if (button.dataset.action === 'delete-scorer') {
      await api(`/api/admin/scorers/${encodeURIComponent(scorerId)}`, { method: 'DELETE' });
      await loadScorers();
      if (state.currentView === 'picksView') await loadPicks();
      setMessage(elements.scorersMessage, 'Goleador eliminado correctamente.', true);
    }
  } catch (error) {
    setMessage(elements.scorersMessage, presentError(error));
  }
});
elements.prizePoolPanel.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  if (!form.classList.contains('prize-edit-form')) return;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await updatePrizePool(form);
  } catch (error) {
    setMessage(elements.standingsMessage, error.message);
  } finally {
    button.disabled = false;
  }
});
elements.settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await saveSettings(form);
  } catch (error) {
    setMessage(elements.settingsMessage, error.message);
  } finally {
    button.disabled = false;
  }
});
elements.standingDetailModalClose.addEventListener('click', closeStandingDetailModal);
elements.standingDetailModal.addEventListener('click', (event) => {
  if (event.target === elements.standingDetailModal) closeStandingDetailModal();
});
elements.fixturePhaseFilter.addEventListener('change', loadFixtures);
if (elements.fixtureGroupFilter) elements.fixtureGroupFilter.addEventListener('change', loadFixtures);
elements.clearFixtureFilters.addEventListener('click', clearFixtureFilters);
elements.predictionPhaseFilter.addEventListener('change', renderPredictions);
elements.clearPredictionFilters.addEventListener('click', clearPredictionFilters);
if (elements.activityTeamFilter) elements.activityTeamFilter.addEventListener('input', renderActivityFeed);
if (elements.clearActivityFilters) elements.clearActivityFilters.addEventListener('click', () => {
  elements.activityTeamFilter.value = '';
  renderActivityFeed();
});
elements.dateCarouselPrev.addEventListener('click', () => {
  const dates = getUniquePredDates();
  const selIdx = dates.indexOf(state.selectedPredDate);
  if (selIdx <= 0) return;
  const newSel = selIdx - 1;
  state.selectedPredDate = dates[newSel];
  if (newSel < state.dateCarouselIndex) state.dateCarouselIndex = newSel;
  renderDateCarousel();
  renderPredictions();
});
elements.dateCarouselNext.addEventListener('click', () => {
  const dates = getUniquePredDates();
  const selIdx = dates.indexOf(state.selectedPredDate);
  if (selIdx >= dates.length - 1) return;
  const newSel = selIdx + 1;
  state.selectedPredDate = dates[newSel];
  if (newSel >= state.dateCarouselIndex + 3) state.dateCarouselIndex = newSel - 2;
  renderDateCarousel();
  renderPredictions();
});
elements.dateCarouselTrack.addEventListener('click', (e) => {
  const pill = e.target.closest('.date-pill');
  if (!pill) return;
  selectPredDate(pill.dataset.date);
});
elements.auditDateFilter.addEventListener('change', loadAuditLog);
elements.auditUserFilter.addEventListener('input', renderAuditLog);
elements.auditActionFilter.addEventListener('change', renderAuditLog);
elements.clearAuditFilters.addEventListener('click', clearAuditFilters);

elements.fixturesList.addEventListener('click', (event) => {
  const toggleBtn = event.target.closest('.group-toggle-btn');
  if (toggleBtn) {
    const section = toggleBtn.closest('.group-section');
    const collapsed = section.classList.toggle('collapsed');
    toggleBtn.setAttribute('aria-expanded', String(!collapsed));
    return;
  }
  const btn = event.target.closest('.admin-toggle-btn');
  if (!btn) return;
  const card = btn.closest('.match-card');
  const form = card?.querySelector('.fixture-update-form');
  if (!form) return;
  const isOpen = !form.classList.contains('hidden');
  form.classList.toggle('hidden', isOpen);
  btn.innerHTML = isOpen
    ? '<i class="bi bi-pencil-square"></i> Editar resultado'
    : '<i class="bi bi-x-lg"></i> Cerrar';
});

elements.fixturesList.addEventListener('input', (event) => {
  const form = event.target.closest('.fixture-update-form');
  if (!form || form.dataset.isKnockout !== 'true') return;
  const homeScore = form.elements.homeScore.value;
  const awayScore = form.elements.awayScore.value;
  const status = form.elements.status.value;
  const isDraw = homeScore !== '' && awayScore !== '' && Number(homeScore) === Number(awayScore);
  const show = isDraw && status === 'final';
  const advancerSelect = form.querySelector('.advancer-select');
  if (advancerSelect) {
    advancerSelect.classList.toggle('hidden', !show);
    if (!show) advancerSelect.value = '';
  }
  const penaltyLabel = form.querySelector('.penalty-checkbox-label');
  if (penaltyLabel) {
    penaltyLabel.classList.toggle('hidden', !show);
    if (!show) {
      const cb = form.elements.hasPenalties;
      if (cb) cb.checked = false;
      form.querySelectorAll('.penalty-input, .penalty-sep').forEach(el => {
        el.classList.add('hidden');
        if (el.tagName === 'INPUT') el.value = '';
      });
    }
  }
});

elements.fixturesList.addEventListener('change', (event) => {
  const cb = event.target;
  if (cb.name !== 'hasPenalties') return;
  const form = cb.closest('.fixture-update-form');
  if (!form) return;
  form.querySelectorAll('.penalty-input, .penalty-sep').forEach(el => {
    el.classList.toggle('hidden', !cb.checked);
    if (!cb.checked && el.tagName === 'INPUT') el.value = '';
  });
});

elements.fixturesList.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  if (!form.classList.contains('fixture-update-form')) return;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await updateFixtureResult(form);
  } catch (error) {
    setMessage(elements.fixturesMessage, error.message);
  } finally {
    button.disabled = false;
  }
});

// Prediction modal helpers
const predModal = {
  el: document.querySelector('#predictionModal'),
  form: document.querySelector('#predictionModalForm'),
  open(match) {
    document.querySelector('#predictionModalPhase').textContent =
      `${match.phase} · #${match.matchNumber}`;
    document.querySelector('#predictionModalHome').innerHTML = escapeHtml(match.homeTeam) + teamFlag(match.homeTeam);
    document.querySelector('#predictionModalAway').innerHTML = teamFlag(match.awayTeam) + escapeHtml(match.awayTeam);
    document.querySelector('#predictionModalHomeLabel').textContent = match.homeTeam;
    document.querySelector('#predictionModalAwayLabel').textContent = match.awayTeam;
    const homeVal = match.homeScore !== '' && match.homeScore != null ? Number(match.homeScore) : 0;
    const awayVal = match.awayScore !== '' && match.awayScore != null ? Number(match.awayScore) : 0;
    document.querySelector('#predictionModalHomeScore').value = homeVal;
    document.querySelector('#predictionModalAwayScore').value = awayVal;
    document.querySelector('#predictionModalHomeDisplay').textContent = homeVal;
    document.querySelector('#predictionModalAwayDisplay').textContent = awayVal;
    document.querySelector('#predictionModalFeedback').classList.add('hidden');
    this.form.dataset.matchId = match.matchId;
    this._isKnockout = KNOCKOUT_PHASES.has(match.rawPhase);
    const advancerRow = document.querySelector('#predictionModalAdvancerRow');
    const homeRadio = document.querySelector('#predictionModalAdvancerHome');
    const awayRadio = document.querySelector('#predictionModalAdvancerAway');
    homeRadio.value = match.homeTeam;
    awayRadio.value = match.awayTeam;
    document.querySelector('#predictionModalAdvancerHomeName').textContent = match.homeTeam;
    document.querySelector('#predictionModalAdvancerAwayName').textContent = match.awayTeam;
    homeRadio.checked = false;
    awayRadio.checked = false;
    if (this._isKnockout && homeVal === awayVal) {
      advancerRow.classList.remove('hidden');
      if (match.advancer === match.homeTeam) homeRadio.checked = true;
      else if (match.advancer === match.awayTeam) awayRadio.checked = true;
    } else {
      advancerRow.classList.add('hidden');
    }
    this.el.classList.remove('hidden');
  },
  close() { this.el.classList.add('hidden'); }
};

function openPredModalFromBtn(btn) {
  predModal.open({
    matchId: btn.dataset.matchId,
    homeTeam: btn.dataset.homeTeam,
    awayTeam: btn.dataset.awayTeam,
    homeScore: btn.dataset.homeScore,
    awayScore: btn.dataset.awayScore,
    advancer: btn.dataset.advancer || null,
    rawPhase: btn.dataset.rawPhase || '',
    phase: btn.dataset.phase,
    matchNumber: btn.dataset.matchNumber
  });
}

elements.predictionsList.addEventListener('click', (event) => {
  const btn = event.target.closest('.predict-open-btn');
  if (btn) openPredModalFromBtn(btn);
});

elements.fixturesList.addEventListener('click', (event) => {
  const btn = event.target.closest('.predict-open-btn');
  if (btn) openPredModalFromBtn(btn);
});

document.querySelector('#predictionModalClose').addEventListener('click', () => predModal.close());

document.querySelector('#predictionModalForm').addEventListener('click', (e) => {
  const btn = e.target.closest('.score-stepper-btn');
  if (!btn) return;
  const side = btn.dataset.target;
  const delta = Number(btn.dataset.delta);
  const displayId = side === 'home' ? '#predictionModalHomeDisplay' : '#predictionModalAwayDisplay';
  const inputId = side === 'home' ? '#predictionModalHomeScore' : '#predictionModalAwayScore';
  const hiddenInput = document.querySelector(inputId);
  const display = document.querySelector(displayId);
  const newVal = Math.max(0, Number(hiddenInput.value) + delta);
  hiddenInput.value = newVal;
  display.textContent = newVal;
  if (predModal._isKnockout) {
    const h = Number(document.querySelector('#predictionModalHomeScore').value);
    const a = Number(document.querySelector('#predictionModalAwayScore').value);
    const advancerRow = document.querySelector('#predictionModalAdvancerRow');
    if (h === a) {
      advancerRow.classList.remove('hidden');
    } else {
      advancerRow.classList.add('hidden');
      document.querySelector('#predictionModalAdvancerHome').checked = false;
      document.querySelector('#predictionModalAdvancerAway').checked = false;
    }
  }
});
document.querySelector('#predictionModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) predModal.close();
});

document.querySelector('#predictionModalForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const matchId = form.dataset.matchId;
  const homeScore = Number(form.elements.homeScore.value);
  const awayScore = Number(form.elements.awayScore.value);
  const advancer = form.elements.advancer?.value || null;
  const submitBtn = document.querySelector('#predictionModalSubmit');
  submitBtn.disabled = true;
  try {
    await api('/api/predictions', { method: 'POST', body: JSON.stringify({ matchId, homeScore, awayScore, advancer }) });
    const feedback = document.querySelector('#predictionModalFeedback');
    feedback.textContent = 'Predicción guardada correctamente.';
    feedback.classList.remove('hidden');
    setTimeout(async () => {
      predModal.close();
      await loadPredictions();
      if (state.currentView === 'fixturesView') await loadFixtures();
    }, 900);
  } catch (error) {
    setMessage(elements.predictionsMessage, error.message);
    predModal.close();
  } finally {
    submitBtn.disabled = false;
  }
});

['click', 'keydown', 'mousemove', 'touchstart'].forEach((eventName) => {
  document.addEventListener(eventName, resetInactivityTimer, { passive: true });
});

api('/api/session')
  .then(({ user, inactivityLimitMs, fixtureRefreshMs }) => {
    state.inactivityLimitMs = inactivityLimitMs;
    state.fixtureRefreshMs = fixtureRefreshMs;
    if (user) showAuthenticatedApp(user);
    else showLogin();
  })
  .catch(() => showLogin());
