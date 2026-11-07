/* ============================ CONNECTIONS ============================ */
function renderConnections() {
  const engines = realEngines();
  const simulation = state.engines.find((engine) => engine.type === 'simulation');
  setView(`
    ${pageHead('AI Connections', 'Hubungkan OpenCode CLI dan Hermes Agent CLI. Status mesin menentukan apakah proyek berjalan NYATA atau SIMULASI.',
      '<button class="btn" id="refresh-engines">Muat Ulang Status</button>')}
    <div class="grid grid-2">
      ${engines.map(engineCard).join('') || '<div class="empty-state" style="grid-column:1/-1">Tidak ada mesin nyata yang dikonfigurasi.</div>'}
    </div>
    ${engines.some((engine) => engine.type === 'hermes' && !isEngineConnected(engine)) ? `
      <div class="warning-box" style="margin-top:14px">
        <strong>Hermes Agent CLI belum terhubung.</strong> Pasang Hermes atau isi executable dan template argumen eksekusi.
        Tanpa konfigurasi yang benar, agen Hermes hanya dapat dipakai pada proyek SIMULASI.
      </div>` : ''}
    <div class="grid grid-2" style="margin-top:14px">
      <div class="panel">
        <div class="panel-head"><div><h3>Cara Kerja Koneksi</h3></div></div>
        <div class="info-box">
          <p><strong>OpenCode</strong> dijalankan sebagai proses lokal dengan perintah <span class="mono">opencode run --dir &lt;workdir&gt; ...</span>.
          Model dapat diatur per agen. Auto-approve hanya dipakai jika diaktifkan eksplisit.</p>
          <p style="margin-top:8px"><strong>Hermes</strong> memakai template argumen yang dapat disesuaikan dengan placeholder
          <span class="mono">{prompt}</span>, <span class="mono">{model}</span>, dan <span class="mono">{dir}</span>.
          Periksa <span class="mono">--help</span> Hermes sebelum mengisi template.</p>
          <p style="margin-top:8px">Tes koneksi menjalankan probe versi/model dan opsional prompt singkat. Log ditampilkan dengan rahasia diredaksi.</p>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h3>Mesin Simulasi</h3><div class="panel-sub">Selalu tersedia untuk demo lokal</div></div>
          ${engineBadge(simulation)}</div>
        <div class="info-box">
          Mesin simulasi menghasilkan rencana, hasil tugas, dan laporan palsu yang <strong>selalu ditandai SIMULASI</strong>.
          Mode ini tidak memanggil model AI dan tidak boleh disajikan sebagai pekerjaan nyata.
        </div>
        <div class="note-strip">Gunakan mode NYATA hanya setelah tes koneksi berhasil dan seluruh agen dalam proyek memakai mesin terhubung.</div>
      </div>
    </div>
    <div class="note-strip" style="margin-top:14px">Perubahan executable akan memvalidasi path/perintah. Aplikasi tidak menyediakan shell arbitrer; hanya mesin AI terdaftar yang dapat menjalankan proses.</div>
  `);
  document.getElementById('refresh-engines').addEventListener('click', async () => {
    try {
      await loadBootstrap();
      updateChrome();
      renderConnections();
      toast('Status mesin dimuat ulang.', 'success');
    } catch (error) { toast(error.message, 'error'); }
  });
  viewEl.querySelectorAll('[data-engine-detect]').forEach((button) => {
    button.addEventListener('click', () => detectEngine(button.dataset.engineDetect));
  });
  viewEl.querySelectorAll('[data-engine-test]').forEach((button) => {
    button.addEventListener('click', () => openEngineTest(button.dataset.engineTest));
  });
  viewEl.querySelectorAll('[data-engine-config]').forEach((button) => {
    button.addEventListener('click', () => openEngineConfig(button.dataset.engineConfig));
  });
  viewEl.querySelectorAll('[data-engine-history]').forEach((button) => {
    button.addEventListener('click', () => openEngineHistory(button.dataset.engineHistory));
  });
}

