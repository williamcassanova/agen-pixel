import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DB_PATH, WORKSPACE_ROOT } from './config.js';

let dbInstance = null;

export function uid(prefix = 'id') {
  return `${prefix}-${crypto.randomBytes(8).toString('hex')}`;
}

export function now() {
  return new Date().toISOString();
}

export function getDb() {
  if (!dbInstance) dbInstance = createDb(DB_PATH);
  return dbInstance;
}

export function createDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  seedIfEmpty(db);
  repairAgentEngines(db);
  return db;
}

export function closeDb() {
  if (dbInstance) {
    try { dbInstance.close(); } catch { /* ignore */ }
    dbInstance = null;
  }
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS company (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL,
      tagline TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      avatar TEXT NOT NULL DEFAULT '🏢',
      ceo_name TEXT NOT NULL DEFAULT 'Budi Santoso',
      ceo_avatar TEXT NOT NULL DEFAULT '👑',
      model_balance TEXT NOT NULL DEFAULT 'Tidak tersedia',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS engines (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      type TEXT NOT NULL,
      executable TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Belum terhubung',
      version TEXT NOT NULL DEFAULT '',
      models TEXT NOT NULL DEFAULT '[]',
      config TEXT NOT NULL DEFAULT '{}',
      last_checked TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      department TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'staff',
      personality TEXT NOT NULL DEFAULT '',
      avatar TEXT NOT NULL DEFAULT '🧑‍💻',
      engine_id TEXT NOT NULL DEFAULT 'engine-simulation',
      model TEXT NOT NULL DEFAULT '',
      workdir TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Idle',
      is_head INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      instruction TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'SIMULASI',
      status TEXT NOT NULL,
      planning_engine_id TEXT,
      summary TEXT NOT NULL DEFAULT '',
      report_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      parent_id TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      department TEXT NOT NULL DEFAULT '',
      assignee_id TEXT,
      assigned_by TEXT,
      status TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'kerja',
      priority TEXT NOT NULL DEFAULT 'Normal',
      requires_approval INTEGER NOT NULL DEFAULT 0,
      execution_id TEXT,
      result TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS delegations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_id TEXT,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS executions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      engine_id TEXT NOT NULL,
      engine_type TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      workdir TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      pid INTEGER,
      exit_code INTEGER,
      prompt TEXT NOT NULL DEFAULT '',
      output TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      simulation INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      ended_at TEXT
    );
    CREATE TABLE IF NOT EXISTS execution_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_id TEXT NOT NULL,
      stream TEXT NOT NULL,
      line TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      author_id TEXT,
      department TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT 'SIMULASI',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      agenda TEXT NOT NULL DEFAULT '',
      attendees TEXT NOT NULL DEFAULT '[]',
      summary TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Dijadwalkan',
      mode TEXT NOT NULL DEFAULT 'SIMULASI',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      meta TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS engine_tests (
      id TEXT PRIMARY KEY,
      engine_id TEXT NOT NULL,
      ok INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      logs TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_id TEXT,
      requested_by TEXT,
      status TEXT NOT NULL DEFAULT 'Menunggu',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      decided_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_delegations_project ON delegations(project_id);
    CREATE INDEX IF NOT EXISTS idx_executions_task ON executions(task_id);
    CREATE INDEX IF NOT EXISTS idx_logs_execution ON execution_logs(execution_id);
    CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at);
    CREATE INDEX IF NOT EXISTS idx_reports_project ON reports(project_id);
    CREATE INDEX IF NOT EXISTS idx_engine_tests_engine ON engine_tests(engine_id);
  `);
}

const DEPARTMENTS = {
  Operasional: { color: '#8b5cf6' },
  Development: { color: '#3b82f6' },
  Research: { color: '#10b981' },
  Design: { color: '#ec4899' },
  'Quality Assurance': { color: '#f59e0b' },
  Marketing: { color: '#ef4444' },
};

const SEED_AGENTS = [
  ['agt-sec', 'Sari', 'Secretary AI', 'Operasional', 'secretary', 'Teliti, ringkas, dan selalu mencatat tindak lanjut.', '📋', 'opencode/deepseek-v4.1-flash-free', 0],
  ['agt-coo', 'Raka', 'COO', 'Operasional', 'executive', 'Tenang, terstruktur, dan fokus pada koordinasi lintas divisi.', '🧭', 'opencode/deepseek-v4.1-flash-free', 0],
  ['agt-dev-head', 'Dimas', 'Head of Development', 'Development', 'head', 'Tegas, teknis, dan mendorong penyelesaian cepat.', '🛠️', 'opencode/deepseek-v4.1-flash-free', 1],
  ['agt-dev-1', 'Adi', 'Programmer', 'Development', 'staff', 'Fokus, mandiri, dan senang menulis kode bersih.', '💻', 'opencode/deepseek-v4.1-flash-free', 0],
  ['agt-dev-2', 'Naya', 'Backend Developer', 'Development', 'staff', 'Sistematis dan teliti pada data serta API.', '🗄️', 'opencode/deepseek-v4.1-flash-free', 0],
  ['agt-dev-3', 'Fajar', 'Frontend Developer', 'Development', 'staff', 'Kreatif pada antarmuka dan detail pengalaman pengguna.', '🎨', 'opencode/deepseek-v4.1-flash-free', 0],
  ['agt-dev-4', 'Rina', 'Software Engineer', 'Development', 'staff', 'Analitis dan suka merancang arsitektur yang rapi.', '🧩', 'opencode/deepseek-v4.1-flash-free', 0],
  ['agt-res-head', 'Maya', 'Head of Research', 'Research', 'head', 'Rasa ingin tahu tinggi dan berbasis bukti.', '🔬', 'opencode/deepseek-v4.1-flash-free', 1],
  ['agt-res-1', 'Danu', 'Researcher', 'Research', 'staff', 'Tekun menggali sumber dan memverifikasi fakta.', '📚', 'opencode/deepseek-v4.1-flash-free', 0],
  ['agt-res-2', 'Lala', 'Data Analyst', 'Research', 'staff', 'Senang mengubah data menjadi insight.', '📊', 'opencode/deepseek-v4.1-flash-free', 0],
  ['agt-res-3', 'Bima', 'Technical Researcher', 'Research', 'staff', 'Mendalam pada eksperimen teknis dan benchmark.', '🧪', 'engine-hermes', 0],
  ['agt-des-head', 'Sinta', 'Head of Design', 'Design', 'head', 'Peka terhadap estetika dan konsistensi visual.', '✨', 'opencode/deepseek-v4.1-flash-free', 1],
  ['agt-des-1', 'Ayu', 'UI/UX Designer', 'Design', 'staff', 'Empatis dan fokus pada alur pengguna.', '🖌️', 'opencode/deepseek-v4.1-flash-free', 0],
  ['agt-des-2', 'Tio', 'Graphic Designer', 'Design', 'staff', 'Ekspresif dengan warna dan tipografi.', '🖼️', 'opencode/deepseek-v4.1-flash-free', 0],
  ['agt-des-3', 'Nia', 'Creative Designer', 'Design', 'staff', 'Suka ide segar dan konsep yang berani.', '💡', 'opencode/deepseek-v4.1-flash-free', 0],
  ['agt-qa-head', 'Bayu', 'Head of Quality Assurance', 'Quality Assurance', 'head', 'Disiplin dan tidak mudah puas dengan hasil setengah jadi.', '🔍', 'opencode/deepseek-v4.1-flash-free', 1],
  ['agt-qa-1', 'Citra', 'Tester', 'Quality Assurance', 'staff', 'Detail dan sabar menguji banyak skenario.', '🧷', 'opencode/deepseek-v4.1-flash-free', 0],
  ['agt-qa-2', 'Eko', 'Code Reviewer', 'Quality Assurance', 'staff', 'Kritis, konstruktif, dan konsisten pada standar.', '📝', 'opencode/deepseek-v4.1-flash-free', 0],
  ['agt-qa-3', 'Putri', 'Bug Hunter', 'Quality Assurance', 'staff', 'Gigih memburu bug hingga akar masalah.', '🐞', 'opencode/deepseek-v4.1-flash-free', 0],
  ['agt-mkt-head', 'Gita', 'Head of Marketing', 'Marketing', 'head', 'Komunikatif dan berorientasi pada audiens.', '📣', 'opencode/deepseek-v4.1-flash-free', 1],
  ['agt-mkt-1', 'Hana', 'Content Creator', 'Marketing', 'staff', 'Kreatif menulis dan bercerita.', '✍️', 'opencode/deepseek-v4.1-flash-free', 0],
  ['agt-mkt-2', 'Rizky', 'Market Researcher', 'Marketing', 'staff', 'Suka mengamati tren dan perilaku pasar.', '📈', 'opencode/deepseek-v4.1-flash-free', 0],
  ['agt-mkt-3', 'Dewi', 'Marketing Strategist', 'Marketing', 'staff', 'Strategis dan fokus pada dampak nyata.', '🎯', 'opencode/deepseek-v4.1-flash-free', 0],
];

function findOpencode() {
  const candidates = [
    '/usr/local/bin/opencode',
    path.join(process.env.HOME || '/root', '.opencode/bin/opencode'),
    '/usr/bin/opencode',
  ];
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch { /* continue */ }
  }
  return '';
}

function repairAgentEngines(db) {
  const opencode = db.prepare("SELECT id FROM engines WHERE type = 'opencode' ORDER BY created_at LIMIT 1").get();
  if (!opencode) return;
  const legacy = db.prepare("SELECT id, engine_id, model FROM agents WHERE engine_id LIKE 'opencode/%'").all();
  for (const agent of legacy) {
    const model = agent.model || agent.engine_id;
    db.prepare('UPDATE agents SET engine_id = ?, model = ?, updated_at = ? WHERE id = ?')
      .run(opencode.id, model, now(), agent.id);
  }
}

export function seedIfEmpty(db) {
  const row = db.prepare('SELECT COUNT(*) AS c FROM agents').get();
  if (Number(row.c) > 0) return;
  const ts = now();
  const tx = db.prepare('BEGIN');
  tx.run();
  try {
    db.prepare(`INSERT OR REPLACE INTO company (id,name,tagline,description,avatar,ceo_name,ceo_avatar,model_balance,updated_at)
      VALUES (1,?,?,?,?,?,?,?,?)`).run(
      'Pixel Office AI',
      'Membangun produk digital dengan tim AI.',
      'Perusahaan virtual tempat setiap karyawan adalah AI Agent yang bekerja melalui OpenCode CLI atau Hermes Agent CLI.',
      '🏢',
      'Budi Santoso',
      '👑',
      'Tidak tersedia',
      ts,
    );

    const defaults = {
      concurrency: '2',
      workdirRoot: WORKSPACE_ROOT,
      taskTimeoutMs: '600000',
      defaultMode: 'auto',
      theme: 'dark',
      officeSound: 'off',
      autoApprove: 'off',
    };
    const insSetting = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
    for (const [key, value] of Object.entries(defaults)) insSetting.run(key, value);

    const insEngine = db.prepare(`INSERT OR REPLACE INTO engines
      (id,label,type,executable,status,version,models,config,last_checked,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    insEngine.run(
      'engine-opencode', 'OpenCode CLI', 'opencode', findOpencode(),
      'Belum diperiksa', '', '["opencode/deepseek-v4.1-flash-free"]',
      JSON.stringify({ autoApprove: false, extraArgs: [], timeoutMs: 600000 }),
      null, ts, ts,
    );
    insEngine.run(
      'engine-hermes', 'Hermes Agent CLI', 'hermes', '',
      'Belum terhubung', '', '[]',
      JSON.stringify({
        versionArgs: ['--version'],
        helpArgs: ['--help'],
        runArgs: [],
        modelFlag: '',
        dirFlag: '',
        autoApproveFlag: '',
        extraArgs: [],
        timeoutMs: 600000,
      }),
      null, ts, ts,
    );
    insEngine.run(
      'engine-simulation', 'Mode Simulasi', 'simulation', '',
      'Siap (SIMULASI)', 'bawaan', '[]', '{}', ts, ts, ts,
    );

    const insAgent = db.prepare(`INSERT INTO agents
      (id,name,role,department,level,personality,avatar,engine_id,model,workdir,status,is_head,active,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`);
    for (const [id, name, role, department, level, personality, avatar, engineRef, isHead] of SEED_AGENTS) {
      const engineId = engineRef.startsWith('opencode/') ? 'engine-opencode' : engineRef;
      insAgent.run(
        id, name, role, department, level, personality, avatar,
        engineId, engineId === 'engine-hermes' ? '' : 'opencode/deepseek-v4.1-flash-free',
        path.join(WORKSPACE_ROOT, department.toLowerCase().replace(/[^a-z]+/g, '-')),
        'Idle', isHead, ts, ts,
      );
    }

    db.prepare(`INSERT INTO reports (id,project_id,title,body,author_id,department,mode,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      'report-welcome', null, 'Laporan Perkenalan Perusahaan',
      'Selamat datang di Pixel Office AI.\n\nIni adalah laporan contoh yang dibuat saat instalasi. ' +
      'Gunakan CEO Command Center untuk memberi instruksi pertama Anda. ' +
      'Aktifkan koneksi OpenCode atau Hermes di menu AI Connections agar pekerjaan dijalankan oleh mesin AI nyata. ' +
      'Selama mesin belum terhubung, pekerjaan akan dijalankan dalam mode SIMULASI yang diberi label jelas.',
      'agt-sec', 'Operasional', 'SIMULASI', ts,
    );
    db.prepare(`INSERT INTO activity (id,actor_id,type,message,meta,created_at) VALUES (?,?,?,?,?,?)`).run(
      uid('act'), 'agt-sec', 'sistem', 'Perusahaan virtual berhasil diinisialisasi.', '{}', ts,
    );
    db.prepare('COMMIT').run();
  } catch (error) {
    try { db.prepare('ROLLBACK').run(); } catch { /* ignore */ }
    throw error;
  }
}

export function logActivity(db, actorId, type, message, meta = {}) {
  const id = uid('act');
  db.prepare('INSERT INTO activity (id,actor_id,type,message,meta,created_at) VALUES (?,?,?,?,?,?)')
    .run(id, actorId || null, type, message, JSON.stringify(meta || {}), now());
  return id;
}

export function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(db, key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(key, String(value));
}

export function getAgent(db, id) {
  return db.prepare('SELECT * FROM agents WHERE id = ?').get(id) || null;
}

export function listAgents(db, { activeOnly = true } = {}) {
  const sql = activeOnly
    ? 'SELECT * FROM agents WHERE active = 1 ORDER BY is_head DESC, department, role, name'
    : 'SELECT * FROM agents ORDER BY is_head DESC, department, role, name';
  return db.prepare(sql).all();
}

export function getEngine(db, id) {
  return db.prepare('SELECT * FROM engines WHERE id = ?').get(id) || null;
}

export function listEngines(db) {
  return db.prepare('SELECT * FROM engines ORDER BY type').all();
}

export function updateAgentStatus(db, agentId, status) {
  db.prepare('UPDATE agents SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), agentId);
}

export function safeJson(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

export function agentWorkdir(agent, projectId, taskId) {
  const base = agent.workdir || path.join(WORKSPACE_ROOT, 'umum');
  const safeProject = String(projectId || 'proyek').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 60);
  const safeTask = String(taskId || 'tugas').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 60);
  return path.join(base, 'projects', safeProject, safeTask);
}

export { DEPARTMENTS };
