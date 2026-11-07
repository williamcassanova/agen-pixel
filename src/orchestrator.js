import path from 'node:path';
import {
  getAgent, getEngine, getSetting, listAgents, logActivity, now, uid, updateAgentStatus, safeJson,
  agentWorkdir,
} from './db.js';
import { isEngineConnected } from './adapters/index.js';
import { STATUS } from './config.js';
import { bus } from './events.js';
import {
  simulatePlan, simulateReport, simulateMeetingSummary, SIMULATION_LABEL,
} from './simulation.js';

const VALID_DEPARTMENTS = ['Development', 'Research', 'Design', 'Quality Assurance', 'Marketing', 'Operasional'];

export class Orchestrator {
  constructor(db, manager) {
    this.db = db;
    this.manager = manager;
    this.projectsRunning = new Set();
  }

  get secretary() {
    return this.db.prepare("SELECT * FROM agents WHERE role = 'Secretary AI' AND active = 1 LIMIT 1").get()
      || this.db.prepare('SELECT * FROM agents WHERE active = 1 LIMIT 1').get();
  }

  broadcastProject(projectId) {
    const project = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    if (project) bus.broadcast('project.update', project);
    return project;
  }

  broadcastTask(taskId) {
    const task = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!task) return null;
    const enriched = this.taskDetail(task.id);
    bus.broadcast('task.update', enriched);
    return enriched;
  }

  taskDetail(taskId) {
    const task = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!task) return null;
    const assignee = task.assignee_id ? getAgent(this.db, task.assignee_id) : null;
    const assignedBy = task.assigned_by ? getAgent(this.db, task.assigned_by) : null;
    const execution = task.execution_id
      ? this.db.prepare('SELECT * FROM executions WHERE id = ?').get(task.execution_id)
      : null;
    return {
      ...task,
      assignee_name: assignee?.name || '',
      assignee_role: assignee?.role || '',
      assigned_by_name: assignedBy?.name || '',
      execution: execution ? this.publicExecution(execution) : null,
    };
  }

  publicExecution(exec) {
    return {
      id: exec.id,
      status: exec.status,
      engine_type: exec.engine_type,
      model: exec.model,
      simulation: Boolean(exec.simulation),
      exit_code: exec.exit_code,
      error: exec.error,
      started_at: exec.started_at,
      ended_at: exec.ended_at,
      pid: exec.pid,
    };
  }

  createCommand({ instruction, mode = 'auto', engineId = null, title = '' }) {
    const secretary = this.secretary;
    if (!secretary) throw new Error('Secretary AI tidak tersedia. Tambahkan agen terlebih dahulu.');
    const requestedMode = ['auto', 'nyata', 'simulasi'].includes(mode) ? mode : 'auto';
    const planningEngine = engineId ? getEngine(this.db, engineId) : getEngine(this.db, secretary.engine_id);
    if (!planningEngine) throw new Error('Mesin AI untuk sekretaris tidak ditemukan.');
    const connected = isEngineConnected(planningEngine);
    let projectMode;
    if (requestedMode === 'simulasi') projectMode = SIMULATION_LABEL;
    else if (requestedMode === 'nyata' || requestedMode === 'auto') projectMode = connected ? 'NYATA' : SIMULATION_LABEL;
    if (requestedMode === 'nyata' && !connected) {
      throw new Error(`Mesin ${planningEngine.label} belum terhubung. Uji koneksi di AI Connections atau pilih mode simulasi.`);
    }
    const id = uid('prj');
    const ts = now();
    const finalTitle = (title && title.trim()) || makeTitle(instruction);
    this.db.prepare(`INSERT INTO projects
      (id,title,instruction,mode,status,planning_engine_id,summary,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      id, finalTitle, instruction, projectMode, STATUS.PLANNED, planningEngine.id, '', ts, ts,
    );
    logActivity(this.db, secretary.id, 'proyek',
      `${projectMode === SIMULATION_LABEL ? '[SIMULASI] ' : ''}Instruksi CEO diterima: "${finalTitle}".`, { projectId: id });
    bus.broadcast('activity', { message: `Instruksi baru dari CEO: ${finalTitle}` });
    this.broadcastProject(id);
    setImmediate(() => {
      this.runProject(id, { secretary, planningEngine }).catch((error) => {
        this.failProject(id, error.message || 'Terjadi kesalahan internal.');
      });
    });
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  }

  async runProject(projectId, { secretary = null, planningEngine = null } = {}) {
    if (this.projectsRunning.has(projectId)) return;
    this.projectsRunning.add(projectId);
    try {
      const project = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
      if (!project) return;
      secretary = secretary || this.secretary;
      const company = this.db.prepare('SELECT * FROM company WHERE id = 1').get();
      const isSimulation = project.mode === SIMULATION_LABEL;
      planningEngine = planningEngine
        || getEngine(this.db, project.planning_engine_id)
        || getEngine(this.db, secretary.engine_id)
        || getEngine(this.db, 'engine-simulation');

      if (!isSimulation && !isEngineConnected(planningEngine)) {
        throw new Error(`Mesin perencanaan ${planningEngine.label} tidak terhubung.`);
      }

      const planningTask = this.createTask({
        projectId,
        title: 'Penyusunan rencana oleh sekretaris',
        description: `Analisis instruksi CEO dan susun rencana delegasi untuk: "${project.instruction}"`,
        department: 'Operasional',
        assigneeId: secretary.id,
        assignedBy: secretary.id,
        kind: 'planning',
        priority: 'Tinggi',
      });
      this.setTaskStatus(planningTask.id, STATUS.WORKING, { started_at: now() });
      this.setStateAgent(secretary.id, 'Bekerja');

      let planMeta = { source: 'lokal', warning: '' };
      let units;
      if (isSimulation) {
        const simulationEngine = getEngine(this.db, 'engine-simulation');
        const { executionId, done } = this.manager.run({
          taskId: planningTask.id,
          agentId: secretary.id,
          engineId: simulationEngine.id,
          model: '',
          workdir: agentWorkdir(secretary, projectId, planningTask.id),
          prompt: `[SIMULASI] Susun rencana untuk instruksi: ${project.instruction}`,
          simulation: true,
        });
        this.linkExecution(planningTask.id, executionId);
        await done;
        units = simulatePlan(project.instruction);
        planMeta = { source: SIMULATION_LABEL, warning: 'Perencanaan dijalankan dalam mode simulasi.' };
      } else {
        const prompt = this.planningPrompt(company, secretary, project);
        const { executionId, done } = this.manager.run({
          taskId: planningTask.id,
          agentId: secretary.id,
          engineId: planningEngine.id,
          model: secretary.model || '',
          workdir: agentWorkdir(secretary, projectId, planningTask.id),
          prompt,
          simulation: false,
        });
        this.linkExecution(planningTask.id, executionId);
        const execution = await done;
        if (execution.status === 'Sukses' && execution.output) {
          const parsed = parsePlan(execution.output);
          if (parsed && parsed.length) {
            units = parsed;
            planMeta = { source: 'AI', warning: '' };
          } else {
            units = simulatePlan(project.instruction);
            planMeta = {
              source: 'lokal',
              warning: 'Keluaran rencana AI tidak dapat diparse sebagai JSON. Rencana lokal digunakan; eksekusi tugas tetap menggunakan mesin AI nyata.',
            };
          }
        } else {
          units = simulatePlan(project.instruction);
          planMeta = {
            source: 'lokal',
            warning: `Eksekusi perencanaan AI ${execution.status.toLowerCase()}. Rencana lokal digunakan; eksekusi tugas tetap menggunakan mesin AI nyata.`,
          };
        }
      }

      if (this.projectCancelled(projectId)) return;
      units = normalizePlan(units, project.instruction);
      if (!this.hasReviewUnit(units)) {
        units.push({
          title: 'Pemeriksaan hasil dan kualitas',
          description: 'Periksa hasil seluruh divisi, catat risiko, dan rekomendasikan perbaikan sebelum laporan ke CEO.',
          department: 'Quality Assurance',
          roleHint: 'Tester',
          priority: 'Tinggi',
        });
      }

      this.db.prepare('UPDATE tasks SET status = ?, result = ?, completed_at = ?, updated_at = ? WHERE id = ?').run(
        STATUS.DONE,
        `Rencana ${units.length} tugas dibuat (sumber: ${planMeta.source}).${planMeta.warning ? ` ${planMeta.warning}` : ''}`,
        now(), now(), planningTask.id,
      );
      this.broadcastTask(planningTask.id);
      this.setStateAgent(secretary.id, 'Idle');

      const created = this.persistPlan(project, units, secretary);
      const allTasks = created.tasks;

      if (!isSimulation) {
        const disconnected = allTasks
          .filter((task) => task.kind !== 'planning')
          .map((task) => getAgent(this.db, task.assignee_id))
          .filter(Boolean)
          .filter((agent) => !isEngineConnected(getEngine(this.db, agent.engine_id)));
        if (disconnected.length) {
          const unique = [...new Map(disconnected.map((agent) => [agent.id, agent])).values()];
          planMeta.warning = [
            planMeta.warning,
            'Sebagian tugas tidak dapat dijalankan karena mesin agen belum terhubung: '
              + unique.map((agent) => `${agent.name} (${agent.role})`).join(', ')
              + '. Tugas tersebut akan ditandai gagal tanpa simulasi.',
          ].filter(Boolean).join(' ');
          logActivity(this.db, secretary.id, 'peringatan',
            `Peringatan mesin belum terhubung: ${unique.map((agent) => agent.name).join(', ')}.`,
            { projectId });
        }
      }

      const workTasks = allTasks.filter((task) => task.kind === 'kerja');
      this.db.prepare('UPDATE projects SET status = ?, summary = ?, updated_at = ? WHERE id = ?').run(
        STATUS.WORKING,
        planMeta.warning ? `Rencana dibuat. ${planMeta.warning}` : 'Rencana dibuat. Eksekusi tugas dimulai.',
        now(), projectId,
      );
      this.broadcastProject(projectId);
      logActivity(this.db, secretary.id, 'delegasi',
        `${isSimulation ? '[SIMULASI] ' : ''}Sekretaris mendelegasikan ${workTasks.length} tugas ke divisi terkait.`,
        { projectId });

      const results = await Promise.all(workTasks.map((task) => this.runTask(project, task)));
      if (this.projectCancelled(projectId)) return;

      const reviewTasks = allTasks.filter((task) => task.kind === 'review');
      const reviewResults = [];
      for (const task of reviewTasks) {
        reviewResults.push(await this.runTask(project, task, results));
        if (this.projectCancelled(projectId)) return;
      }

      const allResults = [...results, ...reviewResults];
      const succeeded = allResults.filter((item) => item.status === 'Sukses');
      const failed = allResults.filter((item) => item.status === 'Gagal');

      for (const task of allTasks) {
        if (task.kind === 'planning') continue;
        const current = this.db.prepare('SELECT status FROM tasks WHERE id = ?').get(task.id);
        if (!current) continue;
        if ([STATUS.FAILED, STATUS.CANCELLED].includes(current.status)) continue;
        this.setTaskStatus(task.id, STATUS.APPROVAL, {});
      }

      const report = this.createReport(project, allTasks, planMeta);
      const projectStatus = succeeded.length === 0 ? STATUS.FAILED : STATUS.APPROVAL;
      this.db.prepare('UPDATE projects SET status = ?, report_id = ?, summary = ?, updated_at = ?, completed_at = ? WHERE id = ?').run(
        projectStatus,
        report.id,
        `${succeeded.length} tugas berhasil, ${failed.length} tugas gagal. ${planMeta.warning || ''}`.trim(),
        now(), now(), projectId,
      );
      const approvalId = uid('apr');
      this.db.prepare(`INSERT INTO approvals (id,project_id,task_id,requested_by,status,note,created_at)
        VALUES (?,?,?,?,?,?,?)`).run(
        approvalId, projectId, null, secretary.id,
        projectStatus === STATUS.FAILED ? 'Menunggu (proyek gagal)' : 'Menunggu', '', now(),
      );
      this.broadcastProject(projectId);
      bus.broadcast('report.new', report);
      logActivity(this.db, secretary.id, 'laporan',
        `${isSimulation ? '[SIMULASI] ' : ''}Laporan proyek "${project.title}" siap ditinjau CEO.`,
        { projectId, reportId: report.id });
      bus.broadcast('activity', { message: `Laporan proyek "${project.title}" siap ditinjau.` });
    } finally {
      this.projectsRunning.delete(projectId);
    }
  }

  async runTask(project, task, previousResults = []) {
    if (this.projectCancelled(project.id)) {
      this.setTaskStatus(task.id, STATUS.CANCELLED, {});
      return { taskId: task.id, status: 'Dibatalkan', output: '', error: '' };
    }
    const agent = getAgent(this.db, task.assignee_id);
    if (!agent) {
      this.setTaskStatus(task.id, STATUS.FAILED, { error: 'Agen pelaksana tidak ditemukan.', completed_at: now() });
      return { taskId: task.id, status: 'Gagal', output: '', error: 'Agen pelaksana tidak ditemukan.' };
    }
    const isSimulation = project.mode === SIMULATION_LABEL;
    let engine;
    if (isSimulation) {
      engine = getEngine(this.db, 'engine-simulation');
    } else {
      engine = getEngine(this.db, agent.engine_id);
      if (!engine || !isEngineConnected(engine)) {
        const error = `Mesin ${engine?.label || '-'} untuk agen ${agent.name} belum terhubung.`;
        this.setTaskStatus(task.id, STATUS.FAILED, { error, completed_at: now() });
        this.setStateAgent(agent.id, 'Idle');
        return { taskId: task.id, status: 'Gagal', output: '', error };
      }
    }
    this.setStateAgent(agent.id, 'Bekerja');
    this.setTaskStatus(task.id, STATUS.WORKING, { started_at: now() });
    const company = this.db.prepare('SELECT * FROM company WHERE id = 1').get();
    const prompt = this.taskPrompt({ company, agent, project, task, previousResults, isSimulation });
    let handle;
    try {
      handle = this.manager.run({
        taskId: task.id,
        agentId: agent.id,
        engineId: engine.id,
        model: isSimulation ? '' : agent.model || '',
        workdir: agentWorkdir(agent, project.id, task.id),
        prompt,
        simulation: isSimulation,
      });
    } catch (error) {
      this.setTaskStatus(task.id, STATUS.FAILED, { error: error.message, completed_at: now() });
      this.setStateAgent(agent.id, 'Idle');
      return { taskId: task.id, status: 'Gagal', output: '', error: error.message };
    }
    this.linkExecution(task.id, handle.executionId);
    const execution = await handle.done;
    if (this.projectCancelled(project.id)) {
      this.setTaskStatus(task.id, STATUS.CANCELLED, {});
      return { taskId: task.id, status: 'Dibatalkan', output: execution.output || '', error: '' };
    }
    if (execution.status === 'Sukses') {
      this.setTaskStatus(task.id, STATUS.REVIEW, {
        result: execution.output || '',
        error: '',
        completed_at: null,
      });
    } else if (execution.status === 'Dibatalkan') {
      this.setTaskStatus(task.id, STATUS.CANCELLED, { error: execution.error || 'Dibatalkan.' });
    } else {
      this.setTaskStatus(task.id, STATUS.FAILED, {
        result: execution.output || '',
        error: execution.error || 'Eksekusi gagal.',
        completed_at: now(),
      });
    }
    this.setStateAgent(agent.id, 'Idle');
    return {
      taskId: task.id,
      title: task.title,
      status: execution.status,
      output: execution.output || '',
      error: execution.error || '',
    };
  }

  createTask({ projectId, title, description, department, assigneeId, assignedBy, kind = 'kerja', priority = 'Normal', parentId = null, requiresApproval = 0 }) {
    const id = uid('tsk');
    const ts = now();
    this.db.prepare(`INSERT INTO tasks
      (id,project_id,parent_id,title,description,department,assignee_id,assigned_by,status,kind,priority,requires_approval,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, projectId, parentId, title, description, department, assigneeId, assignedBy,
      STATUS.WAITING, kind, priority, requiresApproval, ts, ts,
    );
    bus.broadcast('task.new', this.taskDetail(id));
    return this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  }

  persistPlan(project, units, secretary) {
    const agents = listAgents(this.db);
    const tasks = [];
    const delegations = [];
    for (const unit of units) {
      const department = unit.department;
      const head = agents.find((agent) => agent.department === department && agent.is_head === 1)
        || agents.find((agent) => agent.department === department)
        || secretary;
      const assignee = pickAssignee(agents, department, unit.roleHint, head);
      const kind = isReviewUnit(unit) ? 'review' : 'kerja';
      const task = this.createTask({
        projectId: project.id,
        title: unit.title,
        description: unit.description,
        department,
        assigneeId: assignee.id,
        assignedBy: head.id,
        kind,
        priority: unit.priority || 'Normal',
        requiresApproval: 1,
      });
      this.recordDelegation(project.id, task.id, secretary.id, head.id,
        kind === 'review' ? 'Kepala divisi menerima tugas pemeriksaan.' : 'Kepala divisi menerima delegasi dari sekretaris.');
      if (assignee.id !== head.id) {
        this.recordDelegation(project.id, task.id, head.id, assignee.id, 'Tugas dibagikan kepada anggota divisi.');
      }
      tasks.push(task);
    }
    return { tasks };
  }

  recordDelegation(projectId, taskId, fromAgent, toAgent, note) {
    const id = uid('dlg');
    this.db.prepare(`INSERT INTO delegations (id,project_id,task_id,from_agent,to_agent,note,created_at)
      VALUES (?,?,?,?,?,?,?)`).run(id, projectId, taskId, fromAgent, toAgent, note, now());
    bus.broadcast('delegation.new', { id, projectId, taskId, fromAgent, toAgent, note });
    return id;
  }

  linkExecution(taskId, executionId) {
    this.db.prepare('UPDATE tasks SET execution_id = ?, updated_at = ? WHERE id = ?')
      .run(executionId, now(), taskId);
    this.broadcastTask(taskId);
  }

  setTaskStatus(taskId, status, patch = {}) {
    const allowed = ['result', 'error', 'started_at', 'completed_at'];
    const sets = ['status = ?', 'updated_at = ?'];
    const values = [status, now()];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        sets.push(`${key} = ?`);
        values.push(patch[key]);
      }
    }
    values.push(taskId);
    this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return this.broadcastTask(taskId);
  }

  setStateAgent(agentId, status) {
    updateAgentStatus(this.db, agentId, status);
    const agent = getAgent(this.db, agentId);
    if (agent) bus.broadcast('agent.update', agent);
  }

  projectCancelled(projectId) {
    const row = this.db.prepare('SELECT status FROM projects WHERE id = ?').get(projectId);
    return !row || [STATUS.CANCELLED, STATUS.FAILED, STATUS.DONE].includes(row.status);
  }

  planningPrompt(company, secretary, project) {
    return [
      `Anda adalah ${secretary.name}, ${secretary.role} di ${company.name}.`,
      'CEO memberikan instruksi berikut:',
      `"""${project.instruction}"""`,
      '',
      'Susun rencana delegasi yang dapat dieksekusi. Balas HANYA dengan JSON valid tanpa markdown, dengan bentuk:',
      '{"tasks":[{"title":"...","description":"...","department":"Development|Research|Design|Quality Assurance|Marketing|Operasional","roleHint":"Programmer|Researcher|UI/UX Designer|Tester|Marketing Strategist|COO","priority":"Rendah|Normal|Tinggi|Kritis"}]}',
      'Buat 2-6 tugas. Tugas terakhir wajib pemeriksaan kualitas oleh Quality Assurance. Jangan menanyakan klarifikasi; ambil asumsi wajar.',
    ].join('\n');
  }

  taskPrompt({ company, agent, project, task, previousResults, isSimulation }) {
    const prev = previousResults?.length
      ? previousResults.map((item) => `- ${item.title || item.taskId} [${item.status}]: ${(item.output || item.error || '').slice(0, 1200)}`).join('\n')
      : '(belum ada hasil sebelumnya)';
    return [
      isSimulation ? '[SIMULASI] ' : '',
      `Anda adalah ${agent.name}, ${agent.role} di divisi ${agent.department} pada perusahaan ${company.name}.`,
      `Instruksi CEO: ${project.instruction}`,
      '',
      `Tugas: ${task.title}`,
      `Deskripsi: ${task.description}`,
      '',
      'Hasil tugas sebelumnya:',
      prev,
      '',
      'Kerjakan tugas ini secara nyata dan berikan hasil yang dapat ditinjau. ' +
      'Jangan mengubah konfigurasi global OpenCode/Hermes. ' +
      'Jangan menampilkan API key, token, atau rahasia autentikasi. ' +
      'Akhiri dengan ringkasan hasil, asumsi, dan tindak lanjut.',
    ].join('\n');
  }

  createReport(project, tasks, planMeta) {
    const lines = [
      `Laporan Proyek: ${project.title}`,
      `Mode: ${project.mode}${project.mode === SIMULATION_LABEL ? ' (hasil bukan dari AI nyata)' : ''}`,
      `Tanggal: ${new Date().toLocaleString('id-ID')}`,
      '',
      'Instruksi CEO:',
      project.instruction,
      '',
      'Ringkasan:',
      `${tasks.filter((task) => task.kind !== 'planning').length} tugas didelegasikan. ` +
      `Sumber rencana: ${planMeta.source}.${planMeta.warning ? ` Catatan: ${planMeta.warning}` : ''}`,
      '',
      'Hasil per tugas:',
    ];
    for (const task of tasks) {
      const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id);
      if (!row) continue;
      const agent = row.assignee_id ? getAgent(this.db, row.assignee_id) : null;
      lines.push(`\n## ${row.title} [${row.status}]`);
      lines.push(`Divisi: ${row.department} | Pelaksana: ${agent?.name || '-'} (${agent?.role || '-'})`);
      lines.push(`Deskripsi: ${row.description}`);
      if (row.result) lines.push('Hasil:', row.result.slice(0, 1600));
      if (row.error) lines.push(`Kesalahan: ${row.error.slice(0, 800)}`);
      if (row.execution_id) {
        const exec = this.db.prepare('SELECT * FROM executions WHERE id = ?').get(row.execution_id);
        if (exec) lines.push(`Eksekusi: ${exec.engine_type} | ${exec.status} | simulasi=${exec.simulation ? 'ya' : 'tidak'} | ${exec.id}`);
      }
    }
    lines.push(
      '',
      'Catatan:',
      project.mode === SIMULATION_LABEL
        ? 'Laporan ini dibuat dalam mode SIMULASI. Tidak ada proses AI nyata yang dijalankan.'
        : 'Laporan ini dibuat dari eksekusi nyata OpenCode/Hermes yang tercatat pada tabel executions.',
      'Keputusan akhir berada pada CEO.',
    );
    const body = lines.join('\n');
    const id = uid('rpt');
    this.db.prepare(`INSERT INTO reports (id,project_id,title,body,author_id,department,mode,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      id, project.id, `Laporan: ${project.title}`, body, this.secretary?.id || null,
      'Operasional', project.mode, now(),
    );
    return this.db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
  }

  approveProject(projectId, decision, note = '') {
    const project = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    if (!project) throw new Error('Proyek tidak ditemukan.');
    if (![STATUS.APPROVAL, STATUS.FAILED].includes(project.status)) {
      throw new Error('Proyek belum berada pada tahap persetujuan.');
    }
    const status = decision === 'setuju' ? 'Disetujui' : 'Ditolak';
    this.db.prepare('UPDATE approvals SET status = ?, note = ?, decided_at = ? WHERE project_id = ? AND status LIKE ?')
      .run(status, note, now(), projectId, 'Menunggu%');
    if (status === 'Disetujui') {
      this.db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE project_id = ? AND status = ?')
        .run(STATUS.DONE, now(), projectId, STATUS.APPROVAL);
      this.db.prepare('UPDATE projects SET status = ?, summary = ?, updated_at = ? WHERE id = ?')
        .run(STATUS.DONE, 'Disetujui CEO.', now(), projectId);
    } else {
      this.db.prepare('UPDATE tasks SET status = ?, error = ?, updated_at = ? WHERE project_id = ? AND status = ?')
        .run(STATUS.FAILED, `Ditolak CEO: ${note || 'tanpa catatan'}`, now(), projectId, STATUS.APPROVAL);
      this.db.prepare('UPDATE projects SET status = ?, summary = ?, updated_at = ? WHERE id = ?')
        .run(STATUS.FAILED, `Ditolak CEO: ${note || 'tanpa catatan'}`, now(), projectId);
    }
    logActivity(this.db, 'ceo', 'persetujuan',
      `${project.mode === SIMULATION_LABEL ? '[SIMULASI] ' : ''}CEO ${status.toLowerCase()} proyek "${project.title}".`,
      { projectId, note });
    bus.broadcast('activity', { message: `CEO ${status.toLowerCase()} proyek "${project.title}".` });
    this.broadcastProject(projectId);
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  }

  cancelProject(projectId, reason = 'Dihentikan oleh CEO.') {
    const project = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    if (!project) throw new Error('Proyek tidak ditemukan.');
    if ([STATUS.DONE, STATUS.CANCELLED].includes(project.status)) {
      throw new Error('Proyek sudah selesai atau dibatalkan.');
    }
    const tasks = this.db.prepare('SELECT id FROM tasks WHERE project_id = ?').all(projectId);
    for (const task of tasks) {
      this.manager.cancelByTask(task.id, reason);
      this.db.prepare('UPDATE tasks SET status = ?, error = ?, updated_at = ? WHERE id = ? AND status NOT IN (?,?)')
        .run(STATUS.CANCELLED, reason, now(), task.id, STATUS.DONE, STATUS.FAILED);
    }
    this.db.prepare('UPDATE projects SET status = ?, summary = ?, updated_at = ? WHERE id = ?')
      .run(STATUS.CANCELLED, reason, now(), projectId);
    this.db.prepare('UPDATE agents SET status = ?, updated_at = ? WHERE status != ?').run('Idle', now(), 'Rapat');
    for (const task of tasks) bus.broadcast('task.update', this.taskDetail(task.id));
    logActivity(this.db, 'ceo', 'penghentian', `CEO menghentikan proyek "${project.title}": ${reason}`, { projectId });
    bus.broadcast('activity', { message: `Proyek "${project.title}" dihentikan.` });
    this.broadcastProject(projectId);
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  }

  cancelTask(taskId, reason = 'Tugas dihentikan oleh CEO.') {
    const task = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!task) throw new Error('Tugas tidak ditemukan.');
    if ([STATUS.DONE, STATUS.CANCELLED, STATUS.FAILED].includes(task.status)) {
      throw new Error('Tugas sudah selesai, gagal, atau dibatalkan.');
    }
    if (task.execution_id) this.manager.cancel(task.execution_id, reason);
    this.setTaskStatus(task.id, STATUS.CANCELLED, { error: reason });
    if (task.assignee_id) this.setStateAgent(task.assignee_id, 'Idle');
    logActivity(this.db, 'ceo', 'penghentian', `Tugas "${task.title}" dihentikan: ${reason}`, { taskId });
    return this.taskDetail(taskId);
  }

  failProject(projectId, message) {
    const project = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    if (!project || project.status === STATUS.CANCELLED) return;
    this.db.prepare('UPDATE projects SET status = ?, summary = ?, updated_at = ? WHERE id = ?')
      .run(STATUS.FAILED, message.slice(0, 3000), now(), projectId);
    this.db.prepare('UPDATE tasks SET status = ?, error = ?, updated_at = ? WHERE project_id = ? AND status IN (?,?)')
      .run(STATUS.FAILED, message.slice(0, 3000), now(), projectId, STATUS.WAITING, STATUS.WORKING);
    logActivity(this.db, this.secretary?.id, 'kesalahan', `Proyek "${project.title}" gagal: ${message}`, { projectId });
    bus.broadcast('activity', { message: `Proyek "${project.title}" gagal: ${message}` });
    this.broadcastProject(projectId);
  }

  createMeeting({ title, agenda, attendees, mode = 'simulasi' }) {
    const ids = attendees || [];
    const names = ids.map((id) => getAgent(this.db, id)?.name || id);
    const summary = simulateMeetingSummary(title, agenda, names);
    const id = uid('mtg');
    this.db.prepare(`INSERT INTO meetings (id,title,agenda,attendees,summary,status,mode,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      id, title, agenda, JSON.stringify(ids), summary, 'Selesai', SIMULATION_LABEL, now(),
    );
    for (const agentId of ids) {
      const agent = getAgent(this.db, agentId);
      if (agent && agent.status !== 'Bekerja' && agent.active) {
        updateAgentStatus(this.db, agentId, 'Rapat');
        bus.broadcast('agent.update', { ...agent, status: 'Rapat' });
      }
    }
    const meetingTimer = setTimeout(() => {
      for (const agentId of ids) {
        const agent = getAgent(this.db, agentId);
        if (agent && agent.status === 'Rapat') {
          updateAgentStatus(this.db, agentId, 'Idle');
          bus.broadcast('agent.update', { ...agent, status: 'Idle' });
        }
      }
    }, 60000);
    if (meetingTimer.unref) meetingTimer.unref();
    logActivity(this.db, 'ceo', 'rapat', `Rapat "${title}" dibuat (ringkasan SIMULASI).`, { meetingId: id });
    bus.broadcast('meeting.new', { id, title });
    return this.db.prepare('SELECT * FROM meetings WHERE id = ?').get(id);
  }

  hasReviewUnit(units) {
    return units.some(isReviewUnit);
  }
}

