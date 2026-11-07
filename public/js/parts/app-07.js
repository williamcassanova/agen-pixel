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
