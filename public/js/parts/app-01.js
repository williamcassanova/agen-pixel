import {
  state, loadBootstrap, connectEvents, api, agentById, engineById,
  isEngineConnected, connectedEngines, realEngines, activeTasksForAgent,
} from './api.js';
import {
  esc, fmtDate, timeAgo, truncate, statusBadge, modeBadge, engineBadge,
  openModal, openDrawer, confirmDialog, toast, downloadFile,
  DEPARTMENTS, TASK_STATUSES,
} from './ui.js';
import { OfficeRenderer, ROOMS } from './office.js';

const viewEl = document.getElementById('view');
const NAV_META = {
  office: { title: 'Virtual Office', sub: 'Kantor pusat perusahaan AI', icon: '🏢' },
  dashboard: { title: 'CEO Dashboard', sub: 'Ringkasan operasional perusahaan', icon: '📊' },
  command: { title: 'CEO Command Center', sub: 'Instruksi natural language kepada Secretary AI', icon: '🎯' },
  employees: { title: 'Employees', sub: 'Seluruh agen AI dan konfigurasinya', icon: '🧑‍💼' },
  departments: { title: 'Departments', sub: 'Struktur organisasi dan produktivitas divisi', icon: '🗂️' },
  tasks: { title: 'Task Manager', sub: 'Papan pekerjaan dan progres eksekusi', icon: '📋' },
  meetings: { title: 'Meetings', sub: 'Ruang rapat dan ringkasan pembahasan', icon: '🪑' },
  reports: { title: 'Reports', sub: 'Laporan pekerjaan setiap divisi', icon: '📄' },
  connections: { title: 'AI Connections', sub: 'OpenCode CLI dan Hermes Agent CLI', icon: '🔌' },
  settings: { title: 'Settings', sub: 'Profil perusahaan, preferensi, dan data', icon: '⚙️' },
};
const MAIN_STATUSES = [
  'Menunggu', 'Direncanakan', 'Sedang dikerjakan', 'Dalam pemeriksaan',
  'Memerlukan persetujuan CEO', 'Selesai', 'Gagal', 'Dibatalkan',
];

let routeName = 'office';
let routeParam = null;
let officeRenderer = null;
let commandState = { projectId: null, detail: null, logLines: [], poll: null, pollTimer: null };
let taskDrawerState = null;
let connResults = new Map();
let currentFilter = { search: '', department: 'all', showInactive: false };
let taskFilter = { project: 'all', status: 'all', search: '' };
let liveTimer = null;

function main() {
  bindShell();
  loadBootstrap()
    .then(() => {
      applyTheme();
      updateChrome();
      route();
      connectEvents(handleLiveEvent);
    })
    .catch((error) => {
      viewEl.innerHTML = `<div class="empty-state"><div class="big">!</div>
        <p>Gagal memuat aplikasi: ${esc(error.message)}</p>
        <p class="small" style="margin-top:8px">Pastikan server berjalan lalu muat ulang halaman.</p>
        <button class="btn btn-primary" onclick="location.reload()" style="margin-top:14px">Muat Ulang</button></div>`;
    });
}

function bindShell() {
  document.getElementById('menu-btn').addEventListener('click', () => {
    document.body.classList.toggle('nav-open');
  });
  document.getElementById('nav-backdrop').addEventListener('click', () => {
    document.body.classList.remove('nav-open');
  });
  document.getElementById('company-chip').addEventListener('click', () => navigate('#/settings'));
  document.getElementById('nav').addEventListener('click', (event) => {
    if (event.target.closest('.nav-item')) document.body.classList.remove('nav-open');
  });
  window.addEventListener('hashchange', () => route());
}

function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function route() {
  const raw = (location.hash || '#/office').replace(/^#\/?/, '');
  const [name, param] = raw.split('/');
  routeName = NAV_META[name] ? name : 'office';
  routeParam = param || null;
  document.body.classList.remove('nav-open');
  document.getElementById('drawer-root').innerHTML = '';
  document.getElementById('modal-root').innerHTML = '';
  cleanupView();
  const meta = NAV_META[routeName];
  document.getElementById('crumb').textContent = meta.title;
  document.getElementById('crumb-sub').textContent = meta.sub;
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.view === routeName);
  });
  const renderers = {
    office: renderOffice,
    dashboard: renderDashboard,
    command: renderCommand,
    employees: renderEmployees,
    departments: renderDepartments,
    tasks: renderTasks,
    meetings: renderMeetings,
    reports: renderReports,
    connections: renderConnections,
    settings: renderSettings,
  };
  renderers[routeName]();
  viewEl.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function cleanupView() {
  if (officeRenderer) { officeRenderer.destroy(); officeRenderer = null; }
  if (commandState.pollTimer) { clearInterval(commandState.pollTimer); commandState.pollTimer = null; }
  if (liveTimer) { clearTimeout(liveTimer); liveTimer = null; }
  taskDrawerState = null;
}

