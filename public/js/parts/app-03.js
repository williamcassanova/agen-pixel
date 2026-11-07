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
            <strong>Mode otomatis:</strong> proyek dijalankan NYATA jika mesin sekretaris terhubung. Jika ada agen yang mesinnya belum terhubung,
            proyek akan gagal di tahap preflight agar tidak mencampur simulasi dengan eksekusi nyata. Pilih SIMULASI untuk demo aman.
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
