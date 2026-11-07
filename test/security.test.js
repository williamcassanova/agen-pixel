import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertSafeWorkdir, ensureWorkdir, assertSafeExecutable, executeSafe,
  redactSecrets, cleanString, sanitizeModel, cleanDepartment, parseExtraArgs, isWithin,
} from '../src/security.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-office-security-'));

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('workdir harus berada di dalam root yang diizinkan', () => {
  assert.throws(() => assertSafeWorkdir('/etc', root), /workspace/);
  const inside = ensureWorkdir(path.join(root, 'development'), root);
  assert.equal(inside, path.join(root, 'development'));
  assert.ok(fs.statSync(inside).isDirectory());
  assert.equal(isWithin(root, inside), true);
  assert.equal(isWithin(root, '/etc'), false);
});

test('executable ditolak jika mengandung karakter shell berbahaya', () => {
  assert.throws(() => assertSafeExecutable('rm -rf /'), /tidak aman/);
  assert.throws(() => assertSafeExecutable('opencode\nwhoami'), /tidak valid/);
  assert.equal(assertSafeExecutable('opencode'), 'opencode');
  assert.equal(executeSafe('opencode', ['run', 'prompt aman']), 'opencode');
  assert.throws(() => executeSafe('opencode', [42]), /Argumen/);
});

test('rahasia diredaksi dari log', () => {
  const redacted = redactSecrets('api_key=rahasia123 token: abcdef123456 Bearer abcdefgh12345678 OPENAI_API_KEY=kunci-rahasia');
  assert.match(redacted, /\[REDACTED\]/);
  assert.doesNotMatch(redacted, /rahasia123|abcdef123456|abcdefgh12345678|kunci-rahasia/);
});

test('validasi input dan model', () => {
  assert.equal(cleanString('  Halo  ', { field: 'Teks' }), 'Halo');
  assert.throws(() => cleanString('', { required: true, field: 'Nama' }), /wajib diisi/);
  assert.equal(sanitizeModel('opencode/deepseek-v4.1-flash-free'), 'opencode/deepseek-v4.1-flash-free');
  assert.throws(() => sanitizeModel('model dengan spasi'), /tidak valid/);
  assert.equal(cleanDepartment('Development'), 'Development');
  assert.throws(() => cleanDepartment('Finance'), /Divisi tidak valid/);
  assert.deepEqual(parseExtraArgs('["--json","--fast"]'), ['--json', '--fast']);
  assert.throws(() => parseExtraArgs('bukan-json'), /array JSON/);
});
