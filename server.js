import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getDb, getAgent, getEngine, listAgents, listEngines, logActivity, now, safeJson, setSetting,
  getSetting, uid,
} from './src/db.js';
import { ExecutionManager } from './src/process-manager.js';
import { Orchestrator } from './src/orchestrator.js';
import { bus } from './src/events.js';
import { adapterFor, persistTestResult, isEngineConnected } from './src/adapters/index.js';
import {
  cleanString, cleanOptionalId, cleanDepartment, cleanPriority, sanitizeModel, parseExtraArgs,
  assertSafeWorkdir, ensureWorkdir, assertSafeExecutable, redactSecrets, executeSafe,
} from './src/security.js';
import {
  HOST, PORT, PUBLIC_DIR, WORKSPACE_ROOT, LIMITS, STATUS,
} from './src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const TABLE_ORDER = [
  'settings', 'company', 'engines', 'agents', 'projects', 'tasks', 'delegations',
  'executions', 'execution_logs', 'reports', 'meetings', 'activity', 'approvals', 'engine_tests',
];

export function publicEngine(row, db = null) {
  if (!row) return null;
  const engine = {
    id: row.id,
    label: row.label,
    type: row.type,
    executable: row.executable,
    status: row.status,
    version: row.version,
    models: safeJson(row.models, []),
    config: safeJson(row.config, {}),
    last_checked: row.last_checked,
    connected: isEngineConnected(row),
  };
  if (db) {
    const agents = db.prepare('SELECT COUNT(*) AS c FROM agents WHERE active = 1 AND engine_id = ?').get(row.id);
    engine.agent_count = Number(agents.c);
  }
  return engine;
}

export function serializeAgent(db, row) {
  if (!row) return null;
  const engine = getEngine(db, row.engine_id);
  const activeTasks = db.prepare('SELECT COUNT(*) AS c FROM tasks WHERE assignee_id = ? AND status IN (?,?,?)')
    .get(row.id, STATUS.WAITING, STATUS.WORKING, STATUS.REVIEW);
  const doneTasks = db.prepare('SELECT COUNT(*) AS c FROM tasks WHERE assignee_id = ? AND status = ?')
    .get(row.id, STATUS.DONE);
  return {
    ...row,
    is_head: Boolean(row.is_head),
    active: Boolean(row.active),
    engine_label: engine?.label || '-',
    engine_type: engine?.type || '-',
    engine_status: engine?.status || 'Belum terhubung',
    active_tasks: Number(activeTasks.c),
    done_tasks: Number(doneTasks.c),
  };
}

function getStats(db) {
  const count = (sql, ...args) => Number(db.prepare(sql).get(...args)?.c || 0);
  const employees = count('SELECT COUNT(*) AS c FROM agents WHERE active = 1');
  const activeTasks = count('SELECT COUNT(*) AS c FROM tasks WHERE status IN (?,?,?)', STATUS.WAITING, STATUS.WORKING, STATUS.REVIEW);
  const completedTasks = count('SELECT COUNT(*) AS c FROM tasks WHERE status = ?', STATUS.DONE);
  const failedTasks = count('SELECT COUNT(*) AS c FROM tasks WHERE status = ?', STATUS.FAILED);
  const totalProjects = count('SELECT COUNT(*) AS c FROM projects');
  const doneProjects = count('SELECT COUNT(*) AS c FROM projects WHERE status = ?', STATUS.DONE);
  const running = count("SELECT COUNT(*) AS c FROM executions WHERE status = 'Berjalan'");
  const realExecutions = count('SELECT COUNT(*) AS c FROM executions WHERE simulation = 0');
  const simulationExecutions = count('SELECT COUNT(*) AS c FROM executions WHERE simulation = 1');
  const totalExecutions = realExecutions + simulationExecutions;
  const last7 = count("SELECT COUNT(*) AS c FROM tasks WHERE status = ? AND completed_at >= datetime('now','-7 days')", STATUS.DONE);
  const departments = ['Development', 'Research', 'Design', 'Quality Assurance', 'Marketing', 'Operasional'].map((department) => {
    const agents = count('SELECT COUNT(*) AS c FROM agents WHERE active = 1 AND department = ?', department);
    const tasks = count('SELECT COUNT(*) AS c FROM tasks WHERE department = ?', department);
    const done = count('SELECT COUNT(*) AS c FROM tasks WHERE department = ? AND status = ?', department, STATUS.DONE);
    return {
      department,
      agents,
      tasks,
      done,
      productivity: tasks > 0 ? Math.round((done / tasks) * 100) : 0,
    };
  });
  const company = db.prepare('SELECT * FROM company WHERE id = 1').get();
  return {
    employees,
    activeTasks,
    completedTasks,
    failedTasks,
    totalProjects,
    doneProjects,
    runningExecutions: running,
    realExecutions,
    simulationExecutions,
    totalExecutions,
    completionRate: totalProjects > 0 ? Math.round((doneProjects / totalProjects) * 100) : 0,
    last7days: last7,
    modelBalance: company?.model_balance || 'Tidak tersedia',
    departments,
  };
}

