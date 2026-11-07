import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SIMULATION_LABEL, simulatePlan, simulateTaskOutput, simulateReport, simulateMeetingSummary,
} from '../src/simulation.js';

test('rencana simulasi memilih divisi yang relevan untuk proyek web', () => {
  const plan = simulatePlan('Buatkan website toko online dengan desain dan promosi');
  const departments = plan.map((item) => item.department);
  assert.ok(plan.length >= 4);
  assert.ok(departments.includes('Research'));
  assert.ok(departments.includes('Design'));
  assert.ok(departments.includes('Development'));
  assert.ok(departments.includes('Marketing'));
  assert.ok(departments.includes('Quality Assurance'));
  for (const item of plan) {
    assert.ok(item.title.length > 8);
    assert.ok(item.description.length > 20);
    assert.ok(['Rendah', 'Normal', 'Tinggi', 'Kritis'].includes(item.priority));
  }
});

test('hasil tugas simulasi selalu diberi label yang jelas', () => {
  const output = simulateTaskOutput(
    { title: 'Implementasi halaman', department: 'Development', description: 'Buat halaman utama' },
    { name: 'Dimas', role: 'Programmer' },
  );
  assert.match(output, /SIMULASI/);
  assert.match(output, /bukan oleh OpenCode\/Hermes/);
  assert.match(output, /Dimas/);
});

test('laporan simulasi memuat status setiap tugas dan peringatan mode', () => {
  const report = simulateReport(
    { title: 'Proyek Uji', instruction: 'Instruksi uji', mode: SIMULATION_LABEL },
    [
      { title: 'Riset', status: 'Selesai', department: 'Research', assignee_name: 'Maya' },
      { title: 'Implementasi', status: 'Dalam pemeriksaan', department: 'Development', assignee_name: 'Dimas' },
    ],
  );
  assert.match(report, /Proyek   : Proyek Uji/);
  assert.match(report, /\[Selesai\] Riset/);
  assert.match(report, /\[Dalam pemeriksaan\] Implementasi/);
  assert.match(report, /SIMULASI/);
});

test('ringkasan rapat simulasi memuat peserta dan tindak lanjut', () => {
  const summary = simulateMeetingSummary('Sinkronisasi', 'Peluncuran produk', ['Sinta', 'Dimas']);
  assert.match(summary, /Sinkronisasi/);
  assert.match(summary, /Sinta, Dimas/);
  assert.match(summary, /Tindak lanjut/);
  assert.match(summary, /SIMULASI/);
});