function engineCard(engine) {
  const connected = isEngineConnected(engine);
  const result = connResults.get(engine.id);
  const config = engine.config || {};
  const lastChecked = engine.last_checked ? timeAgo(engine.last_checked) : 'belum pernah';
  return `<article class="engine-card ${connected ? 'connected' : engine.status === 'Gagal tes' ? 'error' : ''}">
    <div class="engine-head">
      <div class="ei">${engine.type === 'opencode' ? '⌨️' : '⚡'}</div>
      <div class="info">
        <div class="en">${esc(engine.label)}</div>
        <div class="es">${esc(engine.type)} · ${engine.agent_count || 0} agen · terakhir diperiksa ${esc(lastChecked)}</div>
      </div>
      ${statusBadge(engine.status || 'Belum diperiksa')}
    </div>
    <div class="kv">
      <span class="k">Executable</span><span class="v mono tiny">${esc(engine.executable || 'otomatis / belum diatur')}</span>
      <span class="k">Versi</span><span class="v mono">${esc(engine.version || '-')}</span>
      <span class="k">Model</span><span class="v">${engine.models?.length ? `${engine.models.length} model terdeteksi` : 'belum terdeteksi'}</span>
      <span class="k">Timeout</span><span class="v mono">${esc(config.timeoutMs || 600000)} ms</span>
      ${engine.type === 'opencode' ? `<span class="k">Auto-approve</span><span class="v">${config.autoApprove ? 'aktif' : 'nonaktif'}</span>` : `
        <span class="k">Template run</span><span class="v mono tiny">${esc((config.runArgs || []).join(' ') || 'belum diisi')}</span>`}
    </div>
    ${engine.models?.length ? `<div class="row" style="gap:4px;margin-top:8px">${engine.models.slice(0, 5).map((model) => `<span class="tag mono">${esc(model)}</span>`).join('')}${engine.models.length > 5 ? `<span class="tiny dim">+${engine.models.length - 5}</span>` : ''}</div>` : ''}
    ${result ? `<div class="${result.ok ? 'info-box' : 'danger-box'}" style="margin-top:9px">
      <strong>${esc(result.status)}</strong> — ${esc(result.message)}
      ${result.logs ? `<details style="margin-top:6px"><summary class="tiny">Lihat log tes</summary><div class="log-box">${esc(result.logs)}</div></details>` : ''}
    </div>` : ''}
    <div class="row" style="margin-top:11px">
      <button class="btn btn-sm btn-primary" data-engine-test="${esc(engine.id)}">Uji Koneksi</button>
      <button class="btn btn-sm" data-engine-detect="${esc(engine.id)}">Deteksi</button>
      <button class="btn btn-sm" data-engine-config="${esc(engine.id)}">Konfigurasi</button>
      <button class="btn btn-sm" data-engine-history="${esc(engine.id)}">Riwayat Tes</button>
    </div>
  </article>`;
}

async function detectEngine(engineId) {
  const engine = engineById(engineId);
  if (!engine) return;
  try {
    const data = await api(`/api/engines/${engineId}/detect`, { method: 'POST' });
    await loadBootstrap();
    updateChrome();
    renderConnections();
    const found = data.detected?.executable;
    toast(found ? `Executable ditemukan: ${found}` : 'Executable tidak ditemukan otomatis.', found ? 'success' : 'warn');
  } catch (error) { toast(error.message, 'error'); }
}

