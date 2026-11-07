export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function fmtDate(iso, { time = true } = {}) {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  const options = { day: '2-digit', month: 'short', year: 'numeric' };
  if (time) { options.hour = '2-digit'; options.minute = '2-digit'; }
  return new Intl.DateTimeFormat('id-ID', options).format(date);
}

export function timeAgo(iso) {
  if (!iso) return '-';
  const date = new Date(iso).getTime();
  if (Number.isNaN(date)) return '-';
  const seconds = Math.max(0, Math.floor((Date.now() - date) / 1000));
  if (seconds < 10) return 'baru saja';
  if (seconds < 60) return `${seconds} dtk lalu`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} mnt lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} hari lalu`;
  return fmtDate(iso, { time: false });
}

export function truncate(text, max = 120) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max - 1).trim()}…` : value;
}

const STATUS_STYLES = {
  Menunggu: 'blue',
  Direncanakan: 'blue',
  'Sedang dikerjakan': 'amber',
  'Dalam pemeriksaan': 'purple',
  'Memerlukan persetujuan CEO': 'purple',
  Selesai: 'green',
  Gagal: 'red',
  Dibatalkan: 'gray',
  Idle: 'gray',
  Bekerja: 'amber',
  Rapat: 'blue',
  Nonaktif: 'red',
  Berjalan: 'amber',
  Sukses: 'green',
  Terhubung: 'green',
  'Belum terhubung': 'red',
  'Belum diperiksa': 'gray',
  'Perlu konfigurasi': 'amber',
  'Gagal tes': 'red',
  'Siap (SIMULASI)': 'purple',
  Dijadwalkan: 'blue',
  Disetujui: 'green',
  Ditolak: 'red',
};

const MODE_STYLES = { NYATA: 'green', SIMULASI: 'purple' };

export function statusBadge(status, { dot = false, pulse = false } = {}) {
  const style = STATUS_STYLES[status] || 'gray';
  const label = status || 'Tidak diketahui';
  return `<span class="badge ${style}">${dot ? `<i class="dot ${style === 'green' ? 'green' : style === 'red' ? 'red' : style === 'amber' ? 'amber' : style === 'purple' ? 'purple' : 'blue'}${pulse ? ' pulse' : ''}"></i>` : ''}${esc(label)}</span>`;
}

export function modeBadge(mode) {
  if (!mode) return '';
  const style = MODE_STYLES[mode] || 'gray';
  const label = mode === 'SIMULASI' ? 'SIMULASI' : mode === 'NYATA' ? 'NYATA' : mode;
  return `<span class="badge ${style}">${esc(label)}</span>`;
}

export function engineBadge(engine) {
  if (!engine) return '<span class="badge gray">Tanpa mesin</span>';
  const connected = engine.type === 'simulation' || engine.connected || engine.status === 'Terhubung';
  const color = engine.type === 'simulation' ? 'purple' : connected ? 'green' : 'red';
  return `<span class="badge ${color}">${esc(engine.label || engine.type)}</span>`;
}

export function daysAgoIso(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

export function downloadFile(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/* ---------- Modal ---------- */
export function openModal({ title, body = '', footer = '', wide = false, onMount, className = '' }) {
  const root = document.getElementById('modal-root');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''} ${className}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head">
        <h3>${esc(title)}</h3>
        <button class="icon-btn" data-close aria-label="Tutup">×</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  root.appendChild(overlay);
  const close = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  };
  const onKey = (event) => { if (event.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay || event.target.closest('[data-close]')) close();
  });
  const result = {
    overlay,
    modal: overlay.querySelector('.modal'),
    body: overlay.querySelector('.modal-body'),
    footer: overlay.querySelector('.modal-foot'),
    close,
  };
  if (onMount) onMount(result);
  return result;
}

export function confirmDialog({ title = 'Konfirmasi', message = '', confirmLabel = 'Lanjutkan', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const modal = openModal({
      title,
      body: `<div style="font-size:12px;line-height:1.6">${message}</div>`,
      footer: `<button class="btn btn-ghost" data-cancel>Batal</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm>${esc(confirmLabel)}</button>`,
      onMount: (ref) => {
        ref.footer.querySelector('[data-cancel]').addEventListener('click', () => {
          if (settled) return;
          settled = true;
          ref.close();
          resolve(false);
        });
        ref.footer.querySelector('[data-confirm]').addEventListener('click', () => {
          if (settled) return;
          settled = true;
          ref.close();
          resolve(true);
        });
      },
    });
    modal.overlay.addEventListener('click', (event) => {
      if ((event.target === modal.overlay || event.target.closest('[data-close]')) && !settled) {
        settled = true;
        resolve(false);
      }
    });
  });
}

/* ---------- Drawer ---------- */
export function openDrawer({ title, body = '', footer = '', onMount }) {
  const root = document.getElementById('drawer-root');
  root.innerHTML = '';
  const overlay = document.createElement('div');
  overlay.className = 'drawer-overlay';
  const drawer = document.createElement('aside');
  drawer.className = 'drawer';
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  drawer.innerHTML = `
    <div class="drawer-head">
      <h3>${esc(title)}</h3>
      <button class="icon-btn" data-close aria-label="Tutup">×</button>
    </div>
    <div class="drawer-body">${body}</div>
    ${footer ? `<div class="drawer-foot">${footer}</div>` : ''}`;
  root.appendChild(overlay);
  root.appendChild(drawer);
  const onKey = (event) => { if (event.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  function close() {
    document.removeEventListener('keydown', onKey);
    root.innerHTML = '';
  }
  overlay.addEventListener('click', close);
  drawer.querySelector('[data-close]').addEventListener('click', close);
  const result = {
    overlay,
    drawer,
    body: drawer.querySelector('.drawer-body'),
    footer: drawer.querySelector('.drawer-foot'),
    close,
  };
  if (onMount) onMount(result);
  return result;
}

/* ---------- Toast ---------- */
export function toast(message, type = 'info', timeout = 4200) {
  const root = document.getElementById('toast-root');
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'warn' ? '!' : 'i';
  element.innerHTML = `<span class="mono">${icon}</span><span class="tx">${esc(message)}</span>
    <button class="tclose" aria-label="Tutup">×</button>`;
  root.appendChild(element);
  const remove = () => element.remove();
  element.querySelector('.tclose').addEventListener('click', remove);
  setTimeout(remove, timeout);
  return element;
}

export function options(values, selected, { valueKey = 'value', labelKey = 'label' } = {}) {
  return values.map((item) => {
    const value = typeof item === 'string' ? item : item[valueKey];
    const label = typeof item === 'string' ? item : item[labelKey];
    return `<option value="${esc(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${esc(label)}</option>`;
  }).join('');
}

export const DEPARTMENTS = ['Development', 'Research', 'Design', 'Quality Assurance', 'Marketing', 'Operasional'];
export const TASK_STATUSES = [
  'Menunggu', 'Direncanakan', 'Sedang dikerjakan', 'Dalam pemeriksaan',
  'Memerlukan persetujuan CEO', 'Selesai', 'Gagal', 'Dibatalkan',
];
export const PRIORITIES = ['Rendah', 'Normal', 'Tinggi', 'Kritis'];
