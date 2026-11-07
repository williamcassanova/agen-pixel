import { OpenCodeAdapter } from './opencode.js';
import { HermesAdapter } from './hermes.js';
import { safeJson } from '../db.js';
import { now } from '../db.js';

export function adapterFor(engine) {
  if (!engine) return null;
  if (engine.type === 'opencode') return new OpenCodeAdapter(engine);
  if (engine.type === 'hermes') return new HermesAdapter(engine);
  return null;
}

export function engineDisplayStatus(engine) {
  if (!engine) return 'Belum terhubung';
  if (engine.type === 'simulation') return 'Siap (SIMULASI)';
  return engine.status || 'Belum terhubung';
}

export function isEngineConnected(engine) {
  return Boolean(engine && (engine.type === 'simulation' || engine.status === 'Terhubung'));
}

export function persistTestResult(db, engineId, result) {
  const ts = now();
  const models = JSON.stringify(result.models || safeJson(
    db.prepare('SELECT models FROM engines WHERE id = ?').get(engineId)?.models || '[]', [],
  ));
  db.prepare(`UPDATE engines SET status = ?, version = ?, executable = ?, models = ?, last_checked = ?, updated_at = ?
    WHERE id = ?`).run(
    result.status, result.version || '', result.executable || '', models, ts, ts, engineId,
  );
  return db.prepare('SELECT * FROM engines WHERE id = ?').get(engineId);
}
