import path from 'node:path';
import fs from 'node:fs';

const SECRET_PATTERNS = [
  /(sk-[A-Za-z0-9_-]{12,})/g,
  /(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi,
  /((?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*)[^\s,;"']+/gi,
  /(ANTHROPIC_API_KEY\s*=\s*)[^\s]+/gi,
  /(OPENAI_API_KEY\s*=\s*)[^\s]+/gi,
];

export function redactSecrets(text) {
  if (typeof text !== 'string') return '';
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (_m, prefix) => `${prefix || ''}[REDACTED]`);
  }
  return out;
}

export function isWithin(parent, child) {
  const parentResolved = path.resolve(parent) + path.sep;
  const childResolved = path.resolve(child);
  return childResolved === path.resolve(parent) || childResolved.startsWith(parentResolved);
}

export function assertSafeWorkdir(requested, root) {
  if (typeof requested !== 'string' || !requested.trim()) {
    throw new Error('Direktori kerja wajib diisi.');
  }
  if (requested.includes('\0')) throw new Error('Direktori kerja tidak valid.');
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(requested);
  if (!isWithin(resolvedRoot, resolved)) {
    throw new Error('Direktori kerja harus berada di dalam folder workspace yang diizinkan.');
  }
  return resolved;
}

export function ensureWorkdir(requested, root) {
  const resolved = assertSafeWorkdir(requested, root);
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

export function assertSafeExecutable(executable) {
  if (typeof executable !== 'string' || !executable.trim()) {
    throw new Error('Lokasi executable wajib diisi.');
  }
  if (executable.includes('\0') || executable.includes('\n')) {
    throw new Error('Lokasi executable tidak valid.');
  }
  const resolved = path.isAbsolute(executable)
    ? path.resolve(executable)
    : executable;
  if (path.isAbsolute(resolved)) {
    let stat;
    try { stat = fs.statSync(resolved); } catch { throw new Error('Executable tidak ditemukan.'); }
    if (!stat.isFile()) throw new Error('Executable bukan berkas.');
    try { fs.accessSync(resolved, fs.constants.X_OK); } catch { throw new Error('Berkas tidak dapat dieksekusi.'); }
    return resolved;
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(executable)) {
    throw new Error('Nama executable mengandung karakter tidak aman.');
  }
  return executable;
}

export function executeSafe(executable, args = []) {
  const command = assertSafeExecutable(executable);
  if (!Array.isArray(args)) throw new Error('Argumen proses tidak valid.');
  for (const arg of args) {
    if (typeof arg !== 'string' || arg.includes('\0')) {
      throw new Error('Argumen proses tidak valid.');
    }
  }
  return command;
}

export function cleanString(value, { min = 0, max = 500, field = 'Input', required = false } = {}) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (required && text.length < Math.max(1, min)) {
    throw new Error(`${field} wajib diisi.`);
  }
  if (text.length < min) throw new Error(`${field} minimal ${min} karakter.`);
  if (text.length > max) throw new Error(`${field} maksimal ${max} karakter.`);
  if (text.includes('\0')) throw new Error(`${field} mengandung karakter tidak valid.`);
  return text;
}

export function cleanOptionalId(value, field = 'ID') {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value);
  if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(text)) throw new Error(`${field} tidak valid.`);
  return text;
}

export function cleanDepartment(value) {
  const allowed = ['Development', 'Research', 'Design', 'Quality Assurance', 'Marketing', 'Operasional'];
  if (!allowed.includes(value)) throw new Error('Divisi tidak valid.');
  return value;
}

export function cleanPriority(value) {
  const allowed = ['Rendah', 'Normal', 'Tinggi', 'Kritis'];
  const priority = value || 'Normal';
  if (!allowed.includes(priority)) throw new Error('Prioritas tidak valid.');
  return priority;
}

export function sanitizeModel(value) {
  if (value === undefined || value === null || value === '') return '';
  const text = String(value).trim();
  if (text.length > 160) throw new Error('Nama model terlalu panjang.');
  if (!/^[a-zA-Z0-9._:/@+-]*$/.test(text)) throw new Error('Nama model mengandung karakter tidak valid.');
  return text;
}

export function parseExtraArgs(value) {
  if (value === undefined || value === null || value === '') return [];
  let array = value;
  if (typeof value === 'string') {
    try { array = JSON.parse(value); } catch { throw new Error('Argumen tambahan harus berupa array JSON.'); }
  }
  if (!Array.isArray(array)) throw new Error('Argumen tambahan harus berupa array.');
  if (array.length > 30) throw new Error('Argumen tambahan terlalu banyak.');
  return array.map((item) => {
    const text = String(item);
    if (text.length > 300) throw new Error('Argumen terlalu panjang.');
    if (text.includes('\0') || text.includes('\n')) throw new Error('Argumen mengandung karakter tidak valid.');
    return text;
  });
}
