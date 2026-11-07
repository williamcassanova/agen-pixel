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
  if (['dashboard', 'reports', 'departments', 'employees', 'connections'].includes(routeName)) {
    scheduleLiveRerender();
    return;
  }
  if (routeName === 'settings' && event.type === 'settings.update') {
    applyTheme();
    updateChrome();
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
    else if (routeName === 'connections') renderConnections();
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
/* ============================ OFFICE ============================ */
function renderOffice() {
  const activeAgents = state.agents.filter((agent) => agent.active);
  const working = activeAgents.filter((agent) => agent.status === 'Bekerja').length;
  const meeting = activeAgents.filter((agent) => agent.status === 'Rapat').length;
  setView(`
    ${pageHead('Virtual Office', 'Kantor virtual 2D — status karakter terhubung langsung dengan data agen dan eksekusi nyata.',
      `<button class="btn btn-sm" data-go="#/command">Beri Instruksi</button>
       <button class="btn btn-sm" data-go="#/employees">Kelola Agen</button>`)}
    <div class="office-toolbar">
      <div class="office-legend">
        <span><i class="dot amber"></i>Bekerja</span>
        <span><i class="dot blue"></i>Rapat</span>
        <span><i class="dot"></i>Idle</span>
        <span><span class="badge sim">SIMULASI</span> aktivitas simulasi</span>
      </div>
      <span class="spacer"></span>
      <span class="badge blue">${activeAgents.length} agen aktif</span>
      <span class="badge amber">${working} bekerja</span>
      <span class="badge purple">${meeting} rapat</span>
    </div>
    <div class="office-shell">
      <div class="office-canvas-wrap">
        <canvas id="office-canvas" aria-label="Kantor virtual pixel art"></canvas>
        <div class="office-hud">
          <div class="hud-title">PIXEL OFFICE AI</div>
          <div>${esc(state.company?.name || 'Perusahaan')}</div>
          <div class="tiny" id="hud-live">${working} agen sedang bekerja...</div>
        </div>
        <div class="office-hint">Klik karakter untuk melihat detail · animasi ringan 12 FPS</div>
      </div>
    </div>
    <div class="grid grid-2" style="margin-top:14px">
      <div class="panel">
        <div class="panel-head"><div><h3>Aktivitas Agen</h3><div class="panel-sub">Kartu ini diperbarui real-time dari server</div></div>
          <span class="badge gray" id="live-count">${activeAgents.length} agen</span></div>
        <div class="office-live" id="office-live"></div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h3>Ruangan &amp; Penghuni</h3><div class="panel-sub">Posisi visual mengikuti divisi dan status agen</div></div></div>
        <div class="room-list" id="room-list"></div>
      </div>
    </div>
    <div class="note-strip" style="margin-top:14px">
      <strong>Catatan:</strong> Karakter bekerja ketika agen memiliki eksekusi berjalan. Jika mesin AI belum terhubung,
      proyek berjalan pada mode <strong>SIMULASI</strong> yang ditandai pada setiap hasil dan laporan.
    </div>
  `);
  bindGoButtons(viewEl);
  const canvas = document.getElementById('office-canvas');
  officeRenderer = new OfficeRenderer(canvas, { onSelect: handleOfficeSelect });
  officeRenderer.setData({ agents: state.agents, company: state.company, tasks: state.tasks });
  officeRenderer.setActive(true);
  renderOfficeLive();
}

function renderOfficeLive() {
  const live = document.getElementById('office-live');
  const rooms = document.getElementById('room-list');
  const hud = document.getElementById('hud-live');
  const countEl = document.getElementById('live-count');
  if (!live || !rooms) return;
  const activeAgents = state.agents.filter((agent) => agent.active);
  const order = { Bekerja: 0, Rapat: 1, Idle: 2 };
  const sorted = [...activeAgents].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || a.name.localeCompare(b.name));
  live.innerHTML = sorted.map((agent) => {
    const engine = engineById(agent.engine_id);
    const active = activeTasksForAgent(agent.id);
    return `<button class="live-card" data-agent-open="${esc(agent.id)}">
      <span class="avatar sm">${esc(agent.avatar)}</span>
      <span class="meta">
        <span class="n">${esc(agent.name)} <span class="tiny dim">${agent.is_head ? '★' : ''}</span></span>
        <span class="r">${esc(agent.role)} · ${esc(agent.department)}</span>
        <span class="row" style="gap:4px;margin-top:3px">${statusBadge(agent.status)}${active ? `<span class="badge amber">${active} tugas</span>` : ''}</span>
      </span>
      <span class="mono tiny muted" title="${esc(engine?.status || '')}">${esc(engine?.type === 'opencode' ? 'OC' : engine?.type === 'hermes' ? 'HM' : 'SIM')}</span>
    </button>`;
  }).join('') || '<div class="empty-state">Tidak ada agen aktif.</div>';
  live.querySelectorAll('[data-agent-open]').forEach((button) => {
    button.addEventListener('click', () => openAgentDrawer(button.dataset.agentOpen));
  });
  const occupants = new Map(ROOMS.map((room) => [room.key, []]));
  for (const agent of activeAgents) {
    let key;
    if (agent.status === 'Rapat') key = 'meeting';
    else if (agent.role === 'Secretary AI' || agent.role === 'COO' || agent.department === 'Operasional') key = 'secretary';
    else key = {
      Development: 'development', Research: 'research', Design: 'design',
      'Quality Assurance': 'qa', Marketing: 'marketing',
    }[agent.department] || 'secretary';
    occupants.get(key)?.push(agent);
  }
  rooms.innerHTML = ROOMS.filter((room) => room.key !== 'ceo').map((room) => {
    const list = occupants.get(room.key) || [];
    return `<div class="room-card">
      <div class="rn"><i class="dot" style="background:${room.accent}"></i>${esc(room.name)}</div>
      <div class="occupants">${list.length ? list.map((agent) => `<span class="tag" title="${esc(agent.role)}">${esc(agent.avatar)} ${esc(agent.name)}</span>`).join('') : '<span class="tiny dim">Kosong</span>'}</div>
    </div>`;
  }).join('');
  if (hud) hud.textContent = `${activeAgents.filter((agent) => agent.status === 'Bekerja').length} agen bekerja · ${activeAgents.filter((agent) => agent.status === 'Rapat').length} rapat`;
  if (countEl) countEl.textContent = `${activeAgents.length} agen`;
}

function handleOfficeSelect(selection) {
  if (selection.type === 'ceo') {
    openModal({
      title: 'Profil CEO',
      body: `<div class="row" style="gap:14px">
        <span class="avatar lg ceo">${esc(state.company?.ceo_avatar || '👑')}</span>
        <div><h3 style="font-size:18px">${esc(state.company?.ceo_name || 'CEO')}</h3>
        <div class="muted small">${esc(state.company?.name || '')}</div></div></div>
        <div class="divider"></div>
        <div class="kv"><span class="k">Tagline</span><span class="v">${esc(state.company?.tagline || '-')}</span>
        <span class="k">Profil</span><span class="v">${esc(state.company?.description || '-')}</span>
        <span class="k">Saldo model</span><span class="v mono">${esc(state.company?.model_balance || 'Tidak tersedia')}</span></div>`,
      footer: `<button class="btn btn-ghost" data-close>Tutup</button><button class="btn btn-primary" data-settings>Ubah Profil</button>`,
      onMount: (ref) => ref.footer.querySelector('[data-settings]').addEventListener('click', () => { ref.close(); navigate('#/settings'); }),
    });
  } else if (selection.agent) {
    openAgentDrawer(selection.agent.id);
  }
}