function setView(html) {
  viewEl.innerHTML = html;
  viewEl.classList.remove('view-enter');
  void viewEl.offsetWidth;
  viewEl.classList.add('view-enter');
}

function pageHead(title, subtitle, actions = '') {
  return `<div class="page-head">
    <div><h1>${esc(title)}</h1>${subtitle ? `<p>${subtitle}</p>` : ''}</div>
    ${actions ? `<div class="page-actions">${actions}</div>` : ''}
  </div>`;
}

function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme === 'light' ? 'light' : 'dark';
}

function bindGoButtons(root) {
  root.querySelectorAll('[data-go]').forEach((button) => {
    button.onclick = () => navigate(button.dataset.go);
  });
}

function deptColor(name) {
  return {
    Development: '#3b82f6', Research: '#10b981', Design: '#ec4899',
    'Quality Assurance': '#f59e0b', Marketing: '#ef4444', Operasional: '#8b5cf6',
  }[name] || '#64789a';
}

/* ============================ LIVE UPDATES ============================ */
function handleLiveEvent(event) {
  if (event.type === 'connection') { updateChrome(); return; }
  if (event.type === 'execution.log') {
    if (routeName === 'command' && commandState.detail) {
      const belongs = commandState.detail.executions.some((exec) => exec.id === event.payload.executionId);
      if (belongs) appendProjectLog(event.payload);
    }
    if (taskDrawerState && taskDrawerState.executionId === event.payload.executionId) {
      appendDrawerLog(event.payload);
    }
    return;
  }
  if (!event.changed) return;
  updateChrome();
  if (routeName === 'office') {
    if (officeRenderer) officeRenderer.setData({ agents: state.agents, company: state.company, tasks: state.tasks });
    renderOfficeLive();
    return;
  }
  if (routeName === 'command') {
    if (commandState.detail && ['task.update', 'task.new', 'project.update', 'execution.update', 'delegation.new', 'report.new'].includes(event.type)) {
      scheduleCommandRefresh();
    }
    if (event.type === 'execution.update' && taskDrawerState) scheduleTaskDrawerRefresh();
    return;
  }
  if (routeName === 'tasks') {
    renderTaskBoardOnly();
    if (taskDrawerState && ['task.update', 'execution.update', 'task.new'].includes(event.type)) scheduleTaskDrawerRefresh();
    return;
  }
  if (['dashboard', 'reports', 'departments', 'employees'].includes(routeName)) {
    scheduleLiveRerender();
    return;
  }
  if (routeName === 'meetings' && event.type === 'meeting.new') {
    refreshMeetings();
  }
}

function scheduleLiveRerender() {
  if (liveTimer) clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    liveTimer = null;
    if (routeName === 'dashboard') renderDashboard();
    else if (routeName === 'reports') renderReports();
    else if (routeName === 'departments') renderDepartments();
    else if (routeName === 'employees') renderEmployees();
  }, 400);
}

function updateChrome() {
  const company = state.company;
  if (company) {
    document.getElementById('company-name').textContent = company.name;
    document.getElementById('company-avatar').textContent = company.avatar || '🏢';
    document.title = `${company.name} — Pixel Office AI`;
  }
  const chips = document.getElementById('engine-chips');
  const mini = document.getElementById('connection-mini');
  if (!chips || !mini) return;
  const real = realEngines();
  const chipHtml = real.map((engine) => {
    const connected = isEngineConnected(engine);
    const status = engine.status || 'Belum diperiksa';
    const cls = connected ? 'ok' : (status === 'Belum diperiksa' || status === 'Perlu konfigurasi') ? 'warn' : 'bad';
    return `<span class="chip ${cls}" title="${esc(status)}"><i class="dot"></i>${esc(engine.label)}</span>`;
  }).join('');
  const simChip = connectedEngines().length === 0
    ? '<span class="chip sim"><i class="dot"></i>MODE SIMULASI</span>'
    : '';
  const offline = state.connection === 'offline'
    ? '<span class="chip bad"><i class="dot"></i>Realtime terputus</span>'
    : '';
  chips.innerHTML = `${chipHtml}${simChip}${offline}`;
  mini.innerHTML = real.map((engine) => {
    const connected = isEngineConnected(engine);
    return `<div class="mini-row"><i class="dot ${connected ? 'green' : 'red'}"></i>
      <span>${esc(engine.label)}</span><span class="spacer"></span>
      <span class="mono tiny">${esc(engine.version || engine.status || '-')}</span></div>`;
  }).join('') + (real.length ? '' : '<div class="mini-row">Mesin belum dikonfigurasi</div>');
}
