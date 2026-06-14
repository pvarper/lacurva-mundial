const state = {
  user: null,
  inactivityLimitMs: 120 * 60 * 1000,
  inactivityTimer: null,
  fixtureRefreshTimer: null,
  currentView: null,
  predictions: [],
  prizePool: null,
  auditLogs: []
};

const FIXTURE_REFRESH_MS = 30 * 1000;

const fixtureStatusLabels = {
  scheduled: 'Programado',
  live: 'EN VIVO',
  final: 'FINALIZADO'
};

const elements = {
  loginView: document.querySelector('#loginView'),
  appView: document.querySelector('#appView'),
  loginForm: document.querySelector('#loginForm'),
  loginMessage: document.querySelector('#loginMessage'),
  sidebarCurrentUser: document.querySelector('#sidebarCurrentUser'),
  logoutButton: document.querySelector('#logoutButton'),
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
  fixtureDateFilter: document.querySelector('#fixtureDateFilter'),
  fixtureTeamFilter: document.querySelector('#fixtureTeamFilter'),
  fixturePhaseFilter: document.querySelector('#fixturePhaseFilter'),
  clearFixtureFilters: document.querySelector('#clearFixtureFilters'),
  predictionsList: document.querySelector('#predictionsList'),
  predictionDateFilter: document.querySelector('#predictionDateFilter'),
  predictionTeamFilter: document.querySelector('#predictionTeamFilter'),
  predictionPhaseFilter: document.querySelector('#predictionPhaseFilter'),
  clearPredictionFilters: document.querySelector('#clearPredictionFilters'),
  standingsBody: document.querySelector('#standingsBody'),
  standingDetail: document.querySelector('#standingDetail'),
  prizePoolPanel: document.querySelector('#prizePoolPanel'),
  fixturesMessage: document.querySelector('#fixturesMessage'),
  predictionsMessage: document.querySelector('#predictionsMessage'),
  standingsMessage: document.querySelector('#standingsMessage'),
  rulesList: document.querySelector('#rulesList'),
  auditLogBody: document.querySelector('#auditLogBody'),
  auditDateFilter: document.querySelector('#auditDateFilter'),
  auditUserFilter: document.querySelector('#auditUserFilter'),
  auditActionFilter: document.querySelector('#auditActionFilter'),
  clearAuditFilters: document.querySelector('#clearAuditFilters')
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

function setSidebarVisible(visible) {
  elements.appView.classList.toggle('sidebar-collapsed', !visible);
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
    if (!elements.fixtureDateFilter.value) elements.fixtureDateFilter.value = todayBoliviaDate();
    loadFixtures().catch(() => {});
    startFixtureAutoRefresh();
  } else {
    stopFixtureAutoRefresh();
  }
  if (viewId === 'usersView') loadUsers();
  if (viewId === 'predictionsView') {
    if (!elements.predictionDateFilter.value) elements.predictionDateFilter.value = todayBoliviaDate();
    loadPredictions();
  }
  if (viewId === 'standingsView') loadStandings();
  if (viewId === 'rulesView') loadRules();
  if (viewId === 'auditView') loadAuditLog();
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
  const isAdmin = user.role === 'admin';
  elements.usersMenu.classList.toggle('hidden', !isAdmin);
  elements.auditMenu.classList.toggle('hidden', !isAdmin);
  const adminLabel = document.querySelector('#adminSectionLabel');
  if (adminLabel) adminLabel.classList.toggle('hidden', !isAdmin);
  const bottomNav = document.querySelector('#bottomNav');
  if (bottomNav) bottomNav.classList.remove('hidden');
  showView('fixturesView');
  resetInactivityTimer();
}

function showLogin(message = '') {
  state.user = null;
  state.currentView = null;
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
  }, FIXTURE_REFRESH_MS);
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
  return `
    <form class="fixture-update-form" data-match-id="${escapeHtml(match.id)}">
      <p class="admin-label"><i class="bi bi-shield-fill" style="color:#f2b705"></i> Admin · resultado</p>
      <div class="admin-score-row">
        <input name="homeScore" type="number" min="0" step="1" value="${match.homeScore ?? ''}" placeholder="—" class="score-input">
        <span class="score-sep">—</span>
        <input name="awayScore" type="number" min="0" step="1" value="${match.awayScore ?? ''}" placeholder="—" class="score-input">
        <select name="status" class="status-select">
          <option value="scheduled" ${status === 'scheduled' ? 'selected' : ''}>Programado</option>
          <option value="live" ${status === 'live' ? 'selected' : ''}>En vivo</option>
          <option value="final" ${status === 'final' ? 'selected' : ''}>Finalizado</option>
        </select>
        <button type="submit" class="save-btn"><i class="bi bi-check-lg"></i> Guardar</button>
      </div>
    </form>
  `;
}