function serializeProjectRow(db, row) {
  if (!row) return null;
  const counts = db.prepare(`SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS done,
    SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS failed
    FROM tasks WHERE project_id = ?`).get(STATUS.DONE, STATUS.FAILED, row.id);
  const report = row.report_id ? db.prepare('SELECT id,title FROM reports WHERE id = ?').get(row.report_id) : null;
  const approval = db.prepare('SELECT status FROM approvals WHERE project_id = ? ORDER BY created_at DESC LIMIT 1').get(row.id);
  const engine = row.planning_engine_id ? getEngine(db, row.planning_engine_id) : null;
  return {
    ...row,
    task_count: Number(counts.total || 0),
    done_count: Number(counts.done || 0),
    failed_count: Number(counts.failed || 0),
    report_title: report?.title || '',
    approval_status: approval?.status || '',
    planning_engine_label: engine?.label || '-',
  };
}

function projectDetail(db, orchestrator, projectId) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return null;
  const tasks = db.prepare('SELECT id FROM tasks WHERE project_id = ? ORDER BY created_at').all(projectId)
    .map((row) => orchestrator.taskDetail(row.id));
  const delegations = db.prepare(`SELECT d.*, fa.name AS from_name, fa.role AS from_role,
      ta.name AS to_name, ta.role AS to_role, t.title AS task_title
    FROM delegations d
    LEFT JOIN agents fa ON fa.id = d.from_agent
    LEFT JOIN agents ta ON ta.id = d.to_agent
    LEFT JOIN tasks t ON t.id = d.task_id
    WHERE d.project_id = ? ORDER BY d.created_at`).all(projectId);
  const executions = db.prepare(`SELECT e.* FROM executions e
    JOIN tasks t ON t.id = e.task_id WHERE t.project_id = ? ORDER BY e.started_at DESC`).all(projectId)
    .map((exec) => ({
      ...orchestrator.publicExecution(exec),
      task_title: db.prepare('SELECT title FROM tasks WHERE id = ?').get(exec.task_id)?.title || '',
      agent_name: getAgent(db, exec.agent_id)?.name || '',
    }));
  const approvals = db.prepare('SELECT * FROM approvals WHERE project_id = ? ORDER BY created_at DESC').all(projectId);
  const report = project.report_id ? db.prepare('SELECT * FROM reports WHERE id = ?').get(project.report_id) : null;
  return { ...serializeProjectRow(db, project), tasks, delegations, executions, approvals, report };
}

async function refreshEngineStatuses(db) {
  const engines = db.prepare("SELECT * FROM engines WHERE type != 'simulation'").all();
  for (const engine of engines) {
    try {
      const adapter = adapterFor(engine);
      if (!adapter) continue;
      const result = await adapter.testConnection();
      persistTestResult(db, engine.id, result);
      db.prepare(`INSERT INTO engine_tests (id,engine_id,ok,status,message,logs,created_at) VALUES (?,?,?,?,?,?,?)`)
        .run(uid('etst'), engine.id, result.ok ? 1 : 0, result.status, result.message,
          redactSecrets(result.logs || '').slice(0, 20000), now());
      bus.broadcast('engine.update', publicEngine(getEngine(db, engine.id), db));
    } catch (error) {
      db.prepare('UPDATE engines SET status = ?, updated_at = ? WHERE id = ?')
        .run('Belum terhubung', now(), engine.id);
    }
  }
}

function validateEngineConfig(type, raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const timeoutMs = Number(input.timeoutMs || 600000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 10000 || timeoutMs > 60 * 60 * 1000) {
    throw new ApiError(400, 'timeoutMs harus antara 10.000 dan 3.600.000 ms.');
  }
  const config = { timeoutMs };
  if (type === 'opencode') {
    config.autoApprove = Boolean(input.autoApprove);
    config.extraArgs = parseExtraArgs(input.extraArgs || []);
  } else if (type === 'hermes') {
    config.versionArgs = parseExtraArgs(input.versionArgs ?? ['--version']);
    config.helpArgs = parseExtraArgs(input.helpArgs ?? ['--help']);
    config.runArgs = parseExtraArgs(input.runArgs ?? []);
    const str = (value, field, max = 80) => {
      if (value === undefined || value === null) return '';
      const text = String(value).trim();
      if (text.length > max) throw new ApiError(400, `${field} terlalu panjang.`);
      if (text.includes('\0')) throw new ApiError(400, `${field} tidak valid.`);
      return text;
    };
    config.modelFlag = str(input.modelFlag, 'modelFlag');
    config.dirFlag = str(input.dirFlag, 'dirFlag');
    config.autoApproveFlag = str(input.autoApproveFlag, 'autoApproveFlag');
    config.extraArgs = parseExtraArgs(input.extraArgs || []);
    config.models = (Array.isArray(input.models) ? input.models : [])
      .slice(0, 100).map((model) => sanitizeModel(model)).filter(Boolean);
  } else {
    throw new ApiError(400, 'Tipe mesin tidak dapat dikonfigurasi.');
  }
  return config;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > LIMITS.bodyBytes) {
        reject(new ApiError(413, 'Ukuran permintaan terlalu besar.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new ApiError(400, 'JSON tidak valid.'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(data);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const target = path.resolve(PUBLIC_DIR, relative);
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + path.sep)) {
    return sendJson(res, 404, { error: 'Berkas tidak ditemukan.' });
  }
  fs.stat(target, (error, stat) => {
    if (error || !stat.isFile()) {
      if (!path.extname(relative)) {
        return serveStatic(req, res, '/');
      }
      return sendJson(res, 404, { error: 'Berkas tidak ditemukan.' });
    }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(target).pipe(res);
  });
}

