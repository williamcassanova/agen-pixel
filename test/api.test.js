import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-office-api-'));
process.env.PIXEL_OFFICE_DATA = path.join(tmpRoot, 'data');
process.env.PIXEL_OFFICE_WORKSPACES = path.join(tmpRoot, 'workspaces');
process.env.PIXEL_OFFICE_DB = path.join(tmpRoot, 'data', 'test.db');

const { createApp } = await import('../server.js');
const { closeDb } = await import('../src/db.js');

let app;
let base;
let bootstrap;
let projectId;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(route, { method = 'GET', body } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  return { response, data };
}

async function waitForProject(id, expected, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    const { data } = await request(`/api/projects/${id}`);
    last = data;
    if (expected.includes(data.status)) return data;
    await sleep(350);
  }
  throw new Error(`Proyek tidak mencapai status ${expected.join('/')} (terakhir: ${last?.status})`);
}

test.before(async () => {
  app = await createApp({ refreshEngines: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  base = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  app.manager.shutdown();
  app.server.closeAllConnections?.();
  await new Promise((resolve) => app.server.close(resolve));
  closeDb();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('health dan bootstrap menyediakan data awal yang konsisten', async () => {
  const health = await request('/api/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.data.ok, true);

  const { response, data } = await request('/api/bootstrap');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy') || '', /default-src 'self'/);
  bootstrap = data;
  assert.equal(data.company.name, 'Pixel Office AI');
  assert.equal(data.company.ceo_name, 'Budi Santoso');
  assert.equal(data.agents.length, 23);
  assert.equal(data.agents.filter((agent) => agent.active).length, 23);
  assert.equal(data.engines.length, 3);
  assert.ok(data.engines.some((engine) => engine.id === 'engine-simulation'));
  assert.ok(data.engines.some((engine) => engine.id === 'engine-opencode'));
  assert.ok(data.engines.some((engine) => engine.id === 'engine-hermes'));
  const engineIds = new Set(data.engines.map((engine) => engine.id));
  for (const agent of data.agents) {
    assert.ok(engineIds.has(agent.engine_id), `${agent.name} memakai engine_id tidak valid: ${agent.engine_id}`);
  }
  assert.equal(data.engines.find((engine) => engine.id === 'engine-opencode').agent_count, 22);
  assert.equal(data.engines.find((engine) => engine.id === 'engine-hermes').agent_count, 1);
  assert.equal(data.agents.find((agent) => agent.role === 'Secretary AI').engine_id, 'engine-opencode');
  assert.equal(data.workspace_root, process.env.PIXEL_OFFICE_WORKSPACES);
  assert.ok(data.departments.length === 6);

  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Pixel Office AI/);
  const script = await fetch(`${base}/js/app.js`);
  assert.equal(script.status, 200);
  assert.match(await script.text(), /main\(\);/);
});

test('perintah SIMULASI berjalan sampai laporan dan persetujuan CEO', { timeout: 60000 }, async () => {
  const created = await request('/api/commands', {
    method: 'POST',
    body: {
      instruction: 'Buatkan website toko online dengan desain, implementasi, pengujian, dan promosi.',
      mode: 'simulasi',
      engineId: 'engine-simulation',
    },
  });
  assert.equal(created.response.status, 202);
  projectId = created.data.id;
  assert.equal(created.data.mode, 'SIMULASI');

  const detail = await waitForProject(projectId, ['Memerlukan persetujuan CEO', 'Gagal', 'Dibatalkan']);
  assert.equal(detail.status, 'Memerlukan persetujuan CEO');
  assert.equal(detail.mode, 'SIMULASI');
  assert.equal(detail.planning_engine_id, 'engine-simulation');
  assert.ok(detail.tasks.length >= 5);
  assert.ok(detail.executions.length >= 5);
  assert.ok(detail.delegations.length >= 1);
  assert.ok(detail.report);
  assert.equal(detail.report.mode, 'SIMULASI');
  assert.match(detail.report.body, /SIMULASI/);
  assert.match(detail.report.body, /bukan oleh OpenCode\/Hermes/);
  for (const execution of detail.executions) {
    assert.equal(execution.simulation, true);
    assert.equal(execution.status, 'Sukses');
  }
  for (const task of detail.tasks) {
    assert.ok(task.execution === null || task.execution.simulation === true);
  }

  const logs = await request(`/api/executions/${detail.executions[0].id}/logs`);
  assert.equal(logs.response.status, 200);
  assert.ok(logs.data.logs.length > 0);
  assert.equal(logs.data.execution.simulation, true);

  const approved = await request(`/api/projects/${projectId}/approve`, {
    method: 'POST',
    body: { decision: 'setuju', note: 'Disetujui dalam tes otomatis.' },
  });
  assert.equal(approved.response.status, 200);
  assert.equal(approved.data.status, 'Selesai');
  assert.equal(approved.data.approval_status, 'Disetujui');
  assert.equal(approved.data.done_count, approved.data.task_count);

  const reports = await request('/api/reports');
  assert.equal(reports.response.status, 200);
  assert.ok(reports.data.some((report) => report.id === detail.report.id && report.mode === 'SIMULASI'));
});

test('rapat dan pengaturan dapat dibuat serta memperbarui state', async () => {
  const secretary = bootstrap.agents.find((agent) => agent.role === 'Secretary AI');
  const coo = bootstrap.agents.find((agent) => agent.role === 'COO');
  const created = await request('/api/meetings', {
    method: 'POST',
    body: {
      title: 'Rapat sinkronisasi otomatis',
      agenda: 'Memverifikasi endpoint rapat dan status peserta.',
      attendees: [secretary.id, coo.id],
    },
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.data.mode, 'SIMULASI');
  assert.deepEqual(created.data.attendees, [secretary.id, coo.id]);

  const meetings = await request('/api/meetings');
  assert.ok(meetings.data.some((meeting) => meeting.id === created.data.id));

  const patched = await request('/api/settings', {
    method: 'PATCH',
    body: { concurrency: 4, theme: 'light', defaultMode: 'simulasi' },
  });
  assert.equal(patched.response.status, 200);
  assert.equal(patched.data.concurrency, '4');
  assert.equal(patched.data.theme, 'light');
  assert.equal(patched.data.defaultMode, 'simulasi');

  const invalid = await request('/api/settings', { method: 'PATCH', body: { concurrency: 99 } });
  assert.equal(invalid.response.status, 400);
  assert.match(invalid.data.error, /1-5/);

  await request('/api/settings', {
    method: 'PATCH',
    body: { concurrency: 2, theme: 'dark', defaultMode: 'auto' },
  });
});

test('backup dan restore mempertahankan data', { timeout: 30000 }, async () => {
  const backup = await request('/api/backup');
  assert.equal(backup.response.status, 200);
  assert.equal(backup.data.app, 'Pixel Office AI');
  for (const table of ['agents', 'projects', 'tasks', 'executions', 'reports', 'meetings', 'settings']) {
    assert.ok(Array.isArray(backup.data.tables[table]), `tabel ${table} hilang`);
  }

  const restored = await request('/api/restore', { method: 'POST', body: backup.data });
  assert.equal(restored.response.status, 200);
  assert.equal(restored.data.ok, true);

  const after = await request('/api/bootstrap');
  assert.equal(after.data.agents.length, bootstrap.agents.length);
  assert.ok(after.data.projects.some((project) => project.id === projectId));
  assert.ok(after.data.reports.length >= 2);
});

test('proyek yang sedang berjalan dapat dibatalkan CEO', { timeout: 30000 }, async () => {
  const created = await request('/api/commands', {
    method: 'POST',
    body: {
      instruction: 'Susun rencana operasional dan riset pasar untuk produk baru.',
      mode: 'simulasi',
      engineId: 'engine-simulation',
    },
  });
  assert.equal(created.response.status, 202);
  await sleep(700);
  const cancelled = await request(`/api/projects/${created.data.id}/cancel`, {
    method: 'POST',
    body: { reason: 'Dibatalkan dalam tes otomatis.' },
  });
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.data.status, 'Dibatalkan');
  const detail = await request(`/api/projects/${created.data.id}`);
  assert.equal(detail.data.status, 'Dibatalkan');
  assert.ok(detail.data.tasks.every((task) => ['Dibatalkan', 'Selesai'].includes(task.status)
    || task.status === 'Selesai'));
});

test('input tidak valid ditolak dengan pesan yang jelas', async () => {
  const short = await request('/api/commands', { method: 'POST', body: { instruction: 'x', mode: 'simulasi' } });
  assert.equal(short.response.status, 400);
  assert.match(short.data.error, /wajib diisi|minimal/i);

  const badAgent = await request('/api/meetings', {
    method: 'POST',
    body: { title: 'Rapat uji', attendees: ['agen-tidak-ada'] },
  });
  assert.equal(badAgent.response.status, 400);

  const outside = await request('/api/agents', {
    method: 'POST',
    body: {
      name: 'Agen Uji', role: 'Tester', department: 'Development', avatar: '🧪',
      workdir: '/etc',
    },
  });
  assert.equal(outside.response.status, 400);
  assert.match(outside.data.error, /workspace/i);
});
