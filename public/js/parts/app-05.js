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