/* ============================ DASHBOARD ============================ */
function renderDashboard() {
  const stats = state.stats || {};
  const company = state.company || {};
  const activeAgents = state.agents.filter((agent) => agent.active);
  const running = state.tasks.filter((task) => task.execution_status === 'Berjalan');
  const recentProjects = state.projects.slice(0, 5);
  const completion = stats.completionRate ?? 0;
  setView(`
    <div class="hero">
      <div>
        <div class="row" style="gap:8px;margin-bottom:8px">
          <span class="badge" style="color:var(--accent-2);border-color:#8a6a25">${esc(company.avatar || '🏢')} PERUSAHAAN</span>
          <span class="badge blue">${activeAgents.length} agen aktif</span>
          ${connectedEngines().length ? `<span class="badge green">${connectedEngines().length} mesin terhubung</span>` : '<span class="badge sim">MODE SIMULASI</span>'}
        </div>
        <h1>${esc(company.name || 'Pixel Office AI')}</h1>
        <p class="tagline">${esc(company.tagline || '')}</p>
        <div class="ceo-line">
          <span class="avatar ceo">${esc(company.ceo_avatar || '👑')}</span>
          <div><div style="font-size:12px;font-weight:700">${esc(company.ceo_name || 'CEO')}</div>
          <div class="tiny muted">Chief Executive Officer</div></div>
          <span class="sep"></span>
          <span class="tiny muted">${esc(truncate(company.description || '', 130))}</span>
        </div>
      </div>
      <div class="hero-balance">
        <div class="label">Saldo Penggunaan Model</div>
        <div class="value">${esc(company.model_balance || 'Tidak tersedia')}</div>
        <div class="tiny muted" style="margin-top:6px">Diatur manual dari profil perusahaan</div>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat"><div class="k">Karyawan Aktif</div><div class="v">${stats.employees ?? 0}</div><div class="s">AI Agent</div></div>
      <div class="stat blue"><div class="k">Tugas Aktif</div><div class="v">${stats.activeTasks ?? 0}</div><div class="s">antrean &amp; berjalan</div></div>
      <div class="stat green"><div class="k">Tugas Selesai</div><div class="v">${stats.completedTasks ?? 0}</div><div class="s">${stats.last7days ?? 0} dalam 7 hari</div></div>
      <div class="stat accent"><div class="k">Proyek</div><div class="v">${stats.totalProjects ?? 0}</div><div class="s">${stats.doneProjects ?? 0} disetujui</div></div>
      <div class="stat purple"><div class="k">Eksekusi Nyata</div><div class="v">${stats.realExecutions ?? 0}</div><div class="s">${stats.simulationExecutions ?? 0} simulasi</div></div>
      <div class="stat ${running.length ? 'red' : ''}"><div class="k">Proses Berjalan</div><div class="v">${stats.runningExecutions ?? 0}</div><div class="s">batas ${esc(state.settings.concurrency || '2')} paralel</div></div>
    </div>

    <div class="grid grid-2" style="margin-top:14px">
      <div class="panel">
        <div class="panel-head"><div><h3>Produktivitas Divisi</h3><div class="panel-sub">Persentase tugas selesai per divisi</div></div>
          <span class="badge gray">Tingkat proyek ${completion}%</span></div>
        ${(stats.departments || []).map((dept) => `
          <div class="bar-row">
            <span>${esc(dept.department)}</span>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.max(1, dept.productivity)}%;background:${deptColor(dept.department)}"></div></div>
            <span class="mono tiny">${dept.productivity}% · ${dept.done}/${dept.tasks}</span>
          </div>`).join('')}
        <div class="divider"></div>
        <div class="row">
          <button class="btn btn-sm btn-primary" data-go="#/command">Instruksi Baru</button>
          <button class="btn btn-sm" data-go="#/tasks">Task Manager</button>
          <button class="btn btn-sm" data-go="#/reports">Laporan</button>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><div><h3>Eksekusi Langsung</h3><div class="panel-sub">Status proses AI yang sedang berjalan</div></div>
          <span class="badge ${running.length ? 'amber' : 'gray'}">${running.length} aktif</span></div>
        <div>
          ${running.length ? running.map((task) => `
            <div class="exec-row">
              <i class="dot amber pulse"></i>
              <div style="flex:1;min-width:0">
                <div class="truncate">${esc(task.title)}</div>
                <div class="tiny muted">${esc(task.assignee_name || '-')} · ${esc(task.department)} · ${task.execution_simulation ? 'SIMULASI' : 'NYATA'}</div>
              </div>
              <button class="btn btn-xs btn-danger" data-exec-cancel="${esc(task.execution_id)}">Hentikan</button>
            </div>`).join('') : '<div class="empty-state" style="padding:18px">Tidak ada proses berjalan.</div>'}
        </div>
        <div class="divider"></div>
        <div class="panel-head" style="margin-bottom:6px"><h3>Aktivitas Terbaru</h3><span class="badge gray">live</span></div>
        <div class="feed">
          ${(state.activity || []).slice(0, 12).map((item) => `
            <div class="feed-item"><span class="t">${esc(timeAgo(item.created_at))}</span>
              <span class="m">${esc(item.message)}</span></div>`).join('') || '<div class="empty-state" style="padding:12px">Belum ada aktivitas.</div>'}
        </div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:14px">
      <div class="panel">
        <div class="panel-head"><div><h3>Proyek Terbaru</h3></div><button class="btn btn-xs" data-go="#/command">Lihat semua</button></div>
        ${recentProjects.length ? recentProjects.map((project) => `
          <div class="project-list-item" data-project-jump="${esc(project.id)}">
            <div class="pli-title">${esc(project.title)}</div>
            <div class="pli-meta">${statusBadge(project.status)} ${modeBadge(project.mode)}
              <span>${project.done_count}/${project.task_count} tugas</span><span>${esc(timeAgo(project.created_at))}</span></div>
          </div>`).join('') : '<div class="empty-state" style="padding:18px">Belum ada proyek. Berikan instruksi pertama dari Command Center.</div>'}
      </div>
      <div class="panel">
        <div class="panel-head"><div><h3>Status Mesin AI</h3><div class="panel-sub">OpenCode dan Hermes dikonfigurasi terpisah</div></div>
          <button class="btn btn-xs" data-go="#/connections">Kelola</button></div>
        ${realEngines().map((engine) => `
          <div class="exec-row">
            <i class="dot ${isEngineConnected(engine) ? 'green' : 'red'}"></i>
            <div style="flex:1;min-width:0"><div>${esc(engine.label)}</div>
              <div class="tiny muted">${esc(engine.version || engine.status)} · ${engine.agent_count || 0} agen</div></div>
            ${engineBadge(engine)}
          </div>`).join('') || '<div class="empty-state" style="padding:16px">Mesin belum terdeteksi.</div>'}
        <div class="note-strip" style="margin-top:10px">Aktivitas simulasi tidak pernah dicampur dengan eksekusi nyata. Setiap proyek memiliki label mode.</div>
      </div>
    </div>
  `);
  bindGoButtons(viewEl);
  viewEl.querySelectorAll('[data-project-jump]').forEach((item) => {
    item.addEventListener('click', () => navigate(`#/command/${item.dataset.projectJump}`));
  });
  viewEl.querySelectorAll('[data-exec-cancel]').forEach((button) => {
    button.addEventListener('click', async () => {
      const confirmed = await confirmDialog({
        title: 'Hentikan Eksekusi',
        message: 'Proses AI akan dihentikan. Tugas akan ditandai dibatalkan.',
        confirmLabel: 'Hentikan', danger: true,
      });
      if (!confirmed) return;
      try {
        await api(`/api/executions/${button.dataset.execCancel}/cancel`, { method: 'POST', body: { reason: 'Dihentikan CEO dari dashboard.' } });
        toast('Eksekusi dihentikan.', 'success');
      } catch (error) { toast(error.message, 'error'); }
    });
  });
}
/* ============================ COMMAND CENTER ============================ */
function renderCommand() {
  const secretary = state.agents.find((agent) => agent.role === 'Secretary AI' && agent.active);
  const secretaryEngine = secretary ? engineById(secretary.engine_id) : null;
  const defaultMode = state.settings.defaultMode || 'auto';
  const engineOptions = state.engines.map((engine) => {
    const connected = isEngineConnected(engine);
    return `<option value="${esc(engine.id)}" ${secretary && engine.id === secretary.engine_id ? 'selected' : ''}>
      ${esc(engine.label)}${connected ? '' : ' — belum terhubung'}</option>`;
  }).join('');
  setView(`
    ${pageHead('CEO Command Center', 'Berikan instruksi dalam bahasa alami. Secretary AI akan menyusun rencana, memilih divisi, dan mendelegasikan pekerjaan.',
      '<button class="btn btn-sm" data-go="#/connections">AI Connections</button>')}
    <div class="command-box">
      <div class="command-head">
        <span class="avatar">${esc(secretary?.avatar || '📋')}</span>
        <div style="flex:1"><div style="font-weight:700;font-size:13px">${esc(secretary?.name || 'Secretary AI')} · ${esc(secretary?.role || 'Secretary AI')}</div>
          <div class="tiny muted">Mesin perencanaan: ${esc(secretaryEngine?.label || '-')} ${statusBadge(secretaryEngine?.status || 'Belum terhubung')}</div></div>
        <span class="badge ${connectedEngines().length ? 'green' : 'sim'}">${connectedEngines().length ? 'AI NYATA TERSEDIA' : 'MODE SIMULASI'}</span>
      </div>
      <div class="command-body">
        <form id="command-form">
          <label class="field">
            <span>Instruksi untuk perusahaan</span>
            <textarea class="command-input" id="command-instruction" maxlength="4000" placeholder="Contoh: Buatkan website toko online lengkap dengan desain, implementasi, pengujian, dan rencana promosi." required></textarea>
          </label>
          <div class="row" style="margin-top:8px">
            <span class="tiny muted">Contoh cepat:</span>
            <button type="button" class="btn btn-xs" data-example="Buatkan website toko online lengkap dengan desain, implementasi, pengujian, dan rencana promosi.">Website toko online</button>
            <button type="button" class="btn btn-xs" data-example="Riset kompetitor dan peluang pasar untuk produk kopi lokal.">Riset pasar</button>
            <button type="button" class="btn btn-xs" data-example="Rancang kampanye media sosial untuk peluncuran aplikasi mobile.">Kampanye media sosial</button>
          </div>
          <div class="command-options">
            <label class="field"><span>Mode eksekusi</span>
              <select id="command-mode">
                <option value="auto" ${defaultMode === 'auto' ? 'selected' : ''}>Otomatis (AI nyata bila tersedia)</option>
                <option value="nyata" ${defaultMode === 'nyata' ? 'selected' : ''}>Wajib NYATA</option>
                <option value="simulasi" ${defaultMode === 'simulasi' ? 'selected' : ''}>SIMULASI (demo lokal)</option>
              </select>
            </label>
            <label class="field"><span>Mesin perencanaan sekretaris</span>
              <select id="command-engine">${engineOptions}</select>
            </label>
            <button class="btn btn-primary" type="submit" id="command-submit">Kirim Instruksi</button>
          </div>
          <div class="note-strip">
            <strong>Mode otomatis:</strong> proyek dijalankan NYATA jika mesin sekretaris terhubung. Agen yang mesinnya belum terhubung
            akan menandai tugasnya gagal secara transparan, tanpa mengubahnya menjadi simulasi. Pilih SIMULASI untuk demo aman.
          </div>
        </form>
      </div>
    </div>

    <div class="project-layout" style="margin-top:16px">
      <div id="project-detail">
        <div class="empty-state"><div class="big">🎯</div><p>Belum ada proyek yang dipilih.</p>
        <p class="small muted" style="margin-top:6px">Kirim instruksi di atas atau pilih proyek dari riwayat.</p></div>
      </div>
      <div class="stack">
        <div class="panel tight">
          <div class="panel-head"><div><h3>Riwayat Proyek</h3><div class="panel-sub">Klik untuk membuka detail</div></div>
            <span class="badge gray">${state.projects.length}</span></div>
          <div>
            ${state.projects.slice(0, 20).map((project) => `
              <div class="project-list-item ${project.id === routeParam ? 'active' : ''}" data-command-project="${esc(project.id)}">
                <div class="pli-title">${esc(project.title)}</div>
                <div class="pli-meta">${statusBadge(project.status)} ${modeBadge(project.mode)}
                  <span>${esc(timeAgo(project.created_at))}</span></div>
              </div>`).join('') || '<div class="empty-state" style="padding:14px">Belum ada proyek.</div>'}
          </div>
        </div>
        <div class="panel tight">
          <div class="panel-head"><h3>Alur Delegasi</h3></div>
          <div class="delegation-chain">
            <div class="chain-row"><span>👑 CEO</span><span class="arrow">→</span><span>📋 Secretary AI</span></div>
            <div class="chain-row"><span>📋 Secretary AI</span><span class="arrow">→</span><span>🧭 COO / Kepala Divisi</span></div>
            <div class="chain-row"><span>🧭 Kepala Divisi</span><span class="arrow">→</span><span>👥 Anggota divisi</span></div>
            <div class="chain-row"><span>👥 Anggota</span><span class="arrow">→</span><span>🔍 Quality Assurance</span></div>
            <div class="chain-row"><span>🔍 QA</span><span class="arrow">→</span><span>📋 Sekretaris</span><span class="arrow">→</span><span>👑 CEO</span></div>
          </div>
          <div class="info-box" style="margin-top:10px">Setiap delegasi tercatat dengan tugas dan eksekusi yang benar-benar dijalankan.</div>
        </div>
      </div>
    </div>
  `);
  bindGoButtons(viewEl);
  viewEl.querySelectorAll('[data-example]').forEach((button) => {
    button.addEventListener('click', () => { document.getElementById('command-instruction').value = button.dataset.example; });
  });
  viewEl.querySelectorAll('[data-command-project]').forEach((item) => {
    item.addEventListener('click', () => navigate(`#/command/${item.dataset.commandProject}`));
  });
  document.getElementById('command-form').addEventListener('submit', submitCommand);
  if (routeParam) loadProjectDetail(routeParam, { silent: false });
  else if (state.projects[0]) loadProjectDetail(state.projects[0].id, { silent: true, noRoute: true });
}

async function submitCommand(event) {
  event.preventDefault();
  const instruction = document.getElementById('command-instruction').value.trim();
  if (instruction.length < 5) { toast('Instruksi minimal 5 karakter.', 'warn'); return; }
  const mode = document.getElementById('command-mode').value;
  const engineId = document.getElementById('command-engine').value;
  const button = document.getElementById('command-submit');
  button.disabled = true;
  button.textContent = 'Mengirim...';
  try {
    const project = await api('/api/commands', { method: 'POST', body: { instruction, mode, engineId } });
    toast('Instruksi diterima. Sekretaris menyusun rencana.', 'success');
    document.getElementById('command-instruction').value = '';
    const projectSummary = {
      id: project.id, title: project.title, instruction: project.instruction, mode: project.mode,
      status: project.status, summary: project.summary || '', planning_engine_id: project.planning_engine_id,
      report_id: null, created_at: project.created_at, updated_at: project.updated_at,
      task_count: 0, done_count: 0, failed_count: 0, approval_status: '',
      planning_engine_label: secretaryEngineLabel(project.planning_engine_id),
    };
    const existing = state.projects.findIndex((item) => item.id === project.id);
    if (existing >= 0) state.projects[existing] = projectSummary;
    else state.projects.unshift(projectSummary);
    navigate(`#/command/${project.id}`);
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Kirim Instruksi';
  }
}

function secretaryEngineLabel(engineId) {
  return engineById(engineId)?.label || '-';
}

function scheduleCommandRefresh() {
  if (commandState.poll) return;
  commandState.poll = setTimeout(() => {
    commandState.poll = null;
    if (routeName === 'command' && commandState.detail) loadProjectDetail(commandState.detail.id, { silent: true });
  }, 500);
}

async function loadProjectDetail(projectId, { silent = false, noRoute = false } = {}) {
  if (commandState.projectId !== projectId) {
    commandState.projectId = projectId;
    commandState.detail = null;
    commandState.logLines = [];
  }
  try {
    const detail = await api(`/api/projects/${projectId}`);
    const changedProject = commandState.detail?.id !== detail.id;
    commandState.detail = detail;
    if (!silent && !noRoute) {
      history.replaceState(null, '', `#/command/${projectId}`);
      routeParam = projectId;
      document.querySelectorAll('[data-command-project]').forEach((item) => {
        item.classList.toggle('active', item.dataset.commandProject === projectId);
      });
    }
    if (changedProject || !commandState.logLines.length) await fetchProjectLogs(detail);
    renderProjectDetail();
    startCommandPoll(detail);
  } catch (error) {
    if (!silent) toast(error.message, 'error');
    const target = document.getElementById('project-detail');
    if (target) target.innerHTML = `<div class="empty-state"><div class="big">⚠️</div><p>${esc(error.message)}</p></div>`;
  }
}

