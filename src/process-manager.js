import { spawn } from 'node:child_process';
import path from 'node:path';
import {
  getAgent, getEngine, getSetting, now, uid, updateAgentStatus, logActivity, safeJson,
} from './db.js';
import { adapterFor } from './adapters/index.js';
import { executeSafe } from './security.js';
import { redactSecrets, assertSafeWorkdir, ensureWorkdir } from './security.js';
import { LIMITS, WORKSPACE_ROOT } from './config.js';
import { simulateTaskOutput } from './simulation.js';

const RUNNING = 'Berjalan';
const QUEUED = 'Menunggu';
const SUCCESS = 'Sukses';
const FAILED = 'Gagal';
const CANCELLED = 'Dibatalkan';

export class ExecutionManager {
  constructor(db, bus) {
    this.db = db;
    this.bus = bus;
    this.active = new Map();
    this.queue = [];
    this.stopping = false;
  }

  get concurrencyLimit() {
    const raw = Number(getSetting(this.db, 'concurrency', '2'));
    if (!Number.isFinite(raw)) return 2;
    return Math.max(1, Math.min(5, Math.floor(raw)));
  }

  get activeCount() {
    return this.active.size;
  }

  createExecution(opts) {
    const id = uid('exe');
    const ts = now();
    this.db.prepare(`INSERT INTO executions
      (id,task_id,agent_id,engine_id,engine_type,model,workdir,status,pid,exit_code,prompt,output,error,simulation,started_at,ended_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, opts.taskId, opts.agentId, opts.engineId, opts.engine.type || 'simulation',
      opts.model || '', opts.workdir || '', QUEUED, null, null,
      redactSecrets(opts.prompt || '').slice(0, 20000), '', '', opts.simulation ? 1 : 0, ts, null,
    );
    return this.db.prepare('SELECT * FROM executions WHERE id = ?').get(id);
  }

  execUpdate(executionId) {
    const row = this.db.prepare('SELECT * FROM executions WHERE id = ?').get(executionId);
    if (row) this.bus.broadcast('execution.update', row);
    return row;
  }

  appendLog(executionId, stream, line) {
    const entry = this.active.get(executionId) || this.queue.find((item) => item.executionId === executionId);
    if (entry) {
      entry.logCount = (entry.logCount || 0) + 1;
      if (entry.logCount > LIMITS.logLines) return;
    }
    const safe = redactSecrets(String(line)).slice(0, 4000);
    if (!safe.trim()) return;
    this.db.prepare('INSERT INTO execution_logs (execution_id,stream,line,created_at) VALUES (?,?,?,?)')
      .run(executionId, stream, safe, now());
    this.bus.broadcast('execution.log', { executionId, stream, line: safe, at: now() });
  }

  run(opts) {
    if (this.stopping) throw new Error('Mesin eksekusi sedang berhenti.');
    const engine = getEngine(this.db, opts.engineId);
    if (!engine) throw new Error('Mesin AI tidak ditemukan.');
    const agent = getAgent(this.db, opts.agentId);
    if (!agent) throw new Error('Agen tidak ditemukan.');
    const simulation = Boolean(opts.simulation) || engine.type === 'simulation';
    let workdir;
    const requested = opts.workdir || agent.workdir || path.join(WORKSPACE_ROOT, 'umum');
    try {
      workdir = ensureWorkdir(requested, WORKSPACE_ROOT);
    } catch (error) {
      throw new Error(`Direktori kerja tidak valid: ${error.message}`);
    }

    const execution = this.createExecution({
      ...opts, engine, workdir, simulation,
    });
    const entry = {
      executionId: execution.id,
      taskId: opts.taskId,
      agentId: opts.agentId,
      engine,
      simulation,
      prompt: opts.prompt,
      model: opts.model || '',
      workdir,
      logCount: 0,
      output: '',
      stderr: '',
      canceled: false,
      child: null,
      timers: [],
      killTimer: null,
      started: false,
    };
    const done = new Promise((resolve) => { entry.resolve = resolve; });
    this.appendLog(execution.id, 'sistem', simulation
      ? 'Eksekusi SIMULASI dibuat. Tidak ada proses AI nyata yang dijalankan.'
      : `Eksekusi nyata disiapkan untuk mesin ${engine.label}.`);

    if (this.active.size < this.concurrencyLimit) {
      this.start(entry);
    } else {
      this.queue.push(entry);
      this.appendLog(execution.id, 'sistem', 'Menunggu slot proses tersedia (batas paralel tercapai).');
      this.bus.broadcast('execution.update', execution);
    }
    return { executionId: execution.id, done, entry };
  }

  start(entry) {
    if (this.stopping || entry.canceled) return;
    this.active.set(entry.executionId, entry);
    entry.started = true;
    this.db.prepare('UPDATE executions SET status = ?, started_at = ? WHERE id = ?')
      .run(RUNNING, now(), entry.executionId);
    this.execUpdate(entry.executionId);
    if (entry.simulation) this.startSimulation(entry);
    else this.startReal(entry).catch((error) => {
      this.finish(entry, FAILED, { error: error.message });
    });
  }

  startSimulation(entry) {
    const agent = getAgent(this.db, entry.agentId);
    const task = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(entry.taskId);
    const lines = [
      'Memuat konteks proyek dan instruksi CEO...',
      `Menyiapkan peran ${agent?.role || 'agen'} untuk tugas "${task?.title || '-'}"...`,
      'Menyusun langkah kerja dan keluaran...',
      'Memeriksa konsistensi hasil...',
      'Menyelesaikan laporan tugas...',
    ];
    const stepMs = 420;
    lines.forEach((line, index) => {
      const timer = setTimeout(() => {
        if (entry.canceled) return;
        this.appendLog(entry.executionId, 'simulasi', line);
        if (index === lines.length - 1) {
          const output = simulateTaskOutput(task || { title: entry.prompt.slice(0, 80) }, agent);
          entry.output = redactSecrets(output);
          this.finish(entry, SUCCESS);
        }
      }, stepMs * (index + 1));
      entry.timers.push(timer);
    });
  }

  async startReal(entry) {
    const adapter = adapterFor(entry.engine);
    if (!adapter) {
      this.appendLog(entry.executionId, 'error', 'Tipe mesin tidak didukung.');
      return this.finish(entry, FAILED, { error: 'Tipe mesin tidak didukung.' });
    }
    let executable = entry.engine.executable || '';
    try {
      const detected = await adapter.detect();
      executable = detected.executable || executable;
    } catch { /* continue */ }
    if (!executable) {
      const message = `Executable ${entry.engine.type} tidak ditemukan. Buka AI Connections untuk mengaturnya.`;
      this.appendLog(entry.executionId, 'error', message);
      return this.finish(entry, FAILED, { error: message });
    }
    const args = adapter.buildRunArgs({
      prompt: entry.prompt,
      model: entry.model,
      workdir: entry.workdir,
    });
    if (!Array.isArray(args) || args.length === 0) {
      const message = 'Template argumen eksekusi belum dikonfigurasi untuk mesin ini.';
      this.appendLog(entry.executionId, 'error', message);
      return this.finish(entry, FAILED, { error: message });
    }
    try { assertSafeWorkdir(entry.workdir, WORKSPACE_ROOT); } catch (error) {
      return this.finish(entry, FAILED, { error: error.message });
    }
    let safeExecutable;
    try { safeExecutable = executeSafe(executable, args); } catch (error) {
      this.appendLog(entry.executionId, 'error', error.message);
      return this.finish(entry, FAILED, { error: error.message });
    }
    this.appendLog(entry.executionId, 'sistem', `Menjalankan ${path.basename(safeExecutable)} di ${entry.workdir}`);
    const engineConfig = safeJson(entry.engine?.config, {});
    const timeoutMs = Number(engineConfig.timeoutMs) || LIMITS.executionTimeoutMs;
    let child;
    try {
      child = spawn(safeExecutable, args, {
        cwd: entry.workdir,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PIXEL_OFFICE_TASK_ID: entry.taskId,
          PIXEL_OFFICE_AGENT_ID: entry.agentId,
        },
      });
    } catch (error) {
      this.appendLog(entry.executionId, 'error', `Gagal menjalankan proses: ${error.message}`);
      return this.finish(entry, FAILED, { error: error.message });
    }
    entry.child = child;
    if (child.pid) {
      this.db.prepare('UPDATE executions SET pid = ? WHERE id = ?').run(child.pid, entry.executionId);
      this.execUpdate(entry.executionId);
    }
    this.collectStream(entry, child.stdout, 'stdout');
    this.collectStream(entry, child.stderr, 'stderr');
    const timeout = setTimeout(() => {
      if (entry.finished) return;
      this.appendLog(entry.executionId, 'error', `Batas waktu ${Math.round(timeoutMs / 1000)} detik tercapai. Proses dihentikan.`);
      entry.timedOut = true;
      this.killEntry(entry);
    }, timeoutMs);
    entry.timers.push(timeout);
    child.on('error', (error) => {
      this.appendLog(entry.executionId, 'error', `Kesalahan proses: ${error.message}`);
      this.finish(entry, FAILED, { error: error.message });
    });
    child.on('close', (code, signal) => {
      if (entry.finished) return;
      for (const timer of entry.timers) clearTimeout(timer);
      if (entry.killTimer) clearTimeout(entry.killTimer);
      if (entry.canceled) {
        return this.finish(entry, CANCELLED, { exitCode: code });
      }
      if (entry.timedOut) {
        return this.finish(entry, FAILED, {
          exitCode: code,
          error: 'Eksekusi melebihi batas waktu dan dihentikan.',
        });
      }
      if (code === 0) {
        return this.finish(entry, SUCCESS, { exitCode: 0 });
      }
      const reason = entry.stderr.trim() || `Proses keluar dengan kode ${code}${signal ? ` (${signal})` : ''}.`;
      return this.finish(entry, FAILED, { exitCode: code, error: reason.slice(0, 4000) });
    });
  }

  collectStream(entry, stream, name) {
    if (!stream) return;
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      if (entry.finished) return;
      const text = chunk.toString();
      if (name === 'stdout') entry.output = (entry.output + text).slice(0, LIMITS.outputBytes);
      else entry.stderr = (entry.stderr + text).slice(0, LIMITS.outputBytes);
      buffer += text;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) this.appendLog(entry.executionId, name, line);
      }
    });
    stream.on('end', () => {
      if (buffer.trim()) this.appendLog(entry.executionId, name, buffer);
    });
  }

  finish(entry, status, { exitCode = null, error = '' } = {}) {
    if (entry.finished) return;
    entry.finished = true;
    for (const timer of entry.timers) clearTimeout(timer);
    if (entry.killTimer) clearTimeout(entry.killTimer);
    const output = redactSecrets(entry.output || '').slice(0, LIMITS.outputBytes);
    const errText = redactSecrets(error || '').slice(0, 8000);
    this.db.prepare(`UPDATE executions SET status = ?, exit_code = ?, output = ?, error = ?, ended_at = ? WHERE id = ?`)
      .run(status, exitCode, output, errText, now(), entry.executionId);
    this.active.delete(entry.executionId);
    this.execUpdate(entry.executionId);
    const agent = getAgent(this.db, entry.agentId);
    if (agent) {
      const nextStatus = status === RUNNING ? 'Bekerja' : status === SUCCESS ? 'Idle' : 'Idle';
      try { updateAgentStatus(this.db, entry.agentId, nextStatus); } catch { /* ignore */ }
      this.bus.broadcast('agent.update', { ...agent, status: nextStatus });
    }
    const task = this.db.prepare('SELECT title FROM tasks WHERE id = ?').get(entry.taskId);
    logActivity(this.db, entry.agentId, 'eksekusi',
      simulationActivity(status, task?.title || entry.taskId, entry.simulation), {
        executionId: entry.executionId, taskId: entry.taskId, status,
      });
    this.bus.broadcast('activity', { message: simulationActivity(status, task?.title || entry.taskId, entry.simulation) });
    entry.resolve(this.db.prepare('SELECT * FROM executions WHERE id = ?').get(entry.executionId));
    this.startNext();
  }

  startNext() {
    if (this.stopping) return;
    while (this.active.size < this.concurrencyLimit && this.queue.length > 0) {
      const entry = this.queue.shift();
      if (entry.canceled) continue;
      this.start(entry);
    }
  }

  killEntry(entry) {
    const child = entry.child;
    if (!child || !child.pid) return;
    const signal = (sig) => {
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch {
        try { child.kill(sig); } catch { /* ignore */ }
      }
    };
    signal('SIGTERM');
    entry.killTimer = setTimeout(() => signal('SIGKILL'), 4000);
  }

  cancel(executionId, reason = 'Dibatalkan oleh CEO.') {
    const active = this.active.get(executionId);
    if (active) {
      active.canceled = true;
      for (const timer of active.timers) clearTimeout(timer);
      this.appendLog(executionId, 'sistem', reason);
      if (active.simulation) {
        this.finish(active, CANCELLED, { error: reason });
      } else {
        this.killEntry(active);
      }
      return true;
    }
    const idx = this.queue.findIndex((entry) => entry.executionId === executionId);
    if (idx >= 0) {
      const entry = this.queue[idx];
      this.queue.splice(idx, 1);
      entry.canceled = true;
      this.appendLog(executionId, 'sistem', reason);
      this.finish(entry, CANCELLED, { error: reason });
      return true;
    }
    return false;
  }

  cancelByTask(taskId, reason) {
    const rows = this.db.prepare("SELECT id FROM executions WHERE task_id = ? AND status IN (?,?)")
      .all(taskId, RUNNING, QUEUED);
    let count = 0;
    for (const row of rows) if (this.cancel(row.id, reason)) count += 1;
    return count;
  }

  shutdown() {
    this.stopping = true;
    for (const entry of [...this.active.values()]) {
      entry.canceled = true;
      if (entry.child) this.killEntry(entry);
      else this.finish(entry, CANCELLED, { error: 'Server berhenti.' });
    }
    for (const entry of this.queue) {
      entry.canceled = true;
      this.finish(entry, CANCELLED, { error: 'Server berhenti.' });
    }
    this.queue = [];
  }
}

function simulationActivity(status, title, simulation) {
  const prefix = simulation ? '[SIMULASI] ' : '';
  if (status === SUCCESS) return `${prefix}Eksekusi tugas "${title}" selesai.`;
  if (status === FAILED) return `${prefix}Eksekusi tugas "${title}" gagal.`;
  if (status === CANCELLED) return `${prefix}Eksekusi tugas "${title}" dibatalkan.`;
  return `${prefix}Eksekusi tugas "${title}" diperbarui.`;
}
