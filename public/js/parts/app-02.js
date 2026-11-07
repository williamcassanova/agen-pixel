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