async function fetchProjectLogs(detail) {
  const executions = (detail.executions || []).slice(0, 4);
  const lines = [];
  for (const exec of executions) {
    try {
      const data = await api(`/api/executions/${exec.id}/logs`);
      for (const log of data.logs || []) {
        lines.push({ executionId: exec.id, stream: log.stream, line: log.line, at: log.created_at });
      }
    } catch { /* ignore */ }
  }
  lines.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const seen = new Set();
  commandState.logLines = lines.filter((line) => {
    const key = `${line.executionId}|${line.at}|${line.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(-500);
}

function startCommandPoll(detail) {
  if (commandState.pollTimer) clearInterval(commandState.pollTimer);
  if (!detail || !['Direncanakan', 'Sedang dikerjakan'].includes(detail.status)) return;
  commandState.pollTimer = setInterval(() => {
    if (routeName !== 'command' || !commandState.detail) return;
    loadProjectDetail(commandState.detail.id, { silent: true });
  }, 5000);
}

function renderProjectDetail() {
  const target = document.getElementById('project-detail');
  if (!target || !commandState.detail) return;
  const detail = commandState.detail;
  const total = detail.tasks.length;
  const finished = detail.tasks.filter((task) => ['Selesai', 'Gagal', 'Dibatalkan'].includes(task.status)).length;
  const percent = total ? Math.round((finished / total) * 100) : 0;
  const activeStatuses = ['Menunggu', 'Direncanakan', 'Sedang dikerjakan', 'Dalam pemeriksaan'];
  target.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <div style="min-width:0">
          <h3 style="font-size:16px">${esc(detail.title)}</h3>
          <div class="row" style="margin-top:6px">${statusBadge(detail.status)} ${modeBadge(detail.mode)}
            <span class="badge gray">${esc(detail.planning_engine_label || '-')}</span>
            <span class="tiny muted">${esc(fmtDate(detail.created_at))}</span></div>
        </div>
        <div class="row">
          ${detail.status === 'Memerlukan persetujuan CEO' ? `
            <button class="btn btn-sm btn-green" data-approve="setuju">Setujui</button>
            <button class="btn btn-sm btn-danger" data-approve="tolak">Tolak</button>` : ''}
          ${!['Selesai', 'Gagal', 'Dibatalkan'].includes(detail.status)
            ? '<button class="btn btn-sm btn-danger" data-cancel-project>Hentikan</button>' : ''}
          ${detail.report ? '<button class="btn btn-sm" data-open-report>Laporan</button>' : ''}
        </div>
      </div>
      <div class="progress"><i style="width:${percent}%"></i></div>
      <div class="row" style="margin-top:6px"><span class="tiny muted">${finished}/${total} tugas selesai · ${percent}%</span></div>
      ${detail.summary ? `<div class="note-strip">${esc(detail.summary)}</div>` : ''}
      <div class="section-title">Tugas &amp; Delegasi</div>
      <div class="timeline">
        ${detail.tasks.map((task, index) => {
          const cls = task.status === 'Selesai' ? 'done' : ['Gagal', 'Dibatalkan'].includes(task.status) ? 'fail' : activeStatuses.includes(task.status) ? 'active' : '';
          return `<div class="tl-item ${cls}" data-task-index="${index}">
            <span class="tl-dot"></span>
            <div class="tl-body">
              <div class="tl-title">${esc(task.title)}</div>
              <div class="tl-meta">${esc(task.department)} · ${esc(task.assignee_name || '-')} (${esc(task.assignee_role || '-')})
                ${task.assigned_by_name ? ` · dari ${esc(task.assigned_by_name)}` : ''}</div>
              <div class="row" style="gap:5px;margin-top:4px">${statusBadge(task.status)}
                ${task.execution ? `<span class="badge ${task.execution.simulation ? 'sim' : 'gray'}">${task.execution.simulation ? 'SIMULASI' : esc(task.execution.engine_type)}</span>` : ''}
                ${task.execution?.status ? statusBadge(task.execution.status) : ''}</div>
            </div>
          </div>`;
        }).join('')}
      </div>
      <div class="section-title">Rantai Delegasi</div>
      <div class="delegation-chain">
        ${detail.delegations.map((delegation) => `
          <div class="chain-row">
            <span>${esc(delegation.from_name || delegation.from_agent)}</span><span class="arrow">→</span>
            <span>${esc(delegation.to_name || delegation.to_agent)}</span>
            <span class="tiny dim">· ${esc(delegation.task_title || '')}</span>
          </div>`).join('') || '<span class="tiny dim">Belum ada delegasi.</span>'}
      </div>
      <div class="section-title">Log Eksekusi
        <span class="badge ${detail.mode === 'SIMULASI' ? 'sim' : 'green'}">${detail.mode}</span>
      </div>
      <div class="row" style="margin-bottom:6px">
        ${(detail.executions || []).slice(0, 6).map((exec) => `
          <button class="btn btn-xs" data-log-exec="${esc(exec.id)}">${esc(truncate(exec.task_title || exec.id, 26))} · ${esc(exec.status)}</button>`).join('')}
      </div>
      <div class="log-console" id="project-log"></div>
    </div>`;
  renderProjectLog();
  bindGoButtons(target);
  target.querySelectorAll('[data-approve]').forEach((button) => {
    button.addEventListener('click', () => approveProject(detail, button.dataset.approve));
  });
  const cancel = target.querySelector('[data-cancel-project]');
  if (cancel) cancel.addEventListener('click', () => cancelProject(detail));
  const reportButton = target.querySelector('[data-open-report]');
  if (reportButton) reportButton.addEventListener('click', () => openReport(detail.report.id));
  target.querySelectorAll('[data-log-exec]').forEach((button) => {
    button.addEventListener('click', () => loadExecutionLogs(button.dataset.logExec));
  });
  target.querySelectorAll('[data-task-index]').forEach((item) => {
    item.style.cursor = 'pointer';
    item.addEventListener('click', () => {
      const task = detail.tasks[Number(item.dataset.taskIndex)];
      if (task) openTaskDrawer(task.id);
    });
  });
}
function renderProjectLog() {
  const consoleEl = document.getElementById('project-log');
  if (!consoleEl) return;
  if (!commandState.logLines.length) {
    consoleEl.innerHTML = '<div class="log-line muted">Belum ada log eksekusi. Log muncul saat agen mulai bekerja.</div>';
    return;
  }
  consoleEl.innerHTML = commandState.logLines.map((line) => `
    <div class="log-line ${line.stream === 'stderr' ? 'stderr' : line.stream === 'system' ? 'system' : ''}">${esc(line.line)}</div>`).join('');
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function appendProjectLog(payload) {
  commandState.logLines.push(payload);
  if (commandState.logLines.length > 800) commandState.logLines.shift();
  const consoleEl = document.getElementById('project-log');
  if (!consoleEl) return;
  if (commandState.logLines.length === 1) consoleEl.innerHTML = '';
  const div = document.createElement('div');
  div.className = `log-line ${payload.stream === 'stderr' ? 'stderr' : payload.stream === 'system' ? 'system' : ''}`;
  div.textContent = payload.line;
  consoleEl.appendChild(div);
  while (consoleEl.children.length > 800) consoleEl.removeChild(consoleEl.firstChild);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

async function loadExecutionLogs(executionId) {
  try {
    const data = await api(`/api/executions/${executionId}/logs`);
    commandState.logLines = (data.logs || []).map((log) => ({
      executionId, stream: log.stream, line: log.line, at: log.created_at,
    }));
    renderProjectLog();
    toast(`Menampilkan log eksekusi ${executionId}.`, 'info');
  } catch (error) { toast(error.message, 'error'); }
}

async function approveProject(detail, decision) {
  let note = '';
  if (decision === 'tolak') {
    note = await promptText({
      title: 'Tolak Proyek',
      label: 'Catatan penolakan (opsional)',
      placeholder: 'Jelaskan alasan penolakan...',
      confirmLabel: 'Tolak Proyek',
      danger: true,
    });
    if (note === null) return;
  } else {
    const confirmed = await confirmDialog({
      title: 'Setujui Proyek',
      message: `Setujui hasil proyek "${detail.title}"? Tugas yang menunggu persetujuan akan ditandai selesai.`,
      confirmLabel: 'Setujui',
    });
    if (!confirmed) return;
  }
  try {
    await api(`/api/projects/${detail.id}/approve`, { method: 'POST', body: { decision, note } });
    toast(decision === 'setuju' ? 'Proyek disetujui.' : 'Proyek ditolak.', 'success');
    await loadBootstrap();
    updateChrome();
    loadProjectDetail(detail.id, { silent: true });
  } catch (error) { toast(error.message, 'error'); }
}

async function cancelProject(detail) {
  const confirmed = await confirmDialog({
    title: 'Hentikan Proyek',
    message: `Hentikan seluruh pekerjaan pada proyek "${detail.title}"? Proses yang berjalan akan dihentikan.`,
    confirmLabel: 'Hentikan Proyek',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await api(`/api/projects/${detail.id}/cancel`, { method: 'POST', body: { reason: 'Dihentikan CEO dari Command Center.' } });
    toast('Proyek dihentikan.', 'success');
    await loadBootstrap();
    updateChrome();
    loadProjectDetail(detail.id, { silent: true });
  } catch (error) { toast(error.message, 'error'); }
}

function promptText({ title, label, placeholder = '', confirmLabel = 'Simpan', danger = false, value = '' }) {
  return new Promise((resolve) => {
    const ref = openModal({
      title,
      body: `<label class="field"><span>${esc(label)}</span>
        <textarea id="prompt-text" rows="4" placeholder="${esc(placeholder)}">${esc(value)}</textarea></label>`,
      footer: `<button class="btn btn-ghost" data-cancel>Batal</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirmLabel)}</button>`,
      onMount: (modalRef) => {
        const input = modalRef.modal.querySelector('#prompt-text');
        let settled = false;
        const finish = (result) => { if (settled) return; settled = true; resolve(result); ref.close(); };
        modalRef.footer.querySelector('[data-cancel]').onclick = () => finish(null);
        modalRef.footer.querySelector('[data-ok]').onclick = () => finish(input.value.trim());
        modalRef.modal.querySelector('[data-close]')?.addEventListener('click', () => finish(null));
        modalRef.overlay.addEventListener('click', (event) => { if (event.target === modalRef.overlay) finish(null); });
        setTimeout(() => input.focus(), 50);
      },
    });
  });
}

/* ============================ EMPLOYEES ============================ */
function renderEmployees() {
  setView(`
    ${pageHead('Employees', 'Kelola seluruh agen AI: peran, divisi, mesin, direktori kerja, dan status aktif.',
      '<button class="btn btn-primary" id="add-employee">+ Rekrut Agen</button>')}
    <div class="panel">
      <div class="panel-head">
        <div><h3>Daftar Karyawan AI</h3><div class="panel-sub" id="employee-count"></div></div>
        <div class="toolbar">
          <input type="search" id="employee-search" placeholder="Cari nama, jabatan, divisi..." value="${esc(currentFilter.search)}" style="width:220px">
          <select id="employee-dept">
            <option value="all">Semua divisi</option>
            ${DEPARTMENTS.map((dept) => `<option value="${esc(dept)}" ${currentFilter.department === dept ? 'selected' : ''}>${esc(dept)}</option>`).join('')}
          </select>
          <label class="row tiny muted" style="gap:5px"><input type="checkbox" id="employee-inactive" ${currentFilter.showInactive ? 'checked' : ''}> tampilkan nonaktif</label>
        </div>
      </div>
      <div class="employee-grid" id="employee-grid"></div>
    </div>
    <div class="note-strip" style="margin-top:14px">
      Menonaktifkan agen tidak menghapus riwayat. Secretary AI terakhir tidak dapat dihapus.
      Satu kepala divisi berlaku per divisi; menetapkan kepala baru menurunkan kepala sebelumnya.
    </div>
  `);
  document.getElementById('add-employee').addEventListener('click', () => openAgentForm(null));
  document.getElementById('employee-search').addEventListener('input', (event) => {
    currentFilter.search = event.target.value.trim().toLowerCase();
    renderEmployeeGrid();
  });
  document.getElementById('employee-dept').addEventListener('change', (event) => {
    currentFilter.department = event.target.value;
    renderEmployeeGrid();
  });
  document.getElementById('employee-inactive').addEventListener('change', (event) => {
    currentFilter.showInactive = event.target.checked;
    renderEmployeeGrid();
  });
  renderEmployeeGrid();
}

function filteredAgents() {
  return state.agents.filter((agent) => {
    if (!currentFilter.showInactive && !agent.active) return false;
    if (currentFilter.department !== 'all' && agent.department !== currentFilter.department) return false;
    if (currentFilter.search) {
      const haystack = `${agent.name} ${agent.role} ${agent.department} ${agent.engine_label} ${agent.personality}`.toLowerCase();
      if (!haystack.includes(currentFilter.search)) return false;
    }
    return true;
  }).sort((a, b) => Number(b.active) - Number(a.active) || Number(b.is_head) - Number(a.is_head) || a.name.localeCompare(b.name));
}

function renderEmployeeGrid() {
  const grid = document.getElementById('employee-grid');
  const count = document.getElementById('employee-count');
  if (!grid) return;
  const agents = filteredAgents();
  if (count) count.textContent = `${agents.length} dari ${state.agents.length} agen`;
  if (!agents.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="big">🧑‍💼</div><p>Tidak ada agen yang cocok dengan filter.</p></div>';
    return;
  }
  grid.innerHTML = agents.map((agent) => {
    const engine = engineById(agent.engine_id);
    const connected = isEngineConnected(engine);
    return `<article class="employee-card ${agent.active ? '' : 'inactive'}" data-agent-card="${esc(agent.id)}">
      <div class="ec-head">
        <span class="avatar">${esc(agent.avatar)}</span>
        <div class="ec-id">
          <div class="ec-name">${esc(agent.name)} ${agent.is_head ? '<span class="badge" style="color:var(--accent-2)">KEPALA</span>' : ''}</div>
          <div class="ec-role">${esc(agent.role)}</div>
          <div class="row" style="gap:4px;margin-top:4px">${statusBadge(agent.status)} ${agent.active ? '' : '<span class="badge gray">Nonaktif</span>'}</div>
        </div>
      </div>
      <div class="ec-body">
        <div class="kv compact">
          <span class="k">Divisi</span><span class="v">${esc(agent.department)}</span>
          <span class="k">Mesin</span><span class="v"><i class="dot ${connected ? 'green' : 'red'}"></i> ${esc(agent.engine_label)}</span>
          <span class="k">Model</span><span class="v mono">${esc(agent.model || 'bawaan')}</span>
          <span class="k">Tugas</span><span class="v">${agent.active_tasks || 0} aktif · ${agent.done_tasks || 0} selesai</span>
        </div>
        <div class="ec-personality">${esc(truncate(agent.personality || 'Belum ada deskripsi kepribadian.', 90))}</div>
      </div>
      <div class="ec-actions">
        <button class="btn btn-xs" data-agent-edit="${esc(agent.id)}">Edit</button>
        <button class="btn btn-xs" data-agent-tasks="${esc(agent.id)}">Riwayat</button>
        ${agent.active ? `<button class="btn btn-xs btn-danger" data-agent-deactivate="${esc(agent.id)}">Nonaktifkan</button>`
          : `<button class="btn btn-xs btn-green" data-agent-activate="${esc(agent.id)}">Aktifkan</button>`}
      </div>
    </article>`;
  }).join('');
  grid.querySelectorAll('[data-agent-edit]').forEach((button) => {
    button.addEventListener('click', () => openAgentForm(agentById(button.dataset.agentEdit)));
  });
  grid.querySelectorAll('[data-agent-tasks]').forEach((button) => {
    button.addEventListener('click', () => openAgentHistory(button.dataset.agentTasks));
  });
  grid.querySelectorAll('[data-agent-deactivate]').forEach((button) => {
    button.addEventListener('click', () => deactivateAgent(button.dataset.agentDeactivate));
  });
  grid.querySelectorAll('[data-agent-activate]').forEach((button) => {
    button.addEventListener('click', () => setAgentActive(button.dataset.agentActivate, true));
  });
  grid.querySelectorAll('[data-agent-card]').forEach((card) => {
    card.addEventListener('dblclick', () => openAgentDrawer(card.dataset.agentCard));
  });
}
function openAgentForm(agent) {
  const isEdit = Boolean(agent);
  const engineOptions = state.engines.map((engine) => {
    const selected = agent ? engine.id === agent.engine_id : engine.id === 'engine-opencode';
    return `<option value="${esc(engine.id)}" ${selected ? 'selected' : ''}>${esc(engine.label)}${isEngineConnected(engine) ? '' : ' — belum terhubung'}</option>`;
  }).join('');
  const ref = openModal({
    title: isEdit ? `Edit Agen — ${agent.name}` : 'Rekrut Agen Baru',
    wide: true,
    body: `
      <form id="agent-form" class="form-grid">
        <label class="field"><span>Nama agen</span><input name="name" required maxlength="80" value="${esc(agent?.name || '')}" placeholder="Contoh: Rina Putri"></label>
        <label class="field"><span>Jabatan</span><input name="role" required maxlength="80" value="${esc(agent?.role || '')}" placeholder="Contoh: Frontend Developer"></label>
        <label class="field"><span>Divisi</span><select name="department">${DEPARTMENTS.map((dept) => `<option ${agent?.department === dept ? 'selected' : ''}>${dept}</option>`).join('')}</select></label>
        <label class="field"><span>Level</span><select name="level">
          <option value="staff" ${(!agent || agent.level === 'staff') ? 'selected' : ''}>Staff</option>
          <option value="head" ${agent?.level === 'head' ? 'selected' : ''}>Kepala Divisi</option>
          <option value="executive" ${agent?.level === 'executive' ? 'selected' : ''}>Executive</option>
          <option value="secretary" ${agent?.level === 'secretary' ? 'selected' : ''}>Secretary</option>
        </select></label>
        <label class="field"><span>Avatar (emoji)</span><input name="avatar" maxlength="8" value="${esc(agent?.avatar || '🧑‍💻')}" required></label>
        <label class="field"><span>Mesin AI</span><select name="engine_id">${engineOptions}</select></label>
        <label class="field"><span>Model (opsional)</span><input name="model" maxlength="160" value="${esc(agent?.model || '')}" placeholder="opencode/deepseek-v4.1-flash-free"></label>
        <label class="field"><span>Direktori kerja (opsional)</span><input name="workdir" maxlength="500" value="${esc(agent?.workdir || '')}" placeholder="Otomatis di dalam workspace root"></label>
        <label class="field span-2"><span>Kepribadian &amp; keahlian</span><textarea name="personality" rows="3" maxlength="400" placeholder="Gaya kerja, keahlian, dan batasan agen...">${esc(agent?.personality || '')}</textarea></label>
        <div class="note-strip span-2">Agen dengan mesin yang belum terhubung hanya bisa dipakai pada proyek SIMULASI. Direktori kerja dibatasi di bawah workspace aplikasi.</div>
      </form>`,
    footer: `<button class="btn btn-ghost" data-close>Batal</button>
      <button class="btn btn-primary" id="agent-save">${isEdit ? 'Simpan Perubahan' : 'Rekrut Agen'}</button>`,
  });
  ref.footer.querySelector('#agent-save').addEventListener('click', async () => {
    const form = ref.modal.querySelector('#agent-form');
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form).entries());
    const button = ref.footer.querySelector('#agent-save');
    button.disabled = true;
    button.textContent = 'Menyimpan...';
    try {
      if (isEdit) await api(`/api/agents/${agent.id}`, { method: 'PATCH', body: data });
      else await api('/api/agents', { method: 'POST', body: data });
      await loadBootstrap();
      updateChrome();
      ref.close();
      toast(isEdit ? 'Data agen diperbarui.' : 'Agen baru berhasil direkrut.', 'success');
      if (routeName === 'employees') renderEmployees();
      else if (routeName === 'departments') renderDepartments();
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
      button.textContent = isEdit ? 'Simpan Perubahan' : 'Rekrut Agen';
    }
  });
}

async function deactivateAgent(agentId) {
  const agent = agentById(agentId);
  if (!agent) return;
  const confirmed = await confirmDialog({
    title: 'Nonaktifkan Agen',
    message: `Nonaktifkan ${agent.name} (${agent.role})? Riwayat tetap tersimpan.`,
    confirmLabel: 'Nonaktifkan', danger: true,
  });
  if (!confirmed) return;
  try {
    await api(`/api/agents/${agentId}`, { method: 'DELETE' });
    await loadBootstrap();
    updateChrome();
    renderEmployees();
    toast(`${agent.name} dinonaktifkan.`, 'success');
  } catch (error) { toast(error.message, 'error'); }
}

async function setAgentActive(agentId, active) {
  try {
    await api(`/api/agents/${agentId}`, { method: 'PATCH', body: { active } });
    await loadBootstrap();
    updateChrome();
    renderEmployees();
    toast(active ? 'Agen diaktifkan kembali.' : 'Agen dinonaktifkan.', 'success');
  } catch (error) { toast(error.message, 'error'); }
}

async function openAgentHistory(agentId) {
  const agent = agentById(agentId);
  if (!agent) return;
  try {
    const tasks = await api(`/api/agents/${agentId}/tasks`);
    openModal({
      title: `Riwayat — ${agent.name}`,
      wide: true,
      body: `<div class="row" style="margin-bottom:12px">
          <span class="avatar">${esc(agent.avatar)}</span>
          <div><div style="font-weight:700">${esc(agent.name)}</div><div class="tiny muted">${esc(agent.role)} · ${esc(agent.department)}</div></div>
          <span class="spacer"></span>${statusBadge(agent.status)}
        </div>
        ${tasks.length ? `<table class="data-table"><thead><tr><th>Tugas</th><th>Proyek</th><th>Status</th><th>Dibuat</th></tr></thead><tbody>
          ${tasks.map((task) => `<tr><td>${esc(task.title)}</td><td>${esc(task.project_title || '-')}</td><td>${statusBadge(task.status)}</td><td class="tiny muted">${esc(fmtDate(task.created_at))}</td></tr>`).join('')}
        </tbody></table>` : '<div class="empty-state">Agen belum memiliki riwayat tugas.</div>'}
        <div class="note-strip" style="margin-top:12px">Menampilkan maksimal 100 tugas terakhir.</div>`,
      footer: '<button class="btn btn-ghost" data-close>Tutup</button>',
    });
  } catch (error) { toast(error.message, 'error'); }
}

function openAgentDrawer(agentId) {
  const agent = agentById(agentId);
  if (!agent) return;
  const engine = engineById(agent.engine_id);
  const tasks = state.tasks.filter((task) => task.assignee_id === agentId).slice(0, 8);
  openDrawer({
    title: `Detail Agen — ${agent.name}`,
    body: `
      <div class="row" style="gap:12px;align-items:flex-start">
        <span class="avatar lg">${esc(agent.avatar)}</span>
        <div style="min-width:0">
          <div style="font-size:17px;font-weight:800">${esc(agent.name)}</div>
          <div class="muted small">${esc(agent.role)} · ${esc(agent.department)}</div>
          <div class="row" style="gap:4px;margin-top:5px">${statusBadge(agent.status)} ${agent.is_head ? '<span class="badge" style="color:var(--accent-2)">KEPALA DIVISI</span>' : ''}${agent.active ? '' : '<span class="badge gray">Nonaktif</span>'}</div>
        </div>
      </div>
      <div class="divider"></div>
      <div class="kv">
        <span class="k">Mesin AI</span><span class="v">${esc(agent.engine_label)} — ${esc(agent.engine_status)}</span>
        <span class="k">Model</span><span class="v mono">${esc(agent.model || 'bawaan')}</span>
        <span class="k">Level</span><span class="v">${esc(agent.level)}</span>
        <span class="k">Tugas aktif</span><span class="v">${agent.active_tasks || 0}</span>
        <span class="k">Tugas selesai</span><span class="v">${agent.done_tasks || 0}</span>
        <span class="k">Direktori kerja</span><span class="v mono tiny">${esc(agent.workdir || '-')}</span>
      </div>
      <div class="section-title">Kepribadian</div>
      <div class="info-box">${esc(agent.personality || 'Belum diisi.')}</div>
      ${engine && !isEngineConnected(engine) ? `<div class="note-strip" style="margin-top:12px"><strong>Mesin belum terhubung.</strong> Agen ini akan diperlakukan sebagai agen simulasi sampai koneksi mesin diperbaiki.</div>` : ''}
      <div class="section-title">Tugas Terakhir</div>
      ${tasks.length ? `<div class="timeline">${tasks.map((task) => `
        <div class="tl-item ${task.status === 'Selesai' ? 'done' : ['Gagal', 'Dibatalkan'].includes(task.status) ? 'fail' : ''}">
          <span class="tl-dot"></span><div class="tl-body"><div class="tl-title">${esc(task.title)}</div>
          <div class="tl-meta">${esc(task.project_title || '-')} · ${esc(fmtDate(task.created_at))}</div>
          <div style="margin-top:3px">${statusBadge(task.status)}</div></div></div>`).join('')}</div>`
        : '<div class="empty-state" style="padding:14px">Belum ada tugas.</div>'}`,
    footer: `<button class="btn btn-ghost" data-close>Tutup</button>
      <button class="btn" id="drawer-agent-history">Riwayat Lengkap</button>
      <button class="btn btn-primary" id="drawer-agent-edit">Edit Agen</button>`,
    onMount: (ref) => {
      ref.drawer.querySelector('[data-close]').addEventListener('click', ref.close);
      ref.footer.querySelector('#drawer-agent-edit').addEventListener('click', () => { ref.close(); openAgentForm(agent); });
      ref.footer.querySelector('#drawer-agent-history').addEventListener('click', () => { ref.close(); openAgentHistory(agentId); });
    },
  });
}
/* ============================ DEPARTMENTS ============================ */
function renderDepartments() {
  const departments = DEPARTMENTS.map((name) => {
    const members = state.agents.filter((agent) => agent.active && agent.department === name);
    const head = members.find((agent) => agent.is_head) || null;
    const stats = (state.stats?.departments || []).find((item) => item.department === name)
      || { agents: members.length, tasks: 0, done: 0, productivity: 0 };
    return { name, head, members, stats };
  });
  const secretary = state.agents.find((agent) => agent.active && agent.role === 'Secretary AI');
  const coo = state.agents.find((agent) => agent.active && agent.role === 'COO');
  setView(`
    ${pageHead('Departments', 'Struktur organisasi perusahaan AI dan produktivitas tiap divisi.',
      '<button class="btn" data-go="#/employees">Kelola Agen</button><button class="btn btn-primary" data-go="#/tasks">Task Manager</button>')}
    <div class="panel">
      <div class="panel-head"><div><h3>Struktur Organisasi</h3><div class="panel-sub">Kepala divisi bertanggung jawab mengarahkan anggota dan mendelegasikan tugas</div></div>
        <span class="badge blue">${state.agents.filter((agent) => agent.active).length} agen aktif</span></div>
      <div class="org">
        <div class="org-node head"><div class="on">${esc(state.company?.ceo_avatar || '👑')} ${esc(state.company?.ceo_name || 'CEO')}</div><div class="or">Chief Executive Officer</div></div>
        <div class="org-line"></div>
        <div class="org-branches">
          <div class="org-branch">
            <div class="org-node"><div class="on">${esc(secretary?.avatar || '📋')} ${esc(secretary?.name || 'Secretary AI')}</div><div class="or">Secretary AI — perencanaan &amp; delegasi</div></div>
          </div>
          <div class="org-branch">
            <div class="org-node"><div class="on">${esc(coo?.avatar || '🧭')} ${esc(coo?.name || 'COO')}</div><div class="or">Chief Operating Officer</div></div>
          </div>
        </div>
        <div class="org-line"></div>
        <div class="org-branches">
          ${departments.map((dept) => `
            <div class="org-branch">
              <div class="org-node ${dept.head ? 'head' : ''}">
                <div class="on">${esc(dept.head?.avatar || '👥')} ${esc(dept.head?.name || 'Belum ada kepala')}</div>
                <div class="or">${esc(dept.name)}</div>
              </div>
              <div class="org-members">
                ${dept.members.map((member) => `<div class="org-member"><span>${esc(member.avatar)} ${esc(member.name)}</span><span class="dim">${esc(member.role)}</span></div>`).join('') || '<div class="org-member"><span>Belum ada anggota</span></div>'}
              </div>
            </div>`).join('')}
        </div>
      </div>
    </div>

    <div class="grid grid-3" style="margin-top:14px">
      ${departments.map((dept) => `
        <div class="dept-card">
          <div class="row" style="justify-content:space-between;margin-bottom:8px">
            <div><div style="font-weight:700">${esc(dept.name)}</div>
              <div class="tiny muted">${dept.stats.agents} agen · ${dept.stats.tasks} tugas</div></div>
            <span class="badge" style="border-color:${deptColor(dept.name)};color:${deptColor(dept.name)}">${dept.stats.productivity}%</span>
          </div>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, dept.stats.productivity)}%;background:${deptColor(dept.name)}"></div></div>
          <div class="row" style="justify-content:space-between;margin-top:5px">
            <span class="tiny muted">${dept.stats.done} selesai</span>
            <span class="tiny muted">${dept.head ? `Kepala: ${esc(dept.head.name)}` : 'Tanpa kepala'}</span>
          </div>
          <div class="divider"></div>
          <div class="row" style="gap:4px">
            ${dept.members.slice(0, 4).map((agent) => `<button class="tag" data-dept-agent="${esc(agent.id)}">${esc(agent.avatar)} ${esc(agent.name)}</button>`).join('') || '<span class="tiny dim">Belum ada anggota aktif</span>'}
            ${dept.members.length > 4 ? `<span class="tiny dim">+${dept.members.length - 4} lain</span>` : ''}
          </div>
          <div class="row" style="margin-top:10px">
            <button class="btn btn-xs" data-dept-tasks="${esc(dept.name)}">Lihat Tugas</button>
            <button class="btn btn-xs" data-dept-members="${esc(dept.name)}">Anggota</button>
          </div>
        </div>`).join('')}
    </div>
    <div class="note-strip" style="margin-top:14px">Produktivitas dihitung dari jumlah tugas selesai dibagi total tugas divisi. Angka dapat berubah saat proyek berjalan.</div>
  `);
  bindGoButtons(viewEl);
  viewEl.querySelectorAll('[data-dept-agent]').forEach((button) => {
    button.addEventListener('click', () => openAgentDrawer(button.dataset.deptAgent));
  });
  viewEl.querySelectorAll('[data-dept-members]').forEach((button) => {
    button.addEventListener('click', () => openDepartmentMembers(button.dataset.deptMembers, departments));
  });
  viewEl.querySelectorAll('[data-dept-tasks]').forEach((button) => {
    button.addEventListener('click', () => {
      taskFilter.department = button.dataset.deptTasks;
      taskFilter.project = 'all';
      taskFilter.status = 'all';
      taskFilter.search = '';
      navigate('#/tasks');
    });
  });
}

function openDepartmentMembers(name, departments) {
  const dept = departments.find((item) => item.name === name);
  if (!dept) return;
  openModal({
    title: `Anggota Divisi ${name}`,
    wide: true,
    body: `${dept.head ? `<div class="info-box" style="margin-bottom:10px">Kepala divisi: <strong>${esc(dept.head.name)}</strong> — ${esc(dept.head.role)}</div>` : '<div class="warning-box" style="margin-bottom:10px">Divisi ini belum memiliki kepala divisi.</div>'}
      <div class="emp-grid">${dept.members.map((agent) => `
        <div class="emp-card">
          <div class="emp-top"><span class="avatar">${esc(agent.avatar)}</span>
            <div class="info"><div class="emp-name">${esc(agent.name)}</div><div class="emp-role">${esc(agent.role)}</div></div>
            ${statusBadge(agent.status)}</div>
          <div class="emp-stats"><span>Tugas aktif <b>${agent.active_tasks || 0}</b></span><span>Selesai <b>${agent.done_tasks || 0}</b></span></div>
          <div class="emp-actions"><button class="btn btn-xs" data-open-agent="${esc(agent.id)}">Detail</button></div>
        </div>`).join('') || '<div class="empty-state">Belum ada anggota aktif.</div>'}</div>`,
    footer: '<button class="btn btn-ghost" data-close>Tutup</button>',
    onMount: (ref) => {
      ref.modal.querySelectorAll('[data-open-agent]').forEach((button) => {
        button.addEventListener('click', () => { ref.close(); openAgentDrawer(button.dataset.openAgent); });
      });
    },
  });
}

/* ============================ TASKS ============================ */
function renderTasks() {
  const projects = state.projects;
  setView(`
    ${pageHead('Task Manager', 'Pantau seluruh tugas, delegasi, dan eksekusi dari semua proyek.',
      `${taskFilter.department ? `<button class="btn btn-sm" id="clear-dept-filter">Divisi: ${esc(taskFilter.department)} ×</button>` : ''}<button class="btn btn-primary" data-go="#/command">Instruksi Baru</button>`)}
    <div class="panel">
      <div class="panel-head">
        <div><h3>Papan Tugas</h3><div class="panel-sub" id="task-count"></div></div>
        <div class="toolbar">
          <select id="task-project-filter">
            <option value="all">Semua proyek</option>
            ${projects.map((project) => `<option value="${esc(project.id)}" ${taskFilter.project === project.id ? 'selected' : ''}>${esc(truncate(project.title, 42))}</option>`).join('')}
          </select>
          <select id="task-status-filter">
            <option value="all">Semua status</option>
            ${TASK_STATUSES.map((status) => `<option value="${esc(status)}" ${taskFilter.status === status ? 'selected' : ''}>${esc(status)}</option>`).join('')}
          </select>
          <input type="search" id="task-search" placeholder="Cari tugas..." value="${esc(taskFilter.search)}" style="width:190px">
        </div>
      </div>
      <div class="kanban" id="task-kanban"></div>
    </div>
    <div class="note-strip" style="margin-top:14px">Kartu bertanda <strong>SIMULASI</strong> berasal dari mesin simulasi. Buka kartu untuk melihat detail tugas, delegasi, dan log eksekusi.</div>
  `);
  bindGoButtons(viewEl);
  document.getElementById('clear-dept-filter')?.addEventListener('click', () => {
    taskFilter.department = null;
    renderTasks();
  });
  document.getElementById('task-project-filter').addEventListener('change', (event) => {
    taskFilter.project = event.target.value;
    renderTaskBoardOnly();
  });
  document.getElementById('task-status-filter').addEventListener('change', (event) => {
    taskFilter.status = event.target.value;
    renderTaskBoardOnly();
  });
  document.getElementById('task-search').addEventListener('input', (event) => {
    taskFilter.search = event.target.value.trim().toLowerCase();
    renderTaskBoardOnly();
  });
  renderTaskBoardOnly();
}

function filteredTasks() {
  return state.tasks.filter((task) => {
    if (taskFilter.project !== 'all' && task.project_id !== taskFilter.project) return false;
    if (taskFilter.status !== 'all' && task.status !== taskFilter.status) return false;
    if (taskFilter.department && task.department !== taskFilter.department) return false;
    if (taskFilter.search) {
      const haystack = `${task.title} ${task.assignee_name || ''} ${task.department || ''} ${task.project_title || ''}`.toLowerCase();
      if (!haystack.includes(taskFilter.search)) return false;
    }
    return true;
  });
}

function renderTaskBoardOnly() {
  const board = document.getElementById('task-kanban');
  const count = document.getElementById('task-count');
  if (!board) return;
  const tasks = filteredTasks();
  if (count) count.textContent = `${tasks.length} tugas ditampilkan · total ${state.tasks.length}`;
  const columns = TASK_STATUSES;
  board.innerHTML = columns.map((status) => {
    const items = tasks.filter((task) => task.status === status);
    return `<div class="kcol">
      <div class="kcol-head"><span>${esc(status)}</span><span>${items.length}</span></div>
      <div class="kcol-body">
        ${items.map(taskCard).join('') || '<div class="kempty">Kosong</div>'}
      </div>
    </div>`;
  }).join('');
  board.querySelectorAll('[data-task-open]').forEach((card) => {
    card.addEventListener('click', () => openTaskDrawer(card.dataset.taskOpen));
  });
}

function taskCard(task) {
  return `<article class="kcard" data-task-open="${esc(task.id)}">
    <div class="kt">${esc(task.title)}</div>
    <div class="km">${statusBadge(task.status)}
      ${task.execution_simulation ? '<span class="badge sim">SIMULASI</span>' : task.execution_status ? '<span class="badge green">NYATA</span>' : ''}</div>
    <div class="km"><span>${esc(task.assignee_name || 'Belum ditugaskan')}</span><span>·</span><span>${esc(task.department || '-')}</span></div>
    <div class="ke truncate">${esc(task.project_title || '-')} · ${esc(timeAgo(task.created_at))}</div>
  </article>`;
}
/* ============================ TASK DRAWER ============================ */
async function openTaskDrawer(taskId) {
  taskDrawerState = { taskId, executionId: null, detail: null, refreshing: false };
  const ref = openDrawer({
    title: 'Detail Tugas',
    body: '<div class="loading-block"><div class="pixel-spinner"></div><span>Memuat detail tugas...</span></div>',
    footer: '<button class="btn btn-ghost" data-close>Tutup</button>',
    onMount: (drawerRef) => {
      drawerRef.drawer.querySelector('[data-close]').addEventListener('click', () => {
        taskDrawerState = null;
        drawerRef.close();
      });
    },
  });
  try {
    const detail = await api(`/api/tasks/${taskId}`);
    if (!ref.drawer.isConnected) return;
    taskDrawerState.detail = detail;
    taskDrawerState.executionId = detail.execution_id || detail.execution?.id || null;
    ref.drawer.querySelector('.drawer-head h3').textContent = `Detail Tugas — ${truncate(detail.title, 40)}`;
    renderTaskDrawer(ref, detail);
  } catch (error) {
    ref.body.innerHTML = `<div class="empty-state"><div class="big">⚠️</div><p>${esc(error.message)}</p></div>`;
  }
}

function taskDrawerContent(detail) {
  const execution = detail.execution;
  const logs = detail.logs || [];
  return `<div id="task-drawer-content">
    <div class="row" style="align-items:flex-start;gap:10px">
      <div style="flex:1;min-width:0"><div style="font-weight:700;font-size:14px">${esc(detail.title)}</div>
        <div class="tiny muted">${esc(detail.project_title || '-')}</div></div>
      <div class="row" style="gap:4px">${statusBadge(detail.status)}
        ${execution ? `<span class="badge ${execution.simulation ? 'sim' : 'green'}">${execution.simulation ? 'SIMULASI' : 'NYATA'}</span>` : ''}</div>
    </div>
    <div class="divider"></div>
    <div class="kv">
      <span class="k">Divisi</span><span class="v">${esc(detail.department || '-')}</span>
      <span class="k">Pelaksana</span><span class="v">${esc(detail.assignee_name || '-')} (${esc(detail.assignee_role || '-')})</span>
      <span class="k">Didelegasikan</span><span class="v">${esc(detail.assigned_by_name || 'Sistem')}</span>
      <span class="k">Prioritas</span><span class="v">${esc(detail.priority || '-')}</span>
      <span class="k">Dibuat</span><span class="v">${esc(fmtDate(detail.created_at))}</span>
      <span class="k">Diperbarui</span><span class="v">${esc(fmtDate(detail.updated_at))}</span>
    </div>
    <div class="section-title">Deskripsi</div>
    <div class="info-box">${esc(detail.description || 'Tidak ada deskripsi.')}</div>
    ${detail.result ? `<div class="section-title">Hasil</div><div class="report-body">${esc(detail.result)}</div>` : ''}
    ${detail.error ? `<div class="section-title">Kesalahan</div><div class="danger-box">${esc(detail.error)}</div>` : ''}
    <div class="section-title">Eksekusi</div>
    ${execution ? `<div class="kv">
        <span class="k">Status</span><span class="v">${statusBadge(execution.status)}</span>
        <span class="k">Mesin</span><span class="v mono">${esc(execution.engine_type)}</span>
        <span class="k">Model</span><span class="v mono">${esc(execution.model || 'bawaan')}</span>
        <span class="k">Mulai</span><span class="v">${esc(fmtDate(execution.started_at))}</span>
        <span class="k">Selesai</span><span class="v">${esc(fmtDate(execution.ended_at))}</span>
        ${execution.exit_code !== null && execution.exit_code !== undefined ? `<span class="k">Exit code</span><span class="v mono">${execution.exit_code}</span>` : ''}
      </div>` : '<div class="info-box">Tugas ini belum memiliki eksekusi.</div>'}
    <div class="section-title">Log Eksekusi</div>
    <div class="log-console" id="drawer-log" style="height:220px">${logs.map((log) => `<div class="log-line ${log.stream === 'stderr' ? 'stderr' : ''}">${esc(log.line)}</div>`).join('') || '<div class="log-line muted">Belum ada log.</div>'}</div>
    <div class="note-strip">Log diperbarui secara real-time melalui SSE. Data sensitif diredaksi oleh server.</div>
  </div>`;
}

function renderTaskDrawer(ref, detail) {
  ref.body.innerHTML = taskDrawerContent(detail);
  const footer = ref.drawer.querySelector('.drawer-foot');
  if (!footer) return;
  const canCancel = !['Selesai', 'Gagal', 'Dibatalkan'].includes(detail.status);
  footer.innerHTML = `<button class="btn btn-ghost" data-close>Tutup</button>
    ${detail.project_id ? '<button class="btn" data-open-project>Proyek</button>' : ''}
    ${canCancel ? '<button class="btn btn-danger" data-cancel-task>Hentikan Tugas</button>' : ''}`;
  footer.querySelector('[data-close]').onclick = () => { taskDrawerState = null; ref.close(); };
  footer.querySelector('[data-open-project]')?.addEventListener('click', () => {
    taskDrawerState = null; ref.close(); navigate(`#/command/${detail.project_id}`);
  });
  footer.querySelector('[data-cancel-task]')?.addEventListener('click', () => cancelTaskFromDrawer(detail, ref));
  const logEl = ref.body.querySelector('#drawer-log');
  if (logEl) logEl.scrollTop = logEl.scrollHeight;
}

async function cancelTaskFromDrawer(detail, ref) {
  const confirmed = await confirmDialog({
    title: 'Hentikan Tugas',
    message: `Hentikan tugas "${detail.title}"? Proses yang berjalan akan dihentikan.`,
    confirmLabel: 'Hentikan', danger: true,
  });
  if (!confirmed) return;
  try {
    await api(`/api/tasks/${detail.id}/cancel`, { method: 'POST', body: { reason: 'Dihentikan CEO dari detail tugas.' } });
    toast('Tugas dihentikan.', 'success');
    const updated = await api(`/api/tasks/${detail.id}`);
    if (taskDrawerState && ref.drawer.isConnected) {
      taskDrawerState.detail = updated;
      renderTaskDrawer(ref, updated);
    }
    await loadBootstrap();
    updateChrome();
    if (routeName === 'tasks') renderTaskBoardOnly();
  } catch (error) { toast(error.message, 'error'); }
}

function scheduleTaskDrawerRefresh() {
  if (!taskDrawerState || taskDrawerState.refreshing) return;
  taskDrawerState.refreshing = true;
  setTimeout(async () => {
    if (!taskDrawerState) return;
    const taskId = taskDrawerState.taskId;
    try {
      const detail = await api(`/api/tasks/${taskId}`);
      if (!taskDrawerState) return;
      taskDrawerState.detail = detail;
      taskDrawerState.executionId = detail.execution_id || detail.execution?.id || null;
      const drawer = document.querySelector('.drawer');
      if (drawer) {
        const ref = { drawer, body: drawer.querySelector('.drawer-body') };
        renderTaskDrawer(ref, detail);
      }
    } catch { /* keep current view */ }
    if (taskDrawerState) taskDrawerState.refreshing = false;
  }, 500);
}

function appendDrawerLog(payload) {
  const logEl = document.getElementById('drawer-log');
  if (!logEl) return;
  if (logEl.firstElementChild?.classList.contains('muted')) logEl.innerHTML = '';
  const line = document.createElement('div');
  line.className = `log-line ${payload.stream === 'stderr' ? 'stderr' : ''}`;
  line.textContent = payload.line;
  logEl.appendChild(line);
  while (logEl.children.length > 600) logEl.removeChild(logEl.firstChild);
  logEl.scrollTop = logEl.scrollHeight;
}
/* ============================ MEETINGS ============================ */
function renderMeetings() {
  setView(`
    ${pageHead('Meetings', 'Ruang rapat virtual. Ringkasan rapat dibuat oleh mesin simulasi dan ditandai jelas.',
      '<button class="btn btn-primary" id="schedule-meeting">+ Jadwalkan Rapat</button>')}
    <div class="panel">
      <div class="panel-head"><div><h3>Riwayat Rapat</h3><div class="panel-sub">Peserta akan ditandai sedang rapat lalu kembali idle otomatis</div></div>
        <span class="badge gray">${state.meetings.length} rapat</span></div>
      <div class="meeting-grid" id="meeting-grid"></div>
    </div>
    <div class="note-strip" style="margin-top:14px"><strong>Catatan:</strong> ringkasan rapat saat ini menggunakan mesin simulasi. Tidak ada panggilan AI nyata pada fitur rapat.</div>
  `);
  document.getElementById('schedule-meeting').addEventListener('click', openMeetingForm);
  renderMeetingGrid();
}

function renderMeetingGrid() {
  const grid = document.getElementById('meeting-grid');
  if (!grid) return;
  if (!state.meetings.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="big">🪑</div><p>Belum ada rapat. Jadwalkan rapat pertama.</p></div>';
    return;
  }
  grid.innerHTML = state.meetings.map((meeting) => {
    const attendees = parseAttendees(meeting.attendees);
    return `<article class="meeting-card">
      <div class="row" style="justify-content:space-between"><div class="mt">${esc(meeting.title)}</div>
        ${statusBadge(meeting.status || 'Selesai')}</div>
      <div class="tiny muted" style="margin-top:3px">${esc(fmtDate(meeting.created_at))} · ${attendees.length} peserta · ${esc(meeting.mode || 'SIMULASI')}</div>
      <div class="row" style="gap:4px;margin-top:8px">${attendees.map((id) => {
        const agent = agentById(id);
        return `<span class="tag">${esc(agent?.avatar || '👤')} ${esc(agent?.name || id)}</span>`;
      }).join('') || '<span class="tiny dim">Tanpa peserta</span>'}</div>
      ${meeting.agenda ? `<div class="info-box" style="margin-top:8px"><strong>Agenda:</strong> ${esc(meeting.agenda)}</div>` : ''}
      <div class="meeting-summary">${esc(meeting.summary || 'Belum ada ringkasan.')}</div>
    </article>`;
  }).join('');
}

function parseAttendees(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function openMeetingForm() {
  const activeAgents = state.agents.filter((agent) => agent.active);
  const ref = openModal({
    title: 'Jadwalkan Rapat',
    wide: true,
    body: `<form id="meeting-form" class="stack">
      <label class="field"><span>Judul rapat</span><input name="title" required maxlength="120" placeholder="Contoh: Sinkronisasi peluncuran produk"></label>
      <label class="field"><span>Agenda</span><textarea name="agenda" rows="3" maxlength="1500" placeholder="Topik yang dibahas..."></textarea></label>
      <div class="field"><span>Peserta (${activeAgents.length} agen aktif)</span>
        <div class="attendee-checkboxes">
          ${activeAgents.map((agent) => `<label class="row tiny" style="gap:6px;align-items:flex-start">
            <input type="checkbox" name="attendees" value="${esc(agent.id)}" ${['Secretary AI', 'COO'].includes(agent.role) || agent.is_head ? 'checked' : ''}>
            <span>${esc(agent.avatar)} <strong>${esc(agent.name)}</strong><br><span class="dim">${esc(agent.role)} · ${esc(agent.department)}</span></span>
          </label>`).join('')}
        </div>
      </div>
      <div class="note-strip">Ringkasan rapat dihasilkan mesin simulasi. Status peserta akan berubah menjadi <strong>Rapat</strong> sementara.</div>
    </form>`,
    footer: `<button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-primary" id="meeting-save">Jadwalkan</button>`,
  });
  ref.footer.querySelector('#meeting-save').addEventListener('click', async () => {
    const form = ref.modal.querySelector('#meeting-form');
    if (!form.reportValidity()) return;
    const title = form.elements.title.value.trim();
    const agenda = form.elements.agenda.value.trim();
    const attendees = [...form.querySelectorAll('input[name="attendees"]:checked')].map((input) => input.value);
    if (!attendees.length) { toast('Pilih minimal satu peserta rapat.', 'warn'); return; }
    const button = ref.footer.querySelector('#meeting-save');
    button.disabled = true;
    try {
      await api('/api/meetings', { method: 'POST', body: { title, agenda, attendees } });
      ref.close();
      toast('Rapat dijadwalkan.', 'success');
      await loadBootstrap();
      updateChrome();
      if (routeName === 'meetings') renderMeetings();
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
    }
  });
}

async function refreshMeetings() {
  try {
    await loadBootstrap();
    updateChrome();
    if (routeName === 'meetings') renderMeetings();
  } catch { /* ignore */ }
}

/* ============================ REPORTS ============================ */
function renderReports() {
  setView(`
    ${pageHead('Reports', 'Laporan hasil pekerjaan per divisi dan per proyek. Setiap laporan memiliki label mode.',
      '<button class="btn btn-primary" data-go="#/command">Buat Proyek</button>')}
    <div class="panel">
      <div class="panel-head"><div><h3>Daftar Laporan</h3><div class="panel-sub">Klik laporan untuk membaca isi lengkap dan mengunduh</div></div>
        <span class="badge gray">${state.reports.length} laporan</span></div>
      <div class="report-list" id="report-list"></div>
    </div>
    <div class="note-strip" style="margin-top:14px">Laporan mode SIMULASI tidak boleh dianggap sebagai hasil eksekusi AI nyata. Mode NYATA dibuat dari eksekusi OpenCode/Hermes yang tercatat.</div>
  `);
  bindGoButtons(viewEl);
  renderReportList();
}

function renderReportList() {
  const list = document.getElementById('report-list');
  if (!list) return;
  if (!state.reports.length) {
    list.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="big">📄</div><p>Belum ada laporan. Laporan dibuat setelah proyek selesai diproses.</p></div>';
    return;
  }
  list.innerHTML = state.reports.map((report) => `
    <article class="report-card" data-report-open="${esc(report.id)}">
      <div class="row" style="justify-content:space-between"><div class="rt">${esc(report.title)}</div>${modeBadge(report.mode)}</div>
      <div class="tiny muted">${esc(report.project_title || report.project_id || '-')}</div>
      <div class="row" style="gap:4px">${statusBadge(report.department || 'Operasional')}
        <span class="tiny muted">${esc(report.author_name || 'Sistem')}</span>
        <span class="spacer"></span><span class="tiny muted">${esc(timeAgo(report.created_at))}</span></div>
      <div class="row"><button class="btn btn-xs" data-report-read="${esc(report.id)}">Baca Laporan</button></div>
    </article>`).join('');
  list.querySelectorAll('[data-report-open], [data-report-read]').forEach((element) => {
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      openReport(element.dataset.reportOpen || element.dataset.reportRead);
    });
  });
}