function renderFixtureCard(match) {
  const hasScore = match.homeScore !== null && match.awayScore !== null;
  const isLive = (match.status || 'scheduled') === 'live';
  const scoreHtml = hasScore
    ? `<div class="score-display">${match.homeScore} — ${match.awayScore}</div>`
    : `<div class="score-display vs">VS</div>`;

  return `
    <article class="match-card${isLive ? ' live-card' : ''}">
      <div class="match-header">
        <span class="match-phase">${escapeHtml(match.roundName || match.phase)} · #${match.matchNumber}</span>
        ${fixtureStatusBadge(match)}
      </div>
      <div class="match-teams">
        <span class="team-name home">${escapeHtml(match.homeTeam)}</span>
        ${scoreHtml}
        <span class="team-name away">${escapeHtml(match.awayTeam)}</span>
      </div>
      <div class="match-meta-row">
        <span class="meta-item"><i aria-hidden="true" class="bi bi-clock"></i> ${escapeHtml(match.boliviaDate)} ${escapeHtml(match.boliviaTime)} BOL</span>
        <span class="meta-item"><i aria-hidden="true" class="bi bi-geo-alt"></i> ${escapeHtml(match.city)}</span>
      </div>
      <span class="${match.locked ? 'locked' : 'predictions-open'}">
        <i aria-hidden="true" class="bi bi-${match.locked ? 'lock-fill' : 'pencil-square'}"></i>
        ${match.locked ? 'Predicciones cerradas' : 'Predicciones abiertas'}
      </span>
      ${renderFixtureAdminForm(match)}
    </article>
  `;
}

async function loadFixtures() {
  const params = new URLSearchParams();
  if (elements.fixtureDateFilter.value) params.set('date', elements.fixtureDateFilter.value);
  if (elements.fixtureTeamFilter.value) params.set('team', elements.fixtureTeamFilter.value);
  if (elements.fixturePhaseFilter.value) params.set('phase', elements.fixturePhaseFilter.value);
  const fixtures = await api(`/api/fixtures?${params}`);
  elements.fixturesList.innerHTML = fixtures.length ? fixtures.map(renderFixtureCard).join('') : '<p>No hay partidos para ese filtro.</p>';
}

function clearFixtureFilters() {
  elements.fixtureDateFilter.value = '';
  elements.fixtureTeamFilter.value = '';
  elements.fixturePhaseFilter.value = '';
  loadFixtures();
}

