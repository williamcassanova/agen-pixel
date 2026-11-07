/* ============================ MEETINGS ============================ */
function renderMeetings() {
  setView(`
    ${pageHead('Meetings', 'Ruang rapat virtual. Ringkasan rapat dibuat oleh mesin simulasi dan ditandai jelas.',
      '<button class="btn btn-primary" id="schedule-meeting">+ Jadwalkan Rapat</button>')}
    <div class="panel">
      <div class="panel-head"><div><h3>Riwayat Rapat</h3><div class="panel-sub">Peserta akan ditandai sedang rapat lalu kembali idle otomatis</div></div>
        <span class="badge gray">${state.meetings.length} rapat</span></div>
      <div class="meeting-grid" id="meeting-grid"></div>
    </div>
    <div class="note-strip" style="margin-top:14px"><strong>Catatan:</strong> ringkasan rapat saat ini menggunakan mesin simulasi. Tidak ada panggilan AI nyata pada fitur rapat.</div>
  `);
  document.getElementById('schedule-meeting').addEventListener('click', openMeetingForm);
  renderMeetingGrid();
}

function renderMeetingGrid() {
  const grid = document.getElementById('meeting-grid');
  if (!grid) return;
  if (!state.meetings.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="big">🪑</div><p>Belum ada rapat. Jadwalkan rapat pertama.</p></div>';
    return;
  }
  grid.innerHTML = state.meetings.map((meeting) => {
    const attendees = parseAttendees(meeting.attendees);
    return `<article class="meeting-card">
      <div class="row" style="justify-content:space-between"><div class="mt">${esc(meeting.title)}</div>
        ${statusBadge(meeting.status || 'Selesai')}</div>
      <div class="tiny muted" style="margin-top:3px">${esc(fmtDate(meeting.created_at))} · ${attendees.length} peserta · ${esc(meeting.mode || 'SIMULASI')}</div>
      <div class="row" style="gap:4px;margin-top:8px">${attendees.map((id) => {
        const agent = agentById(id);
        return `<span class="tag">${esc(agent?.avatar || '👤')} ${esc(agent?.name || id)}</span>`;
      }).join('') || '<span class="tiny dim">Tanpa peserta</span>'}</div>
      ${meeting.agenda ? `<div class="info-box" style="margin-top:8px"><strong>Agenda:</strong> ${esc(meeting.agenda)}</div>` : ''}
      <div class="meeting-summary">${esc(meeting.summary || 'Belum ada ringkasan.')}</div>
    </article>`;
  }).join('');
}