function createRouteHandler({ db, manager, orchestrator }) {
  return async function handleApi(req, res, url) {
    const { pathname, searchParams } = url;
    const method = req.method || 'GET';
    const route = `${method} ${pathname}`;
    const parts = pathname.split('/').filter(Boolean);

    if (route === 'GET /api/health') {
      return sendJson(res, 200, {
        ok: true, name: 'Pixel Office AI', time: now(),
        executions_aktif: manager.activeCount,
        antrean: manager.queue.length,
      });
    }

    if (route === 'GET /api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`data: ${JSON.stringify({ type: 'connected', payload: { at: now() } })}\n\n`);
      for (const event of bus.recent(10)) res.write(`data: ${JSON.stringify(event)}\n\n`);
      const remove = bus.addClient(res);
      const ping = setInterval(() => {
        try { res.write(': ping\n\n'); } catch { /* ignore */ }
      }, 25000);
      req.on('close', () => { clearInterval(ping); remove(); });
      return;
    }

    if (route === 'GET /api/bootstrap') {
      const company = db.prepare('SELECT * FROM company WHERE id = 1').get();
      const settings = Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map((row) => [row.key, row.value]));
      const agents = listAgents(db).map((agent) => serializeAgent(db, agent));
      const engines = listEngines(db).map((engine) => publicEngine(engine, db));
      const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC LIMIT 30').all()
        .map((project) => serializeProjectRow(db, project));
      const tasks = db.prepare(`SELECT t.*, a.name AS assignee_name, a.role AS assignee_role,
          p.title AS project_title, e.status AS execution_status, e.simulation AS execution_simulation
        FROM tasks t LEFT JOIN agents a ON a.id = t.assignee_id
        LEFT JOIN projects p ON p.id = t.project_id
        LEFT JOIN executions e ON e.id = t.execution_id
        ORDER BY t.created_at DESC LIMIT 200`).all();
      const reports = db.prepare('SELECT id,project_id,title,author_id,department,mode,created_at FROM reports ORDER BY created_at DESC LIMIT 30').all();
      const meetings = db.prepare('SELECT * FROM meetings ORDER BY created_at DESC LIMIT 30').all();
      const activity = db.prepare(`SELECT ac.*, a.name AS actor_name FROM activity ac
        LEFT JOIN agents a ON a.id = ac.actor_id ORDER BY ac.created_at DESC LIMIT 50`).all()
        .map((row) => ({ ...row, meta: safeJson(row.meta, {}) }));
      return sendJson(res, 200, {
        company,
        settings,
        agents,
        engines,
        projects,
        tasks,
        reports,
        meetings,
        activity,
        stats: getStats(db),
        departments: getStats(db).departments,
        workspace_root: WORKSPACE_ROOT,
      });
    }

    if (route === 'GET /api/stats') return sendJson(res, 200, getStats(db));

    if (route === 'GET /api/activity') {
      const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit') || 50)));
      const rows = db.prepare(`SELECT ac.*, a.name AS actor_name FROM activity ac
        LEFT JOIN agents a ON a.id = ac.actor_id ORDER BY ac.created_at DESC LIMIT ?`).all(limit)
        .map((row) => ({ ...row, meta: safeJson(row.meta, {}) }));
      return sendJson(res, 200, rows);
    }

    if (route === 'GET /api/agents') {
      const rows = listAgents(db, { activeOnly: searchParams.get('all') !== '1' })
        .map((agent) => serializeAgent(db, agent));
      return sendJson(res, 200, rows);
    }

    if (route === 'POST /api/agents') {
      const body = await readBody(req);
      const name = cleanString(body.name, { min: 2, max: LIMITS.nameLength, field: 'Nama agen', required: true });
      const role = cleanString(body.role, { min: 2, max: 80, field: 'Jabatan', required: true });
      const department = cleanDepartment(body.department);
      const level = ['head', 'staff', 'executive', 'secretary'].includes(body.level) ? body.level : 'staff';
      const personality = cleanString(body.personality || '', { max: 400, field: 'Kepribadian' });
      const avatar = cleanString(body.avatar || '🧑‍💻', { min: 1, max: 8, field: 'Avatar', required: true });
      const engineId = cleanOptionalId(body.engine_id || body.engineId, 'Mesin AI') || 'engine-simulation';
      const engine = getEngine(db, engineId);
      if (!engine) throw new ApiError(400, 'Mesin AI tidak ditemukan.');
      const model = sanitizeModel(body.model || '');
      const workdir = body.workdir
        ? ensureWorkdir(cleanString(body.workdir, { max: 500, field: 'Direktori kerja' }), WORKSPACE_ROOT)
        : ensureWorkdir(path.join(WORKSPACE_ROOT, department.toLowerCase().replace(/[^a-z]+/g, '-')), WORKSPACE_ROOT);
      const isHead = level === 'head' ? 1 : 0;
      if (isHead) db.prepare('UPDATE agents SET is_head = 0 WHERE department = ?').run(department);
      const id = uid('agt');
      const ts = now();
      db.prepare(`INSERT INTO agents (id,name,role,department,level,personality,avatar,engine_id,model,workdir,status,is_head,active,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`).run(
        id, name, role, department, level, personality, avatar, engineId, model, workdir, 'Idle', isHead, ts, ts,
      );
      if (isHead) {
        db.prepare('UPDATE agents SET level = ? WHERE id = ? AND level != ?').run('head', id, 'secretary');
      }
      logActivity(db, 'ceo', 'karyawan', `CEO merekrut ${name} sebagai ${role} (${department}).`, { agentId: id });
      bus.broadcast('agent.new', serializeAgent(db, getAgent(db, id)));
      bus.broadcast('activity', { message: `Agen baru direkrut: ${name} — ${role}.` });
      return sendJson(res, 201, serializeAgent(db, getAgent(db, id)));
    }

    if (parts[0] === 'api' && parts[1] === 'agents' && parts[2] && method === 'PATCH') {
      const agent = getAgent(db, parts[2]);
      if (!agent) throw new ApiError(404, 'Agen tidak ditemukan.');
      const body = await readBody(req);
      const fields = {};
      if (body.name !== undefined) fields.name = cleanString(body.name, { min: 2, max: LIMITS.nameLength, field: 'Nama agen', required: true });
      if (body.role !== undefined) fields.role = cleanString(body.role, { min: 2, max: 80, field: 'Jabatan', required: true });
      if (body.department !== undefined) {
        fields.department = cleanDepartment(body.department);
        if (agent.is_head) db.prepare('UPDATE agents SET is_head = 0 WHERE department = ?').run(fields.department);
      }
      if (body.personality !== undefined) fields.personality = cleanString(body.personality, { max: 400, field: 'Kepribadian' });
      if (body.avatar !== undefined) fields.avatar = cleanString(body.avatar, { min: 1, max: 8, field: 'Avatar', required: true });
      if (body.engine_id !== undefined || body.engineId !== undefined) {
        const engineId = cleanOptionalId(body.engine_id ?? body.engineId, 'Mesin AI');
        if (!getEngine(db, engineId)) throw new ApiError(400, 'Mesin AI tidak ditemukan.');
        fields.engine_id = engineId;
      }
      if (body.model !== undefined) fields.model = sanitizeModel(body.model);
      if (body.workdir !== undefined && body.workdir !== '') {
        fields.workdir = ensureWorkdir(cleanString(body.workdir, { max: 500, field: 'Direktori kerja' }), WORKSPACE_ROOT);
      }
      if (body.level !== undefined) {
        if (!['head', 'staff', 'executive', 'secretary'].includes(body.level)) throw new ApiError(400, 'Level agen tidak valid.');
        fields.level = body.level;
        fields.is_head = body.level === 'head' ? 1 : 0;
        if (fields.is_head) {
          const dept = fields.department || agent.department;
          db.prepare('UPDATE agents SET is_head = 0 WHERE department = ? AND id != ?').run(dept, agent.id);
        }
      }
      if (body.active !== undefined) fields.active = body.active ? 1 : 0;
      if (!Object.keys(fields).length) throw new ApiError(400, 'Tidak ada perubahan.');
      fields.updated_at = now();
      const sets = Object.keys(fields).map((key) => `${key} = ?`).join(', ');
      db.prepare(`UPDATE agents SET ${sets} WHERE id = ?`).run(...Object.values(fields), agent.id);
      if (fields.department && agent.is_head) {
        db.prepare('UPDATE agents SET is_head = 0 WHERE department = ? AND id != ?').run(fields.department, agent.id);
      }
      logActivity(db, 'ceo', 'karyawan', `Data agen ${agent.name} diperbarui.`, { agentId: agent.id });
      const updated = serializeAgent(db, getAgent(db, agent.id));
      bus.broadcast('agent.update', updated);
      return sendJson(res, 200, updated);
    }

    if (parts[0] === 'api' && parts[1] === 'agents' && parts[2] && method === 'DELETE') {
      const agent = getAgent(db, parts[2]);
      if (!agent) throw new ApiError(404, 'Agen tidak ditemukan.');
      if (agent.role === 'Secretary AI') {
        const secretaries = db.prepare("SELECT COUNT(*) AS c FROM agents WHERE role = 'Secretary AI' AND active = 1 AND id != ?").get(agent.id);
        if (Number(secretaries.c) === 0) throw new ApiError(400, 'Secretary AI terakhir tidak dapat dihapus.');
      }
      const working = db.prepare('SELECT COUNT(*) AS c FROM tasks WHERE assignee_id = ? AND status IN (?,?)')
        .get(agent.id, STATUS.WORKING, STATUS.WAITING);
      if (Number(working.c) > 0) throw new ApiError(409, 'Agen masih memiliki tugas aktif. Hentikan tugas terlebih dahulu.');
      db.prepare('UPDATE agents SET active = 0, status = ?, updated_at = ? WHERE id = ?').run('Nonaktif', now(), agent.id);
      logActivity(db, 'ceo', 'karyawan', `CEO menonaktifkan agen ${agent.name}.`, { agentId: agent.id });
      bus.broadcast('agent.update', serializeAgent(db, getAgent(db, agent.id)));
      return sendJson(res, 200, { ok: true, id: agent.id });
    }

    if (parts[0] === 'api' && parts[1] === 'agents' && parts[2] && parts[3] === 'tasks' && method === 'GET') {
      const rows = db.prepare(`SELECT t.*, p.title AS project_title, e.status AS execution_status, e.simulation AS execution_simulation
        FROM tasks t LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN executions e ON e.id = t.execution_id
        WHERE t.assignee_id = ? ORDER BY t.created_at DESC LIMIT 100`).all(parts[2]);
      return sendJson(res, 200, rows);
    }

    if (route === 'GET /api/engines') {
      return sendJson(res, 200, listEngines(db).map((engine) => publicEngine(engine, db)));
    }

    if (parts[0] === 'api' && parts[1] === 'engines' && parts[2] && method === 'PATCH') {
      const engine = getEngine(db, parts[2]);
      if (!engine) throw new ApiError(404, 'Mesin AI tidak ditemukan.');
      if (engine.type === 'simulation') throw new ApiError(400, 'Mesin simulasi tidak dapat diubah.');
      const body = await readBody(req);
      let executable = engine.executable;
      if (body.executable !== undefined) {
        executable = String(body.executable || '').trim();
        if (executable) {
          try { executable = assertSafeExecutable(executable); } catch (error) { throw new ApiError(400, error.message); }
        }
      }
      const config = body.config !== undefined ? validateEngineConfig(engine.type, body.config) : safeJson(engine.config, {});
      let models = body.models !== undefined
        ? (Array.isArray(body.models) ? body.models.slice(0, 100).map((m) => sanitizeModel(m)).filter(Boolean) : [])
        : safeJson(engine.models, []);
      const label = body.label !== undefined
        ? cleanString(body.label, { min: 2, max: 60, field: 'Nama mesin', required: true })
        : engine.label;
      db.prepare(`UPDATE engines SET label = ?, executable = ?, config = ?, models = ?, status = ?, version = '', last_checked = NULL, updated_at = ? WHERE id = ?`)
        .run(label, executable, JSON.stringify(config), JSON.stringify(models), 'Belum diperiksa', now(), engine.id);
      const updated = publicEngine(getEngine(db, engine.id), db);
      bus.broadcast('engine.update', updated);
      return sendJson(res, 200, updated);
    }

    if (parts[0] === 'api' && parts[1] === 'engines' && parts[2] && parts[3] === 'detect' && method === 'POST') {
      const engine = getEngine(db, parts[2]);
      if (!engine) throw new ApiError(404, 'Mesin AI tidak ditemukan.');
      if (engine.type === 'simulation') return sendJson(res, 200, publicEngine(engine, db));
      const adapter = adapterFor(engine);
      const detected = await adapter.detect();
      if (detected.executable && detected.executable !== engine.executable) {
        db.prepare('UPDATE engines SET executable = ?, updated_at = ? WHERE id = ?').run(detected.executable, now(), engine.id);
      }
      const updated = publicEngine(getEngine(db, engine.id), db);
      bus.broadcast('engine.update', updated);
      return sendJson(res, 200, { engine: updated, detected });
    }

    if (parts[0] === 'api' && parts[1] === 'engines' && parts[2] && parts[3] === 'test' && method === 'POST') {
      const engine = getEngine(db, parts[2]);
      if (!engine) throw new ApiError(404, 'Mesin AI tidak ditemukan.');
      if (engine.type === 'simulation') {
        return sendJson(res, 200, {
          engine: publicEngine(engine, db),
          result: { ok: true, status: 'Siap (SIMULASI)', message: 'Mesin simulasi selalu siap.', logs: '', version: 'bawaan', models: [] },
        });
      }
      const body = await readBody(req);
      const prompt = cleanString(body.prompt || '', { max: 500, field: 'Prompt tes' });
      const model = sanitizeModel(body.model || '');
      const adapter = adapterFor(engine);
      const result = await adapter.testConnection({ prompt, model });
      const updatedEngine = persistTestResult(db, engine.id, result);
      db.prepare('INSERT INTO engine_tests (id,engine_id,ok,status,message,logs,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(uid('etst'), engine.id, result.ok ? 1 : 0, result.status, result.message,
          redactSecrets(result.logs || '').slice(0, 20000), now());
      logActivity(db, 'ceo', 'koneksi', `Tes koneksi ${engine.label}: ${result.status}.`, { engineId: engine.id });
      bus.broadcast('engine.update', publicEngine(updatedEngine, db));
      bus.broadcast('activity', { message: `Tes koneksi ${engine.label}: ${result.status}.` });
      return sendJson(res, 200, { engine: publicEngine(updatedEngine, db), result });
    }

    if (parts[0] === 'api' && parts[1] === 'engines' && parts[2] && parts[3] === 'tests' && method === 'GET') {
      const rows = db.prepare('SELECT * FROM engine_tests WHERE engine_id = ? ORDER BY created_at DESC LIMIT 20').all(parts[2]);
      return sendJson(res, 200, rows.map((row) => ({ ...row, ok: Boolean(row.ok), logs: redactSecrets(row.logs) })));
    }

    if (route === 'GET /api/company') {
      return sendJson(res, 200, db.prepare('SELECT * FROM company WHERE id = 1').get());
    }

    if (route === 'PATCH /api/company') {
      const body = await readBody(req);
      const current = db.prepare('SELECT * FROM company WHERE id = 1').get();
      const name = body.name !== undefined
        ? cleanString(body.name, { min: 2, max: 80, field: 'Nama perusahaan', required: true }) : current.name;
      const tagline = body.tagline !== undefined
        ? cleanString(body.tagline, { max: 160, field: 'Tagline' }) : current.tagline;
      const description = body.description !== undefined
        ? cleanString(body.description, { max: 2000, field: 'Profil perusahaan' }) : current.description;
      const avatar = body.avatar !== undefined
        ? cleanString(body.avatar, { min: 1, max: 8, field: 'Avatar', required: true }) : current.avatar;
      const modelBalance = body.model_balance !== undefined
        ? cleanString(body.model_balance, { max: 80, field: 'Saldo model' }) : current.model_balance;
      const ceoName = body.ceo_name !== undefined
        ? cleanString(body.ceo_name, { min: 2, max: LIMITS.nameLength, field: 'Nama CEO', required: true }) : current.ceo_name;
      const ceoAvatar = body.ceo_avatar !== undefined
        ? cleanString(body.ceo_avatar, { min: 1, max: 8, field: 'Avatar CEO', required: true }) : current.ceo_avatar;
      db.prepare('UPDATE company SET name = ?, tagline = ?, description = ?, avatar = ?, ceo_name = ?, ceo_avatar = ?, model_balance = ?, updated_at = ? WHERE id = 1')
        .run(name, tagline, description, avatar, ceoName, ceoAvatar, modelBalance, now());
      logActivity(db, 'ceo', 'pengaturan', 'Profil perusahaan diperbarui.', {});
      const company = db.prepare('SELECT * FROM company WHERE id = 1').get();
      bus.broadcast('company.update', company);
      return sendJson(res, 200, company);
    }

    if (route === 'GET /api/settings') {
      const settings = Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map((row) => [row.key, row.value]));
      return sendJson(res, 200, { ...settings, workspace_root: WORKSPACE_ROOT, limits: LIMITS });
    }

    if (route === 'PATCH /api/settings') {
      const body = await readBody(req);
      const allowed = ['concurrency', 'taskTimeoutMs', 'theme', 'officeSound', 'defaultMode'];
      const patch = {};
      if (body.concurrency !== undefined) {
        const value = Number(body.concurrency);
        if (!Number.isInteger(value) || value < 1 || value > 5) throw new ApiError(400, 'Batas proses paralel harus 1-5.');
        patch.concurrency = String(value);
      }
      if (body.taskTimeoutMs !== undefined) {
        const value = Number(body.taskTimeoutMs);
        if (!Number.isFinite(value) || value < 10000 || value > 3600000) throw new ApiError(400, 'Batas waktu tugas harus 10.000-3.600.000 ms.');
        patch.taskTimeoutMs = String(Math.round(value));
      }
      if (body.theme !== undefined) {
        if (!['dark', 'light'].includes(body.theme)) throw new ApiError(400, 'Tema tidak valid.');
        patch.theme = body.theme;
      }
      if (body.officeSound !== undefined) {
        if (!['on', 'off'].includes(body.officeSound)) throw new ApiError(400, 'Pengaturan suara tidak valid.');
        patch.officeSound = body.officeSound;
      }
      if (body.defaultMode !== undefined) {
        if (!['auto', 'nyata', 'simulasi'].includes(body.defaultMode)) throw new ApiError(400, 'Mode default tidak valid.');
        patch.defaultMode = body.defaultMode;
      }
      for (const [key, value] of Object.entries(patch)) setSetting(db, key, value);
      logActivity(db, 'ceo', 'pengaturan', 'Pengaturan aplikasi diperbarui.', patch);
      const settings = Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map((row) => [row.key, row.value]));
      bus.broadcast('settings.update', settings);
      return sendJson(res, 200, settings);
    }

    if (route === 'GET /api/departments') {
      const departments = getStats(db).departments.map((dept) => ({
        ...dept,
        head: db.prepare('SELECT id,name,role,avatar FROM agents WHERE active = 1 AND department = ? AND is_head = 1 LIMIT 1').get(dept.department) || null,
        members: listAgents(db).filter((agent) => agent.department === dept.department)
          .map((agent) => serializeAgent(db, agent)),
      }));
      return sendJson(res, 200, departments);
    }

    if (route === 'POST /api/commands') {
      const body = await readBody(req);
      const instruction = cleanString(body.instruction, { min: 5, max: LIMITS.instructionLength, field: 'Instruksi', required: true });
      const mode = ['auto', 'nyata', 'simulasi'].includes(body.mode) ? body.mode : (getSetting(db, 'defaultMode', 'auto'));
      const engineId = body.engineId ? cleanOptionalId(body.engineId, 'Mesin AI') : null;
      const project = orchestrator.createCommand({ instruction, mode, engineId });
      return sendJson(res, 202, serializeProjectRow(db, project));
    }

    if (route === 'GET /api/projects') {
      const rows = db.prepare('SELECT * FROM projects ORDER BY created_at DESC LIMIT 100').all()
        .map((row) => serializeProjectRow(db, row));
      return sendJson(res, 200, rows);
    }

    if (parts[0] === 'api' && parts[1] === 'projects' && parts[2] && method === 'GET') {
      const detail = projectDetail(db, orchestrator, parts[2]);
      if (!detail) throw new ApiError(404, 'Proyek tidak ditemukan.');
      return sendJson(res, 200, detail);
    }

    if (parts[0] === 'api' && parts[1] === 'projects' && parts[2] && parts[3] === 'cancel' && method === 'POST') {
      const body = await readBody(req);
      const reason = cleanString(body.reason || 'Dihentikan oleh CEO.', { max: 500, field: 'Alasan' });
      const project = orchestrator.cancelProject(parts[2], reason);
      return sendJson(res, 200, serializeProjectRow(db, project));
    }

    if (parts[0] === 'api' && parts[1] === 'projects' && parts[2] && parts[3] === 'approve' && method === 'POST') {
      const body = await readBody(req);
      const decision = body.decision === 'tolak' ? 'tolak' : 'setuju';
      const note = cleanString(body.note || '', { max: 1000, field: 'Catatan' });
      const project = orchestrator.approveProject(parts[2], decision, note);
      return sendJson(res, 200, serializeProjectRow(db, project));
    }

    if (route === 'GET /api/tasks') {
      const projectId = searchParams.get('projectId');
      const rows = projectId
        ? db.prepare(`SELECT t.*, a.name AS assignee_name, a.role AS assignee_role, p.title AS project_title,
            e.status AS execution_status, e.simulation AS execution_simulation
          FROM tasks t LEFT JOIN agents a ON a.id = t.assignee_id LEFT JOIN projects p ON p.id = t.project_id
          LEFT JOIN executions e ON e.id = t.execution_id WHERE t.project_id = ? ORDER BY t.created_at`).all(projectId)
        : db.prepare(`SELECT t.*, a.name AS assignee_name, a.role AS assignee_role, p.title AS project_title,
            e.status AS execution_status, e.simulation AS execution_simulation
          FROM tasks t LEFT JOIN agents a ON a.id = t.assignee_id LEFT JOIN projects p ON p.id = t.project_id
          LEFT JOIN executions e ON e.id = t.execution_id ORDER BY t.created_at DESC LIMIT 300`).all();
      return sendJson(res, 200, rows);
    }

    if (parts[0] === 'api' && parts[1] === 'tasks' && parts[2] && method === 'GET') {
      const detail = orchestrator.taskDetail(parts[2]);
      if (!detail) throw new ApiError(404, 'Tugas tidak ditemukan.');
      const logs = detail.execution_id
        ? db.prepare('SELECT stream,line,created_at FROM execution_logs WHERE execution_id = ? ORDER BY id LIMIT 600').all(detail.execution_id)
        : [];
      return sendJson(res, 200, { ...detail, logs });
    }

    if (parts[0] === 'api' && parts[1] === 'tasks' && parts[2] && parts[3] === 'cancel' && method === 'POST') {
      const body = await readBody(req);
      const reason = cleanString(body.reason || 'Tugas dihentikan oleh CEO.', { max: 500, field: 'Alasan' });
      const task = orchestrator.cancelTask(parts[2], reason);
      return sendJson(res, 200, task);
    }

    if (parts[0] === 'api' && parts[1] === 'executions' && parts[2] && parts[3] === 'logs' && method === 'GET') {
      const logs = db.prepare('SELECT stream,line,created_at FROM execution_logs WHERE execution_id = ? ORDER BY id LIMIT 600').all(parts[2]);
      const execution = db.prepare('SELECT * FROM executions WHERE id = ?').get(parts[2]);
      if (!execution) throw new ApiError(404, 'Eksekusi tidak ditemukan.');
      return sendJson(res, 200, { execution: orchestrator.publicExecution(execution), logs });
    }

    if (parts[0] === 'api' && parts[1] === 'executions' && parts[2] && parts[3] === 'cancel' && method === 'POST') {
      const body = await readBody(req);
      const reason = cleanString(body.reason || 'Dihentikan oleh CEO.', { max: 500, field: 'Alasan' });
      const ok = manager.cancel(parts[2], reason);
      return sendJson(res, ok ? 200 : 409, { ok, message: ok ? 'Eksekusi dihentikan.' : 'Eksekusi tidak sedang berjalan.' });
    }

    if (route === 'GET /api/reports') {
      const rows = db.prepare(`SELECT r.id, r.project_id, r.title, r.author_id, r.department, r.mode, r.created_at,
          a.name AS author_name, p.title AS project_title
        FROM reports r LEFT JOIN agents a ON a.id = r.author_id LEFT JOIN projects p ON p.id = r.project_id
        ORDER BY r.created_at DESC LIMIT 100`).all();
      return sendJson(res, 200, rows);
    }

    if (parts[0] === 'api' && parts[1] === 'reports' && parts[2] && method === 'GET') {
      const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(parts[2]);
      if (!report) throw new ApiError(404, 'Laporan tidak ditemukan.');
      return sendJson(res, 200, report);
    }

    if (route === 'GET /api/meetings') {
      const rows = db.prepare('SELECT * FROM meetings ORDER BY created_at DESC LIMIT 100').all()
        .map((row) => ({ ...row, attendees: safeJson(row.attendees, []) }));
      return sendJson(res, 200, rows);
    }

    if (route === 'POST /api/meetings') {
      const body = await readBody(req);
      const title = cleanString(body.title, { min: 3, max: 120, field: 'Judul rapat', required: true });
      const agenda = cleanString(body.agenda || '', { max: 1500, field: 'Agenda' });
      if (!Array.isArray(body.attendees)) throw new ApiError(400, 'Peserta rapat harus berupa array.');
      const attendees = body.attendees.slice(0, 30).map((id) => cleanOptionalId(id, 'Peserta'));
      for (const id of attendees) {
        if (!getAgent(db, id)) throw new ApiError(400, `Agen peserta tidak ditemukan: ${id}`);
      }
      const meeting = orchestrator.createMeeting({ title, agenda, attendees });
      return sendJson(res, 201, { ...meeting, attendees: safeJson(meeting.attendees, []) });
    }

    if (route === 'GET /api/backup') {
      const tables = {};
      for (const table of TABLE_ORDER) tables[table] = db.prepare(`SELECT * FROM ${table}`).all();
      logActivity(db, 'ceo', 'backup', 'Backup data diunduh.', {});
      res.setHeader('Content-Disposition', `attachment; filename="pixel-office-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json"`);
      return sendJson(res, 200, { version: 1, app: 'Pixel Office AI', exported_at: now(), tables });
    }

    if (route === 'POST /api/restore') {
      if (manager.activeCount > 0 || manager.queue.length > 0) {
        throw new ApiError(409, 'Hentikan semua eksekusi sebelum memulihkan data.');
      }
      const body = await readBody(req);
      const tables = body.tables || body;
      if (!tables || typeof tables !== 'object') throw new ApiError(400, 'Berkas backup tidak valid.');
      if (body.app && body.app !== 'Pixel Office AI') throw new ApiError(400, 'Berkas backup bukan milik Pixel Office AI.');
      if (!Array.isArray(tables.agents) || tables.agents.length === 0) {
        throw new ApiError(400, 'Backup tidak berisi data agen.');
      }
      const columns = {};
      for (const table of TABLE_ORDER) {
        columns[table] = db.prepare(`PRAGMA table_info(${table})`).all().map((col) => col.name);
      }
      db.prepare('BEGIN').run();
      try {
        for (const table of [...TABLE_ORDER].reverse()) db.prepare(`DELETE FROM ${table}`).run();
        for (const table of TABLE_ORDER) {
          const rows = Array.isArray(tables[table]) ? tables[table] : [];
          for (const row of rows) {
            if (!row || typeof row !== 'object') throw new Error(`Data ${table} tidak valid.`);
            const keys = Object.keys(row).filter((key) => columns[table].includes(key));
            if (keys.length === 0) continue;
            db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
              .run(...keys.map((key) => (row[key] === undefined ? null : row[key])));
          }
        }
        db.prepare('COMMIT').run();
      } catch (error) {
        try { db.prepare('ROLLBACK').run(); } catch { /* ignore */ }
        throw new ApiError(400, `Pemulihan gagal: ${error.message}`);
      }
      logActivity(db, 'ceo', 'backup', 'Data dipulihkan dari backup.', {});
      bus.broadcast('data.restored', { at: now() });
      return sendJson(res, 200, { ok: true, message: 'Data berhasil dipulihkan. Muat ulang halaman.' });
    }

    throw new ApiError(404, 'Endpoint tidak ditemukan.');
  };
}