async function updateFixtureResult(form) {
  const matchId = form.dataset.matchId;
  const homeScore = form.elements.homeScore.value === '' ? null : Number(form.elements.homeScore.value);
  const awayScore = form.elements.awayScore.value === '' ? null : Number(form.elements.awayScore.value);
  const status = form.elements.status.value;
  await api(`/api/fixtures/${encodeURIComponent(matchId)}`, {
    method: 'PUT',
    body: JSON.stringify({ homeScore, awayScore, status })
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
  const date = elements.predictionDateFilter.value;
  const team = elements.predictionTeamFilter.value.trim().toLowerCase();
  const phase = elements.predictionPhaseFilter.value;
  return state.predictions.filter((match) => {
    const matchesDate = !date || match.boliviaDate === date;
    const matchesTeam = !team || match.homeTeam.toLowerCase().includes(team) || match.awayTeam.toLowerCase().includes(team);
    const matchesPhase = !phase || match.phase === phase;
    return matchesDate && matchesTeam && matchesPhase;
  });
}

function renderPredictionCard(match) {
  const prediction = match.prediction || {};
  const disabled = match.locked ? 'disabled' : '';
  const hasPrediction = prediction.homeScore !== undefined && prediction.homeScore !== null;
  const predBadge = hasPrediction
    ? `<span class="status final-status"><i class="bi bi-check2"></i> ${prediction.homeScore} — ${prediction.awayScore}</span>`
    : (match.locked ? '' : '<span class="status scheduled-status">Sin predicción</span>');

  return `
    <article class="match-card${match.locked ? '' : ''}">
      <div class="match-header">
        <span class="match-phase">${escapeHtml(match.roundName || match.phase)} · #${match.matchNumber}</span>
        ${predBadge}
      </div>
      <div class="match-teams">
        <span class="team-name home">${escapeHtml(match.homeTeam)}</span>
        <div class="score-display vs">VS</div>
        <span class="team-name away">${escapeHtml(match.awayTeam)}</span>
      </div>
      <div class="match-meta-row">
        <span class="meta-item"><i aria-hidden="true" class="bi bi-clock"></i> ${escapeHtml(match.boliviaDate)} ${escapeHtml(match.boliviaTime)} BOL</span>
        <span class="meta-item"><i aria-hidden="true" class="bi bi-geo-alt"></i> ${escapeHtml(match.city)}</span>
      </div>
      ${match.locked ? `<span class="locked"><i aria-hidden="true" class="bi bi-lock-fill"></i> Partido cerrado</span>` : `
      <form class="prediction-form" data-match-id="${match.id}">
        <label>${escapeHtml(match.homeTeam)}<input name="homeScore" type="number" min="0" step="1" value="${prediction.homeScore ?? ''}" ${disabled} required></label>
        <label>${escapeHtml(match.awayTeam)}<input name="awayScore" type="number" min="0" step="1" value="${prediction.awayScore ?? ''}" ${disabled} required></label>
        <button type="submit" ${disabled}>Guardar</button>
        <p class="save-feedback hidden" aria-live="polite">Predicción Guardada</p>
      </form>`}
    </article>
  `;
}

function renderPredictions() {
  const matches = filteredPredictions();
  elements.predictionsList.innerHTML = matches.length ? matches.map(renderPredictionCard).join('') : '<p>No hay partidos para ese filtro.</p>';
}

function clearPredictionFilters() {
  elements.predictionDateFilter.value = '';
  elements.predictionTeamFilter.value = '';
  elements.predictionPhaseFilter.value = '';
  renderPredictions();
}

async function loadPredictions() {
  state.predictions = await api('/api/predictions');
  renderPredictions();
}

async function loadStandings() {
  const [{ standings, liveMatch }, prizePool] = await Promise.all([api('/api/standings'), api('/api/prize-pool')]);
  state.prizePool = prizePool;
  renderPrizePool();
  elements.standingDetail.classList.add('hidden');
  elements.standingDetail.innerHTML = '';

  const theadRow = elements.standingsBody.closest('table').querySelector('thead tr');
  const liveHeader = liveMatch
    ? `<th>En vivo: ${escapeHtml(liveMatch.homeTeam)} vs ${escapeHtml(liveMatch.awayTeam)}</th>`
    : '';
  theadRow.innerHTML = `<th>Posición</th><th>Usuario</th>${liveHeader}<th>Puntos</th><th>Opciones</th>`;

  const TROPHY_ICONS = ['', 'bi-trophy-fill text-yellow-400', 'bi-trophy-fill text-slate-400', 'bi-trophy-fill text-amber-700'];
  let rank = 1;
  elements.standingsBody.innerHTML = standings.map((row, index) => {
    if (index > 0 && standings[index - 1].points !== row.points) rank++;
    const trophy = rank <= 3
      ? ` <i class="bi ${TROPHY_ICONS[rank]}" aria-hidden="true"></i>`
      : '';
    const livePredCell = liveMatch
      ? `<td>${row.livePrediction ? `<strong>${row.livePrediction.homeScore} — ${row.livePrediction.awayScore}</strong>` : '<span class="muted-text">—</span>'}</td>`
      : '';
    return `
      <tr>
        <td class="font-bold">${rank}${trophy}</td>
        <td>${escapeHtml(row.username)}</td>
        ${livePredCell}
        <td><strong style="color:#f2b705;font-size:1rem">${row.points}</strong></td>
        <td>${canViewStandingDetail(row) ? `<button type="button" class="secondary-button icon-button" data-action="view-standing-detail" data-user-id="${escapeHtml(row.userId)}" title="Ver detalle" aria-label="Ver detalle"><i class="bi bi-eye" aria-hidden="true"></i></button>` : '<span class="muted-text">—</span>'}</td>
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

function canViewStandingDetail() {
  return true;
}

function formatScore(homeScore, awayScore) {
  return homeScore === null || awayScore === null ? 'Pendiente' : `${homeScore} - ${awayScore}`;
}

function formatPrediction(prediction) {
  return prediction ? `${prediction.homeScore} - ${prediction.awayScore}` : 'Sin predicción';
}

async function loadStandingDetail(userId) {
  const data = await api(`/api/standings/${encodeURIComponent(userId)}`);
  elements.standingDetail.classList.remove('hidden');
  elements.standingDetail.innerHTML = `
    <div class="detail-heading">
      <div>
        <h3><i class="bi bi-person-circle" aria-hidden="true" style="color:#f2b705;margin-right:0.4rem"></i>${escapeHtml(data.user.username)}</h3>
        <p>Total acumulado: <strong style="color:#f2b705">${data.totalPoints}</strong> puntos</p>
      </div>
      <button type="button" class="secondary-button" data-action="close-standing-detail"><i class="bi bi-x"></i> Cerrar</button>
    </div>
    <div class="table-wrap overflow-x-auto">
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
    </div>
  `;
}

async function loadRules() {
  const { rules } = await api('/api/rules');
  const icons = ['bi-star-fill', 'bi-check2-circle', 'bi-x-circle', 'bi-clock', 'bi-shield-check', 'bi-trophy'];
  elements.rulesList.innerHTML = rules.map((rule, i) => `
    <article class="rule-card">
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
    prediction_created: 'Predicción creada',
    prediction_updated: 'Predicción editada',
    prize_pool_updated: 'Premios actualizados',
    standing_detail_viewed: 'Detalle de tabla visto'
  };
  return labels[action] || action;
}

function formatAuditDetail(detail) {
  if (!detail || typeof detail !== 'object') return '';
  if (detail.view) return `Vista: ${detail.view}`;
  if (detail.targetUsername) return `Usuario: ${detail.targetUsername}`;
  if (detail.matchNumber) return `Partido ${detail.matchNumber}: ${detail.homeTeam} vs ${detail.awayTeam} (${detail.homeScore}-${detail.awayScore})`;
  if (detail.username) return `Usuario: ${detail.username}`;
  return JSON.stringify(detail);
}

async function loadAuditLog() {
  state.auditLogs = await api('/api/audit-log');
  renderAuditLog();
}

function filteredAuditLogs() {
  const date = elements.auditDateFilter.value;
  const user = elements.auditUserFilter.value.trim().toLowerCase();
  const action = elements.auditActionFilter.value;
  return state.auditLogs.filter((entry) => {
    const boliviaDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/La_Paz',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(entry.timestamp));
    const matchesDate = !date || boliviaDate === date;
    const matchesUser = !user || String(entry.username || '').toLowerCase().includes(user);
    const matchesAction = !action || entry.action === action;
    return matchesDate && matchesUser && matchesAction;
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

function clearAuditFilters() {
  elements.auditDateFilter.value = '';
  elements.auditUserFilter.value = '';
  elements.auditActionFilter.value = '';
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
elements.standingsBody.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action="view-standing-detail"]');
  if (!button) return;
  try {
    await loadStandingDetail(button.dataset.userId);
  } catch (error) {
    setMessage(elements.standingsMessage, error.message);
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
elements.standingDetail.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action="close-standing-detail"]');
  if (!button) return;
  elements.standingDetail.classList.add('hidden');
  elements.standingDetail.innerHTML = '';
});
elements.fixtureDateFilter.addEventListener('change', loadFixtures);
elements.fixtureTeamFilter.addEventListener('input', debounce(loadFixtures, 300));
elements.fixturePhaseFilter.addEventListener('change', loadFixtures);
elements.clearFixtureFilters.addEventListener('click', clearFixtureFilters);
elements.predictionDateFilter.addEventListener('change', renderPredictions);
elements.predictionTeamFilter.addEventListener('input', renderPredictions);
elements.predictionPhaseFilter.addEventListener('change', renderPredictions);
elements.clearPredictionFilters.addEventListener('click', clearPredictionFilters);
elements.auditDateFilter.addEventListener('change', renderAuditLog);
elements.auditUserFilter.addEventListener('input', renderAuditLog);
elements.auditActionFilter.addEventListener('change', renderAuditLog);
elements.clearAuditFilters.addEventListener('click', clearAuditFilters);

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

elements.predictionsList.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const matchId = form.dataset.matchId;
  const homeScore = Number(form.elements.homeScore.value);
  const awayScore = Number(form.elements.awayScore.value);
  try {
    await api('/api/predictions', { method: 'POST', body: JSON.stringify({ matchId, homeScore, awayScore }) });
    const feedback = form.querySelector('.save-feedback');
    feedback.classList.remove('hidden');
    setTimeout(async () => { await loadPredictions(); }, 1000);
  } catch (error) {
    setMessage(elements.predictionsMessage, error.message);
  }
});

['click', 'keydown', 'mousemove', 'touchstart'].forEach((eventName) => {
  document.addEventListener(eventName, resetInactivityTimer, { passive: true });
});

api('/api/session')
  .then(({ user, inactivityLimitMs }) => {
    state.inactivityLimitMs = inactivityLimitMs;
    if (user) showAuthenticatedApp(user);
    else showLogin();
  })
  .catch(() => showLogin());
