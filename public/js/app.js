const state = {
  user: null,
  inactivityLimitMs: 5 * 60 * 1000,
  inactivityTimer: null,
  predictions: [],
  auditLogs: []
};

const elements = {
  loginView: document.querySelector('#loginView'),
  appView: document.querySelector('#appView'),
  loginForm: document.querySelector('#loginForm'),
  loginMessage: document.querySelector('#loginMessage'),
  currentUser: document.querySelector('#currentUser'),
  logoutButton: document.querySelector('#logoutButton'),
  menuButtons: document.querySelectorAll('.menu button'),
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

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character]);
}

function setMessage(element, message, success = false) {
  element.textContent = message;
  element.classList.toggle('success', success);
}

function resetInactivityTimer() {
  clearTimeout(state.inactivityTimer);
  if (!state.user) return;
  state.inactivityTimer = setTimeout(() => logout('Sesión cerrada por inactividad.'), state.inactivityLimitMs);
}

function showView(viewId) {
  elements.views.forEach((view) => view.classList.toggle('hidden', view.id !== viewId));
  elements.menuButtons.forEach((button) => button.classList.toggle('active', button.dataset.view === viewId));
  recordNavigation(viewId);
  if (viewId === 'fixturesView') loadFixtures();
  if (viewId === 'usersView') loadUsers();
  if (viewId === 'predictionsView') loadPredictions();
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
  elements.currentUser.textContent = `${user.username} (${user.role})`;
  elements.usersMenu.classList.toggle('hidden', user.role !== 'admin');
  elements.auditMenu.classList.toggle('hidden', user.role !== 'admin');
  showView('fixturesView');
  resetInactivityTimer();
}

function showLogin(message = '') {
  state.user = null;
  clearTimeout(state.inactivityTimer);
  elements.appView.classList.add('hidden');
  elements.loginView.classList.remove('hidden');
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

function renderFixtureCard(match) {
  const score = match.homeScore === null || match.awayScore === null ? 'vs' : `${match.homeScore} - ${match.awayScore}`;
  return `
    <article class="match-card">
      <div class="match-meta"><span>Partido ${match.matchNumber}</span><span class="status">${escapeHtml(match.phase)}</span></div>
      <div class="teams">
        <span>${escapeHtml(match.homeTeam)}</span>
        <span class="score">${score}</span>
        <span>${escapeHtml(match.awayTeam)}</span>
      </div>
      <p class="venue"><i class="bi bi-clock"></i> ${escapeHtml(match.boliviaDate)} ${escapeHtml(match.boliviaTime)} Bolivia</p>
      <p class="venue"><i class="bi bi-geo-alt"></i> ${escapeHtml(match.city)} - ${escapeHtml(match.stadiumCommonName || match.stadium)}</p>
      <p class="venue">${escapeHtml(match.roundName || match.phase)}</p>
      <p class="${match.locked ? 'locked' : ''}">${match.locked ? 'Predicciones cerradas' : 'Predicciones abiertas'}</p>
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

async function loadUsers() {
  const users = await api('/api/users');
  elements.usersTableBody.innerHTML = users.map((user) => `
    <tr data-user-id="${escapeHtml(user.id)}">
      <td>${escapeHtml(user.username)}</td>
      <td>${escapeHtml(user.role)}</td>
      <td><span class="status ${user.active ? '' : 'inactive-status'}">${user.active ? 'Activo' : 'Inactivo'}</span></td>
      <td class="actions-cell">
        <button type="button" class="secondary-button" data-action="edit-user" data-user-id="${escapeHtml(user.id)}">Editar</button>
        <button type="button" class="danger-button" data-action="deactivate-user" data-user-id="${escapeHtml(user.id)}" ${user.active ? '' : 'disabled'}>Desactivar</button>
      </td>
    </tr>
  `).join('');
}

async function editUser(userId) {
  const users = await api('/api/users');
  const user = users.find((candidate) => candidate.id === userId);
  if (!user) return;
  const username = prompt('Nuevo usuario', user.username);
  if (username === null) return;
  const role = prompt('Rol: user o admin', user.role);
  if (role === null) return;
  const password = prompt('Nueva contraseña opcional. Dejá vacío para mantener la actual.', '');
  if (password === null) return;
  await api(`/api/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    body: JSON.stringify({ username, role, password, active: user.active })
  });
  await loadUsers();
  setMessage(elements.createUserMessage, 'Usuario actualizado correctamente.', true);
}