async function openReport(reportId) {
  try {
    const report = await api(`/api/reports/${reportId}`);
    openModal({
      title: report.title,
      wide: true,
      body: `<div class="row" style="margin-bottom:10px">${modeBadge(report.mode)}
          <span class="badge blue">${esc(report.department || '-')}</span>
          <span class="tiny muted">${esc(fmtDate(report.created_at))}</span></div>
        <div class="report-body">${esc(report.body || '')}</div>`,
      footer: `<button class="btn btn-ghost" data-close>Tutup</button>
        <button class="btn btn-primary" id="download-report">Unduh Markdown</button>`,
      onMount: (ref) => {
        ref.footer.querySelector('#download-report').addEventListener('click', () => {
          downloadFile(`${report.title.replace(/[^\w\-]+/g, '-').toLowerCase()}.md`, report.body || '', 'text/markdown;charset=utf-8');
        });
      },
    });
  } catch (error) { toast(error.message, 'error'); }
}
/* ============================ CONNECTIONS ============================ */
function renderConnections() {
  const engines = realEngines();
  const simulation = state.engines.find((engine) => engine.type === 'simulation');
  setView(`
    ${pageHead('AI Connections', 'Hubungkan OpenCode CLI dan Hermes Agent CLI. Status mesin menentukan apakah proyek berjalan NYATA atau SIMULASI.',
      '<button class="btn" id="refresh-engines">Muat Ulang Status</button>')}
    <div class="grid grid-2">
      ${engines.map(engineCard).join('') || '<div class="empty-state" style="grid-column:1/-1">Tidak ada mesin nyata yang dikonfigurasi.</div>'}
    </div>
    ${engines.some((engine) => engine.type === 'hermes' && !isEngineConnected(engine)) ? `
      <div class="warning-box" style="margin-top:14px">
        <strong>Hermes Agent CLI belum terhubung.</strong> Pasang Hermes atau isi executable dan template argumen eksekusi.
        Tanpa konfigurasi yang benar, agen Hermes hanya dapat dipakai pada proyek SIMULASI.
      </div>` : ''}
    <div class="grid grid-2" style="margin-top:14px">
      <div class="panel">
        <div class="panel-head"><div><h3>Cara Kerja Koneksi</h3></div></div>
        <div class="info-box">
          <p><strong>OpenCode</strong> dijalankan sebagai proses lokal dengan perintah <span class="mono">opencode run --dir &lt;workdir&gt; ...</span>.
          Model dapat diatur per agen. Auto-approve hanya dipakai jika diaktifkan eksplisit.</p>
          <p style="margin-top:8px"><strong>Hermes</strong> memakai template argumen yang dapat disesuaikan dengan placeholder
          <span class="mono">{prompt}</span>, <span class="mono">{model}</span>, dan <span class="mono">{dir}</span>.
          Periksa <span class="mono">--help</span> Hermes sebelum mengisi template.</p>
          <p style="margin-top:8px">Tes koneksi menjalankan probe versi/model dan opsional prompt singkat. Log ditampilkan dengan rahasia diredaksi.</p>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h3>Mesin Simulasi</h3><div class="panel-sub">Selalu tersedia untuk demo lokal</div></div>
          ${engineBadge(simulation)}</div>
        <div class="info-box">
          Mesin simulasi menghasilkan rencana, hasil tugas, dan laporan palsu yang <strong>selalu ditandai SIMULASI</strong>.
          Mode ini tidak memanggil model AI dan tidak boleh disajikan sebagai pekerjaan nyata.
        </div>
        <div class="note-strip">Gunakan mode NYATA hanya setelah tes koneksi berhasil dan seluruh agen dalam proyek memakai mesin terhubung.</div>
      </div>
    </div>
    <div class="note-strip" style="margin-top:14px">Perubahan executable akan memvalidasi path/perintah. Aplikasi tidak menyediakan shell arbitrer; hanya mesin AI terdaftar yang dapat menjalankan proses.</div>
  `);
  document.getElementById('refresh-engines').addEventListener('click', async () => {
    try {
      await loadBootstrap();
      updateChrome();
      renderConnections();
      toast('Status mesin dimuat ulang.', 'success');
    } catch (error) { toast(error.message, 'error'); }
  });
  viewEl.querySelectorAll('[data-engine-detect]').forEach((button) => {
    button.addEventListener('click', () => detectEngine(button.dataset.engineDetect));
  });
  viewEl.querySelectorAll('[data-engine-test]').forEach((button) => {
    button.addEventListener('click', () => openEngineTest(button.dataset.engineTest));
  });
  viewEl.querySelectorAll('[data-engine-config]').forEach((button) => {
    button.addEventListener('click', () => openEngineConfig(button.dataset.engineConfig));
  });
  viewEl.querySelectorAll('[data-engine-history]').forEach((button) => {
    button.addEventListener('click', () => openEngineHistory(button.dataset.engineHistory));
  });
}

