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
