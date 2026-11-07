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
      '<button class="btn btn-primary" data-go="#/command">Instruksi Baru</button>')}
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