export async function createApp({ refreshEngines = true } = {}) {
  const db = getDb();
  const manager = new ExecutionManager(db, bus);
  const orchestrator = new Orchestrator(db, manager);
  const refreshPromise = refreshEngines
    ? refreshEngineStatuses(db).catch((error) => {
        try {
          fs.appendFileSync(path.join(__dirname, 'logs', 'server-errors.log'),
            `[${now()}] refresh engines :: ${error.stack || error.message}\n`);
        } catch { /* ignore */ }
      })
    : Promise.resolve();
  const handleApi = createRouteHandler({ db, manager, orchestrator });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    try {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'");
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
        return sendJson(res, 405, { error: 'Metode tidak diizinkan.' });
      }
      serveStatic(req, res, url.pathname);
    } catch (error) {
      const inputError = !error.status && !error.code && error.name !== 'TypeError' && error.name !== 'RangeError';
      const status = error.status || (inputError ? 400 : 500);
      if (status >= 500) {
        try {
          fs.appendFileSync(path.join(__dirname, 'logs', 'server-errors.log'),
            `[${now()}] ${req.method} ${url.pathname} :: ${error.stack || error.message}\n`);
        } catch { /* ignore */ }
      }
      if (!res.headersSent) sendJson(res, status, { error: redactSecrets(error.message || 'Terjadi kesalahan.') });
      else res.end();
    }
  });
  server.on('clientError', (error, socket) => {
    if (error.code === 'ECONNRESET' || !socket.writable) {
      socket.destroy();
      return;
    }
    if (error.rawPacket && error.rawPacket[0] === 0x16) {
      try {
        fs.appendFileSync(path.join(__dirname, 'logs', 'server-errors.log'),
          `[${now()}] TLS handshake diterima di port HTTP; gunakan http://, bukan https://.\n`);
      } catch { /* ignore */ }
    }
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  const shutdown = () => {
    manager.shutdown();
    server.close();
  };
  return { server, db, manager, orchestrator, shutdown, refreshPromise };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const { server } = await createApp({ refreshEngines: true });
  server.listen(PORT, HOST, () => {
    console.log('');
    console.log('  Pixel Office AI siap dijalankan.');
    console.log(`  Buka: http://${HOST}:${PORT}`);
    console.log(`  Data: ${process.env.PIXEL_OFFICE_DB || path.join(__dirname, 'data', 'pixel-office.db')}`);
    console.log('  Tekan Ctrl+C untuk berhenti.');
    console.log('');
  });
  const stop = () => {
    console.log('\n  Menghentikan Pixel Office AI...');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