function isReviewUnit(unit) {
  return unit.department === 'Quality Assurance' && (
    /(uji|test|quality|kualitas|review|pemeriksaan|qa|bug)/i.test(unit.title)
    || /Tester|Code Reviewer|Bug Hunter/i.test(unit.roleHint || '')
  );
}

function makeTitle(instruction) {
  const cleaned = instruction.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 72) return cleaned;
  return `${cleaned.slice(0, 69).trim()}...`;
}

export function parsePlan(text) {
  if (!text) return null;
  let cleaned = String(text).trim();
  cleaned = cleaned.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (!parsed || !Array.isArray(parsed.tasks)) return null;
    return parsed.tasks;
  } catch {
    return null;
  }
}

export function normalizePlan(units, instruction) {
  if (!Array.isArray(units) || units.length === 0) return simulatePlan(instruction);
  const cleaned = units.slice(0, 8).map((unit, index) => {
    const department = VALID_DEPARTMENTS.includes(unit.department) ? unit.department : 'Development';
    return {
      title: String(unit.title || `Tugas ${index + 1}`).slice(0, 120),
      description: String(unit.description || unit.title || '').slice(0, 1200),
      department,
      roleHint: unit.roleHint ? String(unit.roleHint).slice(0, 80) : '',
      priority: ['Rendah', 'Normal', 'Tinggi', 'Kritis'].includes(unit.priority) ? unit.priority : 'Normal',
    };
  });
  return cleaned;
}

export function pickAssignee(agents, department, roleHint, head) {
  const candidates = agents.filter((agent) => agent.department === department
    && agent.level !== 'secretary' && agent.level !== 'executive');
  if (roleHint) {
    const exact = candidates.find((agent) => agent.role.toLowerCase() === roleHint.toLowerCase());
    if (exact) return exact;
    const partial = candidates.find((agent) => agent.role.toLowerCase().includes(roleHint.toLowerCase()));
    if (partial) return partial;
  }
  const staff = candidates.filter((agent) => agent.is_head !== 1);
  if (staff.length) return staff[0];
  return head || agents[0];
}