function engineCard(engine) {
  const connected = isEngineConnected(engine);
  const result = connResults.get(engine.id);
  const config = engine.config || {};
  const lastChecked = engine.last_checked ? timeAgo(engine.last_checked) : 'belum pernah';
  return `<article class="engine-card ${connected ? 'connected' : engine.status === 'Gagal tes' ? 'error' : ''}">
    <div class="engine-head">
      <div class="ei">${engine.type === 'opencode' ? '⌨️' : '⚡'}</div>
      <div class="info">
        <div class="en">${esc(engine.label)}</div>
        <div class="es">${esc(engine.type)} · ${engine.agent_count || 0} agen · terakhir diperiksa ${esc(lastChecked)}</div>
      </div>
      ${statusBadge(engine.status || 'Belum diperiksa')}
    </div>
    <div class="kv">
      <span class="k">Executable</span><span class="v mono tiny">${esc(engine.executable || 'otomatis / belum diatur')}</span>
      <span class="k">Versi</span><span class="v mono">${esc(engine.version || '-')}</span>
      <span class="k">Model</span><span class="v">${engine.models?.length ? `${engine.models.length} model terdeteksi` : 'belum terdeteksi'}</span>
      <span class="k">Timeout</span><span class="v mono">${esc(config.timeoutMs || 600000)} ms</span>
      ${engine.type === 'opencode' ? `<span class="k">Auto-approve</span><span class="v">${config.autoApprove ? 'aktif' : 'nonaktif'}</span>` : `
        <span class="k">Template run</span><span class="v mono tiny">${esc((config.runArgs || []).join(' ') || 'belum diisi')}</span>`}
    </div>
    ${engine.models?.length ? `<div class="row" style="gap:4px;margin-top:8px">${engine.models.slice(0, 5).map((model) => `<span class="tag mono">${esc(model)}</span>`).join('')}${engine.models.length > 5 ? `<span class="tiny dim">+${engine.models.length - 5}</span>` : ''}</div>` : ''}
    ${result ? `<div class="${result.ok ? 'info-box' : 'danger-box'}" style="margin-top:9px">
      <strong>${esc(result.status)}</strong> — ${esc(result.message)}
      ${result.logs ? `<details style="margin-top:6px"><summary class="tiny">Lihat log tes</summary><div class="log-box">${esc(result.logs)}</div></details>` : ''}
    </div>` : ''}
    <div class="row" style="margin-top:11px">
      <button class="btn btn-sm btn-primary" data-engine-test="${esc(engine.id)}">Uji Koneksi</button>
      <button class="btn btn-sm" data-engine-detect="${esc(engine.id)}">Deteksi</button>
      <button class="btn btn-sm" data-engine-config="${esc(engine.id)}">Konfigurasi</button>
      <button class="btn btn-sm" data-engine-history="${esc(engine.id)}">Riwayat Tes</button>
    </div>
  </article>`;
}