async function deactivateUser(userId) {
  if (!confirm('¿Desactivar este usuario? No podrá iniciar sesión.')) return;
  await api(`/api/users/${encodeURIComponent(userId)}/deactivate`, { method: 'PATCH' });
  await loadUsers();
  setMessage(elements.createUserMessage, 'Usuario desactivado correctamente.', true);
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
  return `
    <article class="match-card">
      <div class="match-meta"><span>Partido ${match.matchNumber}</span><span class="status">${escapeHtml(match.phase)}</span></div>
      <div class="teams"><span>${escapeHtml(match.homeTeam)}</span><span>vs</span><span>${escapeHtml(match.awayTeam)}</span></div>
      <p class="venue"><i class="bi bi-clock"></i> ${escapeHtml(match.boliviaDate)} ${escapeHtml(match.boliviaTime)} Bolivia</p>
      <p class="venue"><i class="bi bi-geo-alt"></i> ${escapeHtml(match.city)} - ${escapeHtml(match.stadiumCommonName || match.stadium)}</p>
      <form class="prediction-form" data-match-id="${match.id}">
        <label>${escapeHtml(match.homeTeam)}<input name="homeScore" type="number" min="0" step="1" value="${prediction.homeScore ?? ''}" ${disabled} required></label>
        <label>${escapeHtml(match.awayTeam)}<input name="awayScore" type="number" min="0" step="1" value="${prediction.awayScore ?? ''}" ${disabled} required></label>
        <button type="submit" ${disabled}>Guardar</button>
      </form>
      <p class="${match.locked ? 'locked' : ''}">${match.locked ? 'Este partido ya está cerrado.' : 'Podés editar tu predicción.'}</p>
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
  const standings = await api('/api/standings');
  elements.standingDetail.classList.add('hidden');
  elements.standingDetail.innerHTML = '';
  elements.standingsBody.innerHTML = standings.map((row, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(row.username)}</td>
      <td><strong>${row.points}</strong></td>
      <td>${canViewStandingDetail(row) ? `<button type="button" class="secondary-button" data-action="view-standing-detail" data-user-id="${escapeHtml(row.userId)}">Ver detalle</button>` : '<span class="muted-text">Solo detalle propio</span>'}</td>
    </tr>
  `).join('');
}

function canViewStandingDetail(row) {
  return state.user?.role === 'admin' || state.user?.id === row.userId;
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
        <h3>Detalle de ${escapeHtml(data.user.username)}</h3>
        <p>Total acumulado: <strong>${data.totalPoints}</strong> puntos</p>
      </div>
      <button type="button" class="secondary-button" data-action="close-standing-detail">Cerrar detalle</button>
    </div>
    <table>
      <thead>
        <tr><th>Partido</th><th>Fecha Bolivia</th><th>Encuentro</th><th>Resultado</th><th>Predicción</th><th>Puntos</th></tr>
      </thead>
      <tbody>
        ${data.details.map((detail) => `
          <tr>
            <td>${detail.matchNumber}</td>
            <td>${escapeHtml(detail.boliviaDate)} ${escapeHtml(detail.boliviaTime)}</td>
            <td>${escapeHtml(detail.homeTeam)} vs ${escapeHtml(detail.awayTeam)}</td>
            <td>${escapeHtml(formatScore(detail.homeScore, detail.awayScore))}</td>
            <td>${escapeHtml(formatPrediction(detail.prediction))}</td>
            <td><strong>${detail.points}</strong></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function loadRules() {
  const { rules } = await api('/api/rules');
  elements.rulesList.innerHTML = rules.map((rule) => `
    <article class="rule-card">
      <h3>${escapeHtml(rule.title)}</h3>
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
  elements.auditLogBody.innerHTML = logs.length ? logs.map((entry) => `
    <tr>
      <td>${escapeHtml(formatDate(entry.timestamp))}</td>
      <td>${escapeHtml(entry.username || 'Sistema')}</td>
      <td>${escapeHtml(entry.role || '-')}</td>
      <td>${escapeHtml(actionLabel(entry.action))}</td>
      <td>${escapeHtml(formatAuditDetail(entry.detail))}</td>
    </tr>
  `).join('') : '<tr><td colspan="5">No hay acciones registradas.</td></tr>';
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

elements.logoutButton.addEventListener('click', () => logout());
elements.usersTableBody.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  try {
    if (button.dataset.action === 'edit-user') await editUser(button.dataset.userId);
    if (button.dataset.action === 'deactivate-user') await deactivateUser(button.dataset.userId);
  } catch (error) {
    setMessage(elements.createUserMessage, error.message);
  }
});
elements.standingsBody.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action="view-standing-detail"]');
  if (!button) return;
  try {
    await loadStandingDetail(button.dataset.userId);
  } catch (error) {
    alert(error.message);
  }
});
elements.standingDetail.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action="close-standing-detail"]');
  if (!button) return;
  elements.standingDetail.classList.add('hidden');
  elements.standingDetail.innerHTML = '';
});
elements.fixtureDateFilter.addEventListener('change', loadFixtures);
elements.fixtureTeamFilter.addEventListener('input', loadFixtures);
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

elements.predictionsList.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const matchId = form.dataset.matchId;
  const homeScore = Number(form.elements.homeScore.value);
  const awayScore = Number(form.elements.awayScore.value);
  try {
    await api('/api/predictions', { method: 'POST', body: JSON.stringify({ matchId, homeScore, awayScore }) });
    await loadPredictions();
  } catch (error) {
    alert(error.message);
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