function openEngineTest(engineId) {
  const engine = engineById(engineId);
  if (!engine) return;
  const defaultModel = state.agents.find((agent) => agent.engine_id === engineId && agent.model)?.model
    || engine.models?.[0] || '';
  const modelOptions = [...new Set([defaultModel, ...(engine.models || [])].filter(Boolean))];
  const ref = openModal({
    title: `Uji Koneksi — ${engine.label}`,
    wide: true,
    body: `<div class="info-box">Tes akan menjalankan probe versi dan opsional prompt singkat menggunakan executable mesin. Proses dapat memakan waktu hingga timeout konfigurasi.</div>
      <form id="engine-test-form" class="stack" style="margin-top:12px">
        <label class="field"><span>Model (opsional)</span>
          <input name="model" list="engine-test-models" value="${esc(defaultModel)}" placeholder="mis. opencode/deepseek-v4.1-flash-free">
          <datalist id="engine-test-models">${modelOptions.map((model) => `<option value="${esc(model)}">`).join('')}</datalist>
        </label>
        <label class="field"><span>Prompt tes (opsional)</span>
          <textarea name="prompt" rows="2" maxlength="500" placeholder="Kosongkan untuk hanya probe versi">Balas hanya dengan kata: SIAP</textarea>
        </label>
        <div id="engine-test-result"></div>
      </form>`,
    footer: `<button class="btn btn-ghost" data-close>Tutup</button><button class="btn btn-primary" id="engine-test-run">Jalankan Tes</button>`,
  });
  ref.footer.querySelector('#engine-test-run').addEventListener('click', async () => {
    const form = ref.modal.querySelector('#engine-test-form');
    const button = ref.footer.querySelector('#engine-test-run');
    const resultBox = ref.modal.querySelector('#engine-test-result');
    const model = form.elements.model.value.trim();
    const prompt = form.elements.prompt.value.trim();
    button.disabled = true;
    button.textContent = 'Menguji...';
    resultBox.innerHTML = '<div class="loading-block" style="padding:18px"><div class="pixel-spinner"></div><span>Menjalankan tes koneksi...</span></div>';
    try {
      const data = await api(`/api/engines/${engineId}/test`, { method: 'POST', body: { model, prompt } });
      connResults.set(engineId, data.result);
      resultBox.innerHTML = `<div class="${data.result.ok ? 'info-box' : 'danger-box'}" style="margin-top:8px">
        <strong>${esc(data.result.status)}</strong> — ${esc(data.result.message)}
        ${data.result.version ? `<div class="tiny mono" style="margin-top:4px">versi: ${esc(data.result.version)}</div>` : ''}
        ${data.result.logs ? `<details style="margin-top:8px"><summary class="tiny">Log lengkap</summary><div class="log-box">${esc(data.result.logs)}</div></details>` : ''}
        ${data.result.help ? `<details style="margin-top:6px"><summary class="tiny">Bantuan executable</summary><div class="log-box">${esc(data.result.help)}</div></details>` : ''}
      </div>`;
      await loadBootstrap();
      updateChrome();
      renderConnections();
      button.textContent = 'Tes Lagi';
      toast(data.result.ok ? 'Koneksi berhasil diuji.' : `Tes selesai: ${data.result.status}`, data.result.ok ? 'success' : 'warn');
    } catch (error) {
      resultBox.innerHTML = `<div class="danger-box" style="margin-top:8px">${esc(error.message)}</div>`;
      button.textContent = 'Coba Lagi';
      toast(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  });
}

function openEngineConfig(engineId) {
  const engine = engineById(engineId);
  if (!engine) return;
  const config = engine.config || {};
  const opencodeFields = `
    <label class="field"><span>Timeout (ms)</span><input name="timeoutMs" type="number" min="10000" max="3600000" value="${esc(config.timeoutMs || 600000)}"></label>
    <label class="field span-2 checkbox-field"><span>Mode otomatis</span>
      <label class="row tiny"><input type="checkbox" name="autoApprove" ${config.autoApprove ? 'checked' : ''}> Aktifkan auto-approve OpenCode (hanya jika didukung)</label>
    </label>
    <label class="field span-2"><span>Argumen tambahan (satu per baris)</span><textarea name="extraArgs" rows="3">${esc((config.extraArgs || []).join('\n'))}</textarea></label>`;
  const hermesFields = `
    <label class="field"><span>Timeout (ms)</span><input name="timeoutMs" type="number" min="10000" max="3600000" value="${esc(config.timeoutMs || 600000)}"></label>
    <label class="field"><span>Argumen versi</span><input name="versionArgs" value="${esc((config.versionArgs || ['--version']).join(' '))}"></label>
    <label class="field"><span>Argumen bantuan</span><input name="helpArgs" value="${esc((config.helpArgs || ['--help']).join(' '))}"></label>
    <label class="field span-2"><span>Argumen eksekusi (satu per baris, placeholder {prompt} {model} {dir})</span>
      <textarea name="runArgs" rows="4" placeholder="run&#10;--prompt&#10;{prompt}">${esc((config.runArgs || []).join('\n'))}</textarea></label>
    <label class="field"><span>Flag model</span><input name="modelFlag" value="${esc(config.modelFlag || '')}" placeholder="mis. --model"></label>
    <label class="field"><span>Flag direktori</span><input name="dirFlag" value="${esc(config.dirFlag || '')}" placeholder="mis. --dir"></label>
    <label class="field"><span>Flag auto-approve</span><input name="autoApproveFlag" value="${esc(config.autoApproveFlag || '')}" placeholder="mis. --yes"></label>
    <label class="field"><span>Argumen tambahan</span><input name="extraArgs" value="${esc((config.extraArgs || []).join(' '))}"></label>`;
  const ref = openModal({
    title: `Konfigurasi — ${engine.label}`,
    wide: true,
    body: `<form id="engine-config-form" class="form-grid">
      <label class="field"><span>Nama mesin</span><input name="label" required maxlength="60" value="${esc(engine.label)}"></label>
      <label class="field"><span>Executable</span><input name="executable" maxlength="500" value="${esc(engine.executable || '')}" placeholder="otomatis / path lengkap"></label>
      ${engine.type === 'opencode' ? opencodeFields : hermesFields}
      <label class="field span-2"><span>Daftar model (satu per baris; dapat diperbarui otomatis oleh tes)</span>
        <textarea name="models" rows="4">${esc((engine.models || []).join('\n'))}</textarea></label>
      <div class="note-strip span-2">Argumen dijalankan tanpa shell. Jangan menambahkan karakter berbahaya. Setelah menyimpan, lakukan tes koneksi.</div>
    </form>`,
    footer: `<button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-primary" id="engine-config-save">Simpan Konfigurasi</button>`,
  });
  ref.footer.querySelector('#engine-config-save').addEventListener('click', async () => {
    const form = ref.modal.querySelector('#engine-config-form');
    if (!form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form).entries());
    const lines = (value) => String(value || '').split('\n').map((line) => line.trim()).filter(Boolean);
    const words = (value) => String(value || '').trim().split(/\s+/).filter(Boolean);
    const config = { timeoutMs: Number(values.timeoutMs || 600000) };
    if (engine.type === 'opencode') {
      config.autoApprove = form.elements.autoApprove.checked;
      config.extraArgs = lines(values.extraArgs);
    } else {
      config.versionArgs = words(values.versionArgs);
      config.helpArgs = words(values.helpArgs);
      config.runArgs = lines(values.runArgs);
      config.modelFlag = values.modelFlag || '';
      config.dirFlag = values.dirFlag || '';
      config.autoApproveFlag = values.autoApproveFlag || '';
      config.extraArgs = words(values.extraArgs);
      config.models = lines(values.models);
    }
    const button = ref.footer.querySelector('#engine-config-save');
    button.disabled = true;
    try {
      await api(`/api/engines/${engine.id}`, { method: 'PATCH', body: {
        label: values.label, executable: values.executable, config, models: lines(values.models),
      } });
      ref.close();
      await loadBootstrap();
      updateChrome();
      renderConnections();
      toast('Konfigurasi mesin disimpan. Lakukan tes koneksi.', 'success');
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
    }
  });
}

async function openEngineHistory(engineId) {
  const engine = engineById(engineId);
  if (!engine) return;
  try {
    const tests = await api(`/api/engines/${engineId}/tests`);
    openModal({
      title: `Riwayat Tes — ${engine.label}`,
      wide: true,
      body: tests.length ? `<div class="stack">${tests.map((test) => `
        <div class="panel tight">
          <div class="row" style="justify-content:space-between"><div class="row">${statusBadge(test.status)}
            <span class="tiny muted">${esc(fmtDate(test.created_at))}</span></div>
            <span class="badge ${test.ok ? 'green' : 'red'}">${test.ok ? 'OK' : 'GAGAL'}</span></div>
          <div class="small" style="margin-top:6px">${esc(test.message)}</div>
          ${test.logs ? `<details style="margin-top:6px"><summary class="tiny">Log</summary><div class="log-box">${esc(test.logs)}</div></details>` : ''}
        </div>`).join('')}</div>` : '<div class="empty-state">Belum ada riwayat tes.</div>',
      footer: '<button class="btn btn-ghost" data-close>Tutup</button>',
    });
  } catch (error) { toast(error.message, 'error'); }
}
