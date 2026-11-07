import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export class BaseAdapter {
  constructor(engine) {
    this.engine = engine;
    this.type = engine.type;
    this.config = safeJson(engine.config, {});
  }

  static async detectExecutable(name, configured = '') {
    if (configured) {
      try { fs.accessSync(configured, fs.constants.X_OK); return configured; } catch { return ''; }
    }
    const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    for (const dir of dirs) {
      const candidate = path.join(dir, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch { /* continue */ }
    }
    return '';
  }

  static runProbe(executable, args, timeout = 20000) {
    return new Promise((resolve) => {
      const started = Date.now();
      execFile(executable, args, {
        timeout,
        encoding: 'utf8',
        cwd: process.cwd(),
        env: { ...process.env },
        maxBuffer: 1024 * 1024,
      }, (error, stdout, stderr) => {
        resolve({
          ok: !error,
          status: typeof error?.code === 'number' ? error.code : (error ? null : 0),
          stdout: (stdout || '').slice(0, 20000),
          stderr: (stderr || '').slice(0, 20000),
          error: error ? error.message : '',
          elapsedMs: Date.now() - started,
        });
      });
    });
  }

  async connect() {
    return this.testConnection();
  }

  async testConnection() {
    throw new Error('testConnection() belum diimplementasikan.');
  }

  buildRunArgs() {
    throw new Error('buildRunArgs() belum diimplementasikan.');
  }

  getExecutionStatus() {
    return { status: 'tidak diketahui' };
  }

  async cancelTask() {
    return false;
  }
}

export function safeJson(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}
