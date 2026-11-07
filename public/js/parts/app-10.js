/* ============================ SETTINGS ============================ */
function renderSettings() {
  const company = state.company || {};
  const settings = state.settings || {};
  setView(`
    ${pageHead('Settings', 'Profil perusahaan, preferensi operasional, dan pengelolaan data lokal.',
      '<button class="btn" data-go="#/connections">Status Mesin</button>')}
    <div class="grid grid-2">
      <div class="panel">
        <div class="panel-head"><div><h3>Profil Perusahaan</h3><div class="panel-sub">Tampil pada dashboard dan kantor virtual</div></div></div>
        <form id="company-form" class="form-grid">
          <label class="field"><span>Nama perusahaan</span><input name="name" required maxlength="80" value="${esc(company.name || '')}"></label>
          <label class="field"><span>Avatar perusahaan</span><input name="avatar" required maxlength="8" value="${esc(company.avatar || '🏢')}"></label>
          <label class="field"><span>Nama CEO</span><input name="ceo_name" required maxlength="80" value="${esc(company.ceo_name || '')}"></label>
          <label class="field"><span>Avatar CEO</span><input name="ceo_avatar" required maxlength="8" value="${esc(company.ceo_avatar || '👑')}"></label>
          <label class="field span-2"><span>Tagline</span><input name="tagline" maxlength="160" value="${esc(company.tagline || '')}"></label>
          <label class="field span-2"><span>Profil perusahaan</span><textarea name="description" rows="3" maxlength="2000">${esc(company.description || '')}</textarea></label>
          <label class="field span-2"><span>Saldo penggunaan model (teks bebas, bukan rahasia)</span><input name="model_balance" maxlength="80" value="${esc(company.model_balance || '')}" placeholder="contoh: 72% tersisa"></label>
          <div class="row span-2"><button class="btn btn-primary" type="submit">Simpan Profil</button></div>
        </form>
      </div>
      <div class="stack">
        <div class="panel">
          <div class="panel-head"><div><h3>Preferensi Operasional</h3><div class="panel-sub">Perubahan berlaku pada eksekusi berikutnya</div></div></div>
          <form id="settings-form" class="form-grid">
            <label class="field"><span>Tema</span><select name="theme">
              <option value="dark" ${settings.theme !== 'light' ? 'selected' : ''}>Gelap (pixel dark)</option>
              <option value="light" ${settings.theme === 'light' ? 'selected' : ''}>Terang</option>
            </select></label>
            <label class="field"><span>Mode default proyek</span><select name="defaultMode">
              <option value="auto" ${settings.defaultMode === 'auto' || !settings.defaultMode ? 'selected' : ''}>Otomatis</option>
              <option value="nyata" ${settings.defaultMode === 'nyata' ? 'selected' : ''}>Wajib NYATA</option>
              <option value="simulasi" ${settings.defaultMode === 'simulasi' ? 'selected' : ''}>SIMULASI</option>
            </select></label>
            <label class="field"><span>Batas proses paralel (1-5)</span><input name="concurrency" type="number" min="1" max="5" value="${esc(settings.concurrency || 2)}"></label>
            <label class="field"><span>Batas waktu tugas (ms)</span><input name="taskTimeoutMs" type="number" min="10000" max="3600000" step="1000" value="${esc(settings.taskTimeoutMs || 600000)}"></label>
            <label class="field"><span>Suara kantor</span><select name="officeSound">
              <option value="off" ${settings.officeSound !== 'on' ? 'selected' : ''}>Nonaktif</option>
              <option value="on" ${settings.officeSound === 'on' ? 'selected' : ''}>Aktif</option>
            </select></label>
            <div class="row" style="align-items:flex-end"><button class="btn btn-primary" type="submit">Simpan Preferensi</button></div>
          </form>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h3>Informasi Runtime</h3></div><span class="badge gray">lokal</span></div>
          <div class="kv">
            <span class="k">Workspace</span><span class="v mono tiny">${esc(state.workspaceRoot || '-')}</span>
            <span class="k">Database</span><span class="v mono tiny">data/pixel-office.db (SQLite)</span>
            <span class="k">Server</span><span class="v mono tiny">http://127.0.0.1:3000</span>
            <span class="k">Realtime</span><span class="v">${state.connection === 'online' ? statusBadge('Terhubung') : '<span class="badge red">Terputus</span>'}</span>
            <span class="k">Agen</span><span class="v">${state.agents.length} terdaftar · ${state.agents.filter((agent) => agent.active).length} aktif</span>
            <span class="k">Proyek</span><span class="v">${state.projects.length} terbaru dimuat</span>
          </div>
        </div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:14px">
      <div class="panel">
        <div class="panel-head"><div><h3>Backup Data</h3><div class="panel-sub">Ekspor seluruh tabel SQLite ke JSON</div></div></div>
        <div class="info-box">Backup mencakup pengaturan, perusahaan, mesin, agen, proyek, tugas, delegasi, eksekusi, log, laporan, rapat, aktivitas, persetujuan, dan riwayat tes mesin.</div>
        <div class="row" style="margin-top:10px">
          <button class="btn btn-primary" id="backup-download">Unduh Backup JSON</button>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h3>Pulihkan Data</h3><div class="panel-sub">Mengganti seluruh data dengan isi backup</div></div></div>
        <div class="warning-box">Restore akan menghapus data saat ini dan menggantinya. Hentikan semua eksekusi sebelum memulihkan. Tindakan ini tidak dapat dibatalkan.</div>
        <div class="row" style="margin-top:10px">
          <input type="file" id="restore-file" accept="application/json,.json">
          <button class="btn btn-danger" id="restore-run" disabled>Pulihkan</button>
        </div>
      </div>
    </div>
    <div class="note-strip" style="margin-top:14px">
      <strong>Keamanan:</strong> aplikasi berjalan lokal, tidak menyimpan API key, dan meredaksi pola rahasia pada log.
      Jangan menjalankan server pada jaringan publik tanpa autentikasi tambahan.
    </div>
  `);
  bindGoButtons(viewEl);
  document.getElementById('company-form').addEventListener('submit', saveCompany);
  document.getElementById('settings-form').addEventListener('submit', saveSettings);
  document.getElementById('backup-download').addEventListener('click', () => {
    const link = document.createElement('a');
    link.href = '/api/backup';
    link.download = 'pixel-office-backup.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
  });
  const restoreInput = document.getElementById('restore-file');
  const restoreButton = document.getElementById('restore-run');
  let restoreData = null;
  restoreInput.addEventListener('change', async () => {
    restoreData = null;
    restoreButton.disabled = true;
    const file = restoreInput.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { toast('Berkas backup terlalu besar (maks 25 MB).', 'error'); return; }
    try {
      restoreData = JSON.parse(await file.text());
      restoreButton.disabled = false;
      toast('Berkas backup valid. Periksa peringatan sebelum memulihkan.', 'info');
    } catch { toast('Berkas bukan JSON yang valid.', 'error'); }
  });
  restoreButton.addEventListener('click', async () => {
    if (!restoreData) return;
    const confirmed = await confirmDialog({
      title: 'Pulihkan Data',
      message: 'Seluruh data saat ini akan diganti dengan isi backup. Tindakan ini tidak dapat dibatalkan. Lanjutkan?',
      confirmLabel: 'Pulihkan Sekarang', danger: true,
    });
    if (!confirmed) return;
    try {
      await api('/api/restore', { method: 'POST', body: restoreData });
      toast('Data berhasil dipulihkan. Memuat ulang...', 'success');
      setTimeout(() => window.location.reload(), 800);
    } catch (error) { toast(error.message, 'error'); }
  });
}

async function saveCompany(event) {
  event.preventDefault();
  const form = event.target;
  const values = Object.fromEntries(new FormData(form).entries());
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api('/api/company', { method: 'PATCH', body: values });
    await loadBootstrap();
    updateChrome();
    toast('Profil perusahaan disimpan.', 'success');
    renderSettings();
  } catch (error) {
    toast(error.message, 'error');
    button.disabled = false;
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const form = event.target;
  const values = Object.fromEntries(new FormData(form).entries());
  const body = {
    theme: values.theme,
    defaultMode: values.defaultMode,
    concurrency: Number(values.concurrency),
    taskTimeoutMs: Number(values.taskTimeoutMs),
    officeSound: values.officeSound,
  };
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api('/api/settings', { method: 'PATCH', body });
    await loadBootstrap();
    applyTheme();
    updateChrome();
    toast('Preferensi disimpan.', 'success');
    renderSettings();
  } catch (error) {
    toast(error.message, 'error');
    button.disabled = false;
  }
}

/* ============================ BOOT ============================ */
main();