async function detectEngine(engineId) {
  const engine = engineById(engineId);
  if (!engine) return;
  try {
    const data = await api(`/api/engines/${engineId}/detect`, { method: 'POST' });
    await loadBootstrap();
    updateChrome();
    renderConnections();
    const found = data.detected?.executable;
    toast(found ? `Executable ditemukan: ${found}` : 'Executable tidak ditemukan otomatis.', found ? 'success' : 'warn');
  } catch (error) { toast(error.message, 'error'); }
}

function openEngineTest(engineId) {
  const engine = engineById(engineId);
  if (!engine) return;
  const defaultModel = state.agents.find((agent) => agent.engine_id === engineId && agent.model)?.model
    || engine.models?.[0] || '';
  const modelOptions = [...new Set([defaultModel, ...(engine.models || [])].filter(Boolean))];
  const ref = openModal({
    title: `Uji Koneksi — ${engine.label}`,
    wide: true,
    body: `<div class="info-box">Tes akan menjalankan probe versi dan opsional prompt singkat menggunakan executable mesin. Proses dapat memakan waktu hingga timeout konfigurasi.</div>
      <form id="engine-test-form" class="stack" style="margin-top:12px">
        <label class="field"><span>Model (opsional)</span>
          <input name="model" list="engine-test-models" value="${esc(defaultModel)}" placeholder="mis. opencode/deepseek-v4.1-flash-free">
          <datalist id="engine-test-models">${modelOptions.map((model) => `<option value="${esc(model)}">`).join('')}</datalist>
        </label>
        <label class="field"><span>Prompt tes (opsional)</span>
          <textarea name="prompt" rows="2" maxlength="500" placeholder="Kosongkan untuk hanya probe versi">Balas hanya dengan kata: SIAP</textarea>
        </label>
        <div id="engine-test-result"></div>
      </form>`,
    footer: `<button class="btn btn-ghost" data-close>Tutup</button><button class="btn btn-primary" id="engine-test-run">Jalankan Tes</button>`,
  });
  ref.footer.querySelector('#engine-test-run').addEventListener('click', async () => {
    const form = ref.modal.querySelector('#engine-test-form');
    const button = ref.footer.querySelector('#engine-test-run');
    const resultBox = ref.modal.querySelector('#engine-test-result');
    const model = form.elements.model.value.trim();
    const prompt = form.elements.prompt.value.trim();
    button.disabled = true;
    button.textContent = 'Menguji...';
    resultBox.innerHTML = '<div class="loading-block" style="padding:18px"><div class="pixel-spinner"></div><span>Menjalankan tes koneksi...</span></div>';
    try {
      const data = await api(`/api/engines/${engineId}/test`, { method: 'POST', body: { model, prompt } });
      connResults.set(engineId, data.result);
      resultBox.innerHTML = `<div class="${data.result.ok ? 'info-box' : 'danger-box'}" style="margin-top:8px">
        <strong>${esc(data.result.status)}</strong> — ${esc(data.result.message)}
        ${data.result.version ? `<div class="tiny mono" style="margin-top:4px">versi: ${esc(data.result.version)}</div>` : ''}
        ${data.result.logs ? `<details style="margin-top:8px"><summary class="tiny">Log lengkap</summary><div class="log-box">${esc(data.result.logs)}</div></details>` : ''}
        ${data.result.help ? `<details style="margin-top:6px"><summary class="tiny">Bantuan executable</summary><div class="log-box">${esc(data.result.help)}</div></details>` : ''}
      </div>`;
      await loadBootstrap();
      updateChrome();
      renderConnections();
      button.textContent = 'Tes Lagi';
      toast(data.result.ok ? 'Koneksi berhasil diuji.' : `Tes selesai: ${data.result.status}`, data.result.ok ? 'success' : 'warn');
    } catch (error) {
      resultBox.innerHTML = `<div class="danger-box" style="margin-top:8px">${esc(error.message)}</div>`;
      button.textContent = 'Coba Lagi';
      toast(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  });
}

function openEngineConfig(engineId) {
  const engine = engineById(engineId);
  if (!engine) return;
  const config = engine.config || {};
  const opencodeFields = `
    <label class="field"><span>Timeout (ms)</span><input name="timeoutMs" type="number" min="10000" max="3600000" value="${esc(config.timeoutMs || 600000)}"></label>
    <label class="field span-2 checkbox-field"><span>Mode otomatis</span>
      <label class="row tiny"><input type="checkbox" name="autoApprove" ${config.autoApprove ? 'checked' : ''}> Aktifkan auto-approve OpenCode (hanya jika didukung)</label>
    </label>
    <label class="field span-2"><span>Argumen tambahan (satu per baris)</span><textarea name="extraArgs" rows="3">${esc((config.extraArgs || []).join('\n'))}</textarea></label>`;
  const hermesFields = `
    <label class="field"><span>Timeout (ms)</span><input name="timeoutMs" type="number" min="10000" max="3600000" value="${esc(config.timeoutMs || 600000)}"></label>
    <label class="field"><span>Argumen versi</span><input name="versionArgs" value="${esc((config.versionArgs || ['--version']).join(' '))}"></label>
    <label class="field"><span>Argumen bantuan</span><input name="helpArgs" value="${esc((config.helpArgs || ['--help']).join(' '))}"></label>
    <label class="field span-2"><span>Argumen eksekusi (satu per baris, placeholder {prompt} {model} {dir})</span>
      <textarea name="runArgs" rows="4" placeholder="run&#10;--prompt&#10;{prompt}">${esc((config.runArgs || []).join('\n'))}</textarea></label>
    <label class="field"><span>Flag model</span><input name="modelFlag" value="${esc(config.modelFlag || '')}" placeholder="mis. --model"></label>
    <label class="field"><span>Flag direktori</span><input name="dirFlag" value="${esc(config.dirFlag || '')}" placeholder="mis. --dir"></label>
    <label class="field"><span>Flag auto-approve</span><input name="autoApproveFlag" value="${esc(config.autoApproveFlag || '')}" placeholder="mis. --yes"></label>
    <label class="field"><span>Argumen tambahan</span><input name="extraArgs" value="${esc((config.extraArgs || []).join(' '))}"></label>`;
  const ref = openModal({
    title: `Konfigurasi — ${engine.label}`,
    wide: true,
    body: `<form id="engine-config-form" class="form-grid">
      <label class="field"><span>Nama mesin</span><input name="label" required maxlength="60" value="${esc(engine.label)}"></label>
      <label class="field"><span>Executable</span><input name="executable" maxlength="500" value="${esc(engine.executable || '')}" placeholder="otomatis / path lengkap"></label>
      ${engine.type === 'opencode' ? opencodeFields : hermesFields}
      <label class="field span-2"><span>Daftar model (satu per baris; dapat diperbarui otomatis oleh tes)</span>
        <textarea name="models" rows="4">${esc((engine.models || []).join('\n'))}</textarea></label>
      <div class="note-strip span-2">Argumen dijalankan tanpa shell. Jangan menambahkan karakter berbahaya. Setelah menyimpan, lakukan tes koneksi.</div>
    </form>`,
    footer: `<button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-primary" id="engine-config-save">Simpan Konfigurasi</button>`,
  });
  ref.footer.querySelector('#engine-config-save').addEventListener('click', async () => {
    const form = ref.modal.querySelector('#engine-config-form');
    if (!form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form).entries());
    const lines = (value) => String(value || '').split('\n').map((line) => line.trim()).filter(Boolean);
    const words = (value) => String(value || '').trim().split(/\s+/).filter(Boolean);
    const config = { timeoutMs: Number(values.timeoutMs || 600000) };
    if (engine.type === 'opencode') {
      config.autoApprove = form.elements.autoApprove.checked;
      config.extraArgs = lines(values.extraArgs);
    } else {
      config.versionArgs = words(values.versionArgs);
      config.helpArgs = words(values.helpArgs);
      config.runArgs = lines(values.runArgs);
      config.modelFlag = values.modelFlag || '';
      config.dirFlag = values.dirFlag || '';
      config.autoApproveFlag = values.autoApproveFlag || '';
      config.extraArgs = words(values.extraArgs);
      config.models = lines(values.models);
    }
    const button = ref.footer.querySelector('#engine-config-save');
    button.disabled = true;
    try {
      await api(`/api/engines/${engine.id}`, { method: 'PATCH', body: {
        label: values.label, executable: values.executable, config, models: lines(values.models),
      } });
      ref.close();
      await loadBootstrap();
      updateChrome();
      renderConnections();
      toast('Konfigurasi mesin disimpan. Lakukan tes koneksi.', 'success');
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
    }
  });
}

async function openEngineHistory(engineId) {
  const engine = engineById(engineId);
  if (!engine) return;
  try {
    const tests = await api(`/api/engines/${engineId}/tests`);
    openModal({
      title: `Riwayat Tes — ${engine.label}`,
      wide: true,
      body: tests.length ? `<div class="stack">${tests.map((test) => `
        <div class="panel tight">
          <div class="row" style="justify-content:space-between"><div class="row">${statusBadge(test.status)}
            <span class="tiny muted">${esc(fmtDate(test.created_at))}</span></div>
            <span class="badge ${test.ok ? 'green' : 'red'}">${test.ok ? 'OK' : 'GAGAL'}</span></div>
          <div class="small" style="margin-top:6px">${esc(test.message)}</div>
          ${test.logs ? `<details style="margin-top:6px"><summary class="tiny">Log</summary><div class="log-box">${esc(test.logs)}</div></details>` : ''}
        </div>`).join('')}</div>` : '<div class="empty-state">Belum ada riwayat tes.</div>',
      footer: '<button class="btn btn-ghost" data-close>Tutup</button>',
    });
  } catch (error) { toast(error.message, 'error'); }
}
/* ============================ SETTINGS ============================ */
function renderSettings() {
  const company = state.company || {};
  const settings = state.settings || {};
  setView(`
    ${pageHead('Settings', 'Profil perusahaan, preferensi operasional, dan pengelolaan data lokal.',
      '<button class="btn" data-go="#/connections">Status Mesin</button>')}
    <div class="grid grid-2">
      <div class="panel">
        <div class="panel-head"><div><h3>Profil Perusahaan</h3><div class="panel-sub">Tampil pada dashboard dan kantor virtual</div></div></div>
        <form id="company-form" class="form-grid">
          <label class="field"><span>Nama perusahaan</span><input name="name" required maxlength="80" value="${esc(company.name || '')}"></label>
          <label class="field"><span>Avatar perusahaan</span><input name="avatar" required maxlength="8" value="${esc(company.avatar || '🏢')}"></label>
          <label class="field"><span>Nama CEO</span><input name="ceo_name" required maxlength="80" value="${esc(company.ceo_name || '')}"></label>
          <label class="field"><span>Avatar CEO</span><input name="ceo_avatar" required maxlength="8" value="${esc(company.ceo_avatar || '👑')}"></label>
          <label class="field span-2"><span>Tagline</span><input name="tagline" maxlength="160" value="${esc(company.tagline || '')}"></label>
          <label class="field span-2"><span>Profil perusahaan</span><textarea name="description" rows="3" maxlength="2000">${esc(company.description || '')}</textarea></label>
          <label class="field span-2"><span>Saldo penggunaan model (teks bebas, bukan rahasia)</span><input name="model_balance" maxlength="80" value="${esc(company.model_balance || '')}" placeholder="contoh: 72% tersisa"></label>
          <div class="row span-2"><button class="btn btn-primary" type="submit">Simpan Profil</button></div>
        </form>
      </div>
      <div class="stack">
        <div class="panel">
          <div class="panel-head"><div><h3>Preferensi Operasional</h3><div class="panel-sub">Perubahan berlaku pada eksekusi berikutnya</div></div></div>
          <form id="settings-form" class="form-grid">
            <label class="field"><span>Tema</span><select name="theme">
              <option value="dark" ${settings.theme !== 'light' ? 'selected' : ''}>Gelap (pixel dark)</option>
              <option value="light" ${settings.theme === 'light' ? 'selected' : ''}>Terang</option>
            </select></label>
            <label class="field"><span>Mode default proyek</span><select name="defaultMode">
              <option value="auto" ${settings.defaultMode === 'auto' || !settings.defaultMode ? 'selected' : ''}>Otomatis</option>
              <option value="nyata" ${settings.defaultMode === 'nyata' ? 'selected' : ''}>Wajib NYATA</option>
              <option value="simulasi" ${settings.defaultMode === 'simulasi' ? 'selected' : ''}>SIMULASI</option>
            </select></label>
            <label class="field"><span>Batas proses paralel (1-5)</span><input name="concurrency" type="number" min="1" max="5" value="${esc(settings.concurrency || 2)}"></label>
            <label class="field"><span>Batas waktu tugas (ms)</span><input name="taskTimeoutMs" type="number" min="10000" max="3600000" step="1000" value="${esc(settings.taskTimeoutMs || 600000)}"></label>
            <label class="field"><span>Suara kantor</span><select name="officeSound">
              <option value="off" ${settings.officeSound !== 'on' ? 'selected' : ''}>Nonaktif</option>
              <option value="on" ${settings.officeSound === 'on' ? 'selected' : ''}>Aktif</option>
            </select></label>
            <div class="row" style="align-items:flex-end"><button class="btn btn-primary" type="submit">Simpan Preferensi</button></div>
          </form>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h3>Informasi Runtime</h3></div><span class="badge gray">lokal</span></div>
          <div class="kv">
            <span class="k">Workspace</span><span class="v mono tiny">${esc(state.workspaceRoot || '-')}</span>
            <span class="k">Database</span><span class="v mono tiny">data/pixel-office.db (SQLite)</span>
            <span class="k">Server</span><span class="v mono tiny">http://127.0.0.1:3000</span>
            <span class="k">Realtime</span><span class="v">${state.connection === 'online' ? statusBadge('Terhubung') : '<span class="badge red">Terputus</span>'}</span>
            <span class="k">Agen</span><span class="v">${state.agents.length} terdaftar · ${state.agents.filter((agent) => agent.active).length} aktif</span>
            <span class="k">Proyek</span><span class="v">${state.projects.length} terbaru dimuat</span>
          </div>
        </div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:14px">
      <div class="panel">
        <div class="panel-head"><div><h3>Backup Data</h3><div class="panel-sub">Ekspor seluruh tabel SQLite ke JSON</div></div></div>
        <div class="info-box">Backup mencakup pengaturan, perusahaan, mesin, agen, proyek, tugas, delegasi, eksekusi, log, laporan, rapat, aktivitas, persetujuan, dan riwayat tes mesin.</div>
        <div class="row" style="margin-top:10px">
          <button class="btn btn-primary" id="backup-download">Unduh Backup JSON</button>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h3>Pulihkan Data</h3><div class="panel-sub">Mengganti seluruh data dengan isi backup</div></div></div>
        <div class="warning-box">Restore akan menghapus data saat ini dan menggantinya. Hentikan semua eksekusi sebelum memulihkan. Tindakan ini tidak dapat dibatalkan.</div>
        <div class="row" style="margin-top:10px">
          <input type="file" id="restore-file" accept="application/json,.json">
          <button class="btn btn-danger" id="restore-run" disabled>Pulihkan</button>
        </div>
      </div>
    </div>
    <div class="note-strip" style="margin-top:14px">
      <strong>Keamanan:</strong> aplikasi berjalan lokal, tidak menyimpan API key, dan meredaksi pola rahasia pada log.
      Jangan menjalankan server pada jaringan publik tanpa autentikasi tambahan.
    </div>
  `);
  bindGoButtons(viewEl);
  document.getElementById('company-form').addEventListener('submit', saveCompany);
  document.getElementById('settings-form').addEventListener('submit', saveSettings);
  document.getElementById('backup-download').addEventListener('click', () => {
    const link = document.createElement('a');
    link.href = '/api/backup';
    link.download = 'pixel-office-backup.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
  });
  const restoreInput = document.getElementById('restore-file');
  const restoreButton = document.getElementById('restore-run');
  let restoreData = null;
  restoreInput.addEventListener('change', async () => {
    restoreData = null;
    restoreButton.disabled = true;
    const file = restoreInput.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { toast('Berkas backup terlalu besar (maks 25 MB).', 'error'); return; }
    try {
      restoreData = JSON.parse(await file.text());
      restoreButton.disabled = false;
      toast('Berkas backup valid. Periksa peringatan sebelum memulihkan.', 'info');
    } catch { toast('Berkas bukan JSON yang valid.', 'error'); }
  });
  restoreButton.addEventListener('click', async () => {
    if (!restoreData) return;
    const confirmed = await confirmDialog({
      title: 'Pulihkan Data',
      message: 'Seluruh data saat ini akan diganti dengan isi backup. Tindakan ini tidak dapat dibatalkan. Lanjutkan?',
      confirmLabel: 'Pulihkan Sekarang', danger: true,
    });
    if (!confirmed) return;
    try {
      await api('/api/restore', { method: 'POST', body: restoreData });
      toast('Data berhasil dipulihkan. Memuat ulang...', 'success');
      setTimeout(() => window.location.reload(), 800);
    } catch (error) { toast(error.message, 'error'); }
  });
}

async function saveCompany(event) {
  event.preventDefault();
  const form = event.target;
  const values = Object.fromEntries(new FormData(form).entries());
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api('/api/company', { method: 'PATCH', body: values });
    await loadBootstrap();
    updateChrome();
    toast('Profil perusahaan disimpan.', 'success');
    renderSettings();
  } catch (error) {
    toast(error.message, 'error');
    button.disabled = false;
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const form = event.target;
  const values = Object.fromEntries(new FormData(form).entries());
  const body = {
    theme: values.theme,
    defaultMode: values.defaultMode,
    concurrency: Number(values.concurrency),
    taskTimeoutMs: Number(values.taskTimeoutMs),
    officeSound: values.officeSound,
  };
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api('/api/settings', { method: 'PATCH', body });
    await loadBootstrap();
    applyTheme();
    updateChrome();
    toast('Preferensi disimpan.', 'success');
    renderSettings();
  } catch (error) {
    toast(error.message, 'error');
    button.disabled = false;
  }
}

/* ============================ BOOT ============================ */
main();