function parseAttendees(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function openMeetingForm() {
  const activeAgents = state.agents.filter((agent) => agent.active);
  const ref = openModal({
    title: 'Jadwalkan Rapat',
    wide: true,
    body: `<form id="meeting-form" class="stack">
      <label class="field"><span>Judul rapat</span><input name="title" required maxlength="120" placeholder="Contoh: Sinkronisasi peluncuran produk"></label>
      <label class="field"><span>Agenda</span><textarea name="agenda" rows="3" maxlength="1500" placeholder="Topik yang dibahas..."></textarea></label>
      <div class="field"><span>Peserta (${activeAgents.length} agen aktif)</span>
        <div class="attendee-checkboxes">
          ${activeAgents.map((agent) => `<label class="row tiny" style="gap:6px;align-items:flex-start">
            <input type="checkbox" name="attendees" value="${esc(agent.id)}" ${['Secretary AI', 'COO'].includes(agent.role) || agent.is_head ? 'checked' : ''}>
            <span>${esc(agent.avatar)} <strong>${esc(agent.name)}</strong><br><span class="dim">${esc(agent.role)} · ${esc(agent.department)}</span></span>
          </label>`).join('')}
        </div>
      </div>
      <div class="note-strip">Ringkasan rapat dihasilkan mesin simulasi. Status peserta akan berubah menjadi <strong>Rapat</strong> sementara.</div>
    </form>`,
    footer: `<button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-primary" id="meeting-save">Jadwalkan</button>`,
  });
  ref.footer.querySelector('#meeting-save').addEventListener('click', async () => {
    const form = ref.modal.querySelector('#meeting-form');
    if (!form.reportValidity()) return;
    const title = form.elements.title.value.trim();
    const agenda = form.elements.agenda.value.trim();
    const attendees = [...form.querySelectorAll('input[name="attendees"]:checked')].map((input) => input.value);
    if (!attendees.length) { toast('Pilih minimal satu peserta rapat.', 'warn'); return; }
    const button = ref.footer.querySelector('#meeting-save');
    button.disabled = true;
    try {
      await api('/api/meetings', { method: 'POST', body: { title, agenda, attendees } });
      ref.close();
      toast('Rapat dijadwalkan.', 'success');
      await loadBootstrap();
      updateChrome();
      if (routeName === 'meetings') renderMeetings();
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
    }
  });
}

async function refreshMeetings() {
  try {
    await loadBootstrap();
    updateChrome();
    if (routeName === 'meetings') renderMeetings();
  } catch { /* ignore */ }
}

/* ============================ REPORTS ============================ */
function renderReports() {
  setView(`
    ${pageHead('Reports', 'Laporan hasil pekerjaan per divisi dan per proyek. Setiap laporan memiliki label mode.',
      '<button class="btn btn-primary" data-go="#/command">Buat Proyek</button>')}
    <div class="panel">
      <div class="panel-head"><div><h3>Daftar Laporan</h3><div class="panel-sub">Klik laporan untuk membaca isi lengkap dan mengunduh</div></div>
        <span class="badge gray">${state.reports.length} laporan</span></div>
      <div class="report-list" id="report-list"></div>
    </div>
    <div class="note-strip" style="margin-top:14px">Laporan mode SIMULASI tidak boleh dianggap sebagai hasil eksekusi AI nyata. Mode NYATA dibuat dari eksekusi OpenCode/Hermes yang tercatat.</div>
  `);
  bindGoButtons(viewEl);
  renderReportList();
}

function renderReportList() {
  const list = document.getElementById('report-list');
  if (!list) return;
  if (!state.reports.length) {
    list.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="big">📄</div><p>Belum ada laporan. Laporan dibuat setelah proyek selesai diproses.</p></div>';
    return;
  }
  list.innerHTML = state.reports.map((report) => `
    <article class="report-card" data-report-open="${esc(report.id)}">
      <div class="row" style="justify-content:space-between"><div class="rt">${esc(report.title)}</div>${modeBadge(report.mode)}</div>
      <div class="tiny muted">${esc(report.project_title || report.project_id || '-')}</div>
      <div class="row" style="gap:4px">${statusBadge(report.department || 'Operasional')}
        <span class="tiny muted">${esc(report.author_name || 'Sistem')}</span>
        <span class="spacer"></span><span class="tiny muted">${esc(timeAgo(report.created_at))}</span></div>
      <div class="row"><button class="btn btn-xs" data-report-read="${esc(report.id)}">Baca Laporan</button></div>
    </article>`).join('');
  list.querySelectorAll('[data-report-open], [data-report-read]').forEach((element) => {
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      openReport(element.dataset.reportOpen || element.dataset.reportRead);
    });
  });
}

async function openReport(reportId) {
  try {
    const report = await api(`/api/reports/${reportId}`);
    openModal({
      title: report.title,
      wide: true,
      body: `<div class="row" style="margin-bottom:10px">${modeBadge(report.mode)}
          <span class="badge blue">${esc(report.department || '-')}</span>
          <span class="tiny muted">${esc(fmtDate(report.created_at))}</span></div>
        <div class="report-body">${esc(report.body || '')}</div>`,
      footer: `<button class="btn btn-ghost" data-close>Tutup</button>
        <button class="btn btn-primary" id="download-report">Unduh Markdown</button>`,
      onMount: (ref) => {
        ref.footer.querySelector('#download-report').addEventListener('click', () => {
          downloadFile(`${report.title.replace(/[^\w\-]+/g, '-').toLowerCase()}.md`, report.body || '', 'text/markdown;charset=utf-8');
        });
      },
    });
  } catch (error) { toast(error.message, 'error'); }
}
