import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenCodeAdapter } from '../src/adapters/opencode.js';
import { HermesAdapter } from '../src/adapters/hermes.js';
import { isEngineConnected } from '../src/adapters/index.js';

test('OpenCode membangun argumen run dengan model, auto-approve, dan argumen tambahan', () => {
  const adapter = new OpenCodeAdapter({
    type: 'opencode', executable: 'opencode',
    config: JSON.stringify({ autoApprove: true, extraArgs: ['--fast'], timeoutMs: 120000 }),
  });
  assert.deepEqual(
    adapter.buildRunArgs({ prompt: 'Halo', model: 'opencode/model', workdir: '/tmp/work' }),
    ['run', '--dir', '/tmp/work', '-m', 'opencode/model', '--auto', '--fast', 'Halo'],
  );
});

test('OpenCode tanpa auto-approve tidak menambahkan flag --auto', () => {
  const adapter = new OpenCodeAdapter({
    type: 'opencode', executable: 'opencode',
    config: JSON.stringify({ autoApprove: false, extraArgs: [] }),
  });
  const args = adapter.buildRunArgs({ prompt: 'Tes', model: '', workdir: '/tmp/work' });
  assert.deepEqual(args, ['run', '--dir', '/tmp/work', 'Tes']);
});

test('Hermes mengisi placeholder dan flag konfigurasi', () => {
  const adapter = new HermesAdapter({
    type: 'hermes', executable: 'hermes',
    config: JSON.stringify({
      runArgs: ['run', '{prompt}'],
      modelFlag: '--model',
      dirFlag: '--dir',
      autoApproveFlag: '--yes',
      extraArgs: ['--json'],
      timeoutMs: 120000,
    }),
  });
  assert.deepEqual(
    adapter.buildRunArgs({ prompt: 'Halo', model: 'hermes-model', workdir: '/tmp/work' }),
    ['run', 'Halo', '--model', 'hermes-model', '--dir', '/tmp/work', '--yes', '--json'],
  );
});

test('status koneksi mesin dihitung dengan benar', () => {
  assert.equal(isEngineConnected({ type: 'simulation' }), true);
  assert.equal(isEngineConnected({ type: 'opencode', status: 'Terhubung' }), true);
  assert.equal(isEngineConnected({ type: 'opencode', status: 'Belum terhubung' }), false);
  assert.equal(isEngineConnected(null), false);
});
