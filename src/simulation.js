export const SIMULATION_LABEL = 'SIMULASI';

export function simulationBanner() {
  return '[SIMULASI] Hasil ini dihasilkan oleh mesin simulasi lokal, bukan oleh OpenCode/Hermes.';
}

const DEPT_ARTIFACTS = {
  Development: 'Rancangan implementasi, struktur berkas, dan potongan kode contoh',
  Research: 'Ringkasan temuan, sumber yang perlu diverifikasi, dan rekomendasi',
  Design: 'Arah visual, komponen antarmuka, dan catatan aksesibilitas',
  'Quality Assurance': 'Daftar skenario uji, temuan risiko, dan langkah reproduksi',
  Marketing: 'Rencana kampanye, draf pesan, dan metrik keberhasilan',
  Operasional: 'Rencana koordinasi, pembagian tanggung jawab, dan jadwal',
};

export function simulateTaskOutput(task, agent) {
  const dept = task.department || agent?.department || 'Operasional';
  const artifact = DEPT_ARTIFACTS[dept] || 'Catatan pelaksanaan pekerjaan';
  return [
    simulationBanner(),
    '',
    `Tugas        : ${task.title}`,
    `Pelaksana    : ${agent?.name || '-'} (${agent?.role || '-'})`,
    `Divisi       : ${dept}`,
    `Deskripsi    : ${task.description || '-'}`,
    '',
    'Langkah simulasi:',
    `1. Meninjau konteks tugas dan ketentuan dari CEO.`,
    `2. Menyusun ${artifact.toLowerCase()}.`,
    `3. Memeriksa konsistensi hasil terhadap tujuan awal.`,
    `4. Menyerahkan hasil untuk pemeriksaan Quality Assurance.`,
    '',
    'Keluaran:',
    `- ${artifact}.`,
    '- Daftar tindak lanjut dan asumsi yang perlu dikonfirmasi CEO.',
    '- Catatan bahwa hasil belum dibuat oleh mesin AI nyata.',
  ].join('\n');
}

export function simulatePlan(instruction) {
  const text = instruction.toLowerCase();
  const units = [];

  const wantsWeb = /(website|web|toko|landing|aplikasi|aplikasi web|frontend|backend|api|sistem)/.test(text);
  const wantsResearch = /(riset|research|analisis|data|pasar|kompetitor|tren|survey)/.test(text);
  const wantsDesign = /(desain|design|ui|ux|logo|branding|visual|grafis|antarmuka)/.test(text) || wantsWeb;
  const wantsMarketing = /(marketing|promosi|iklan|konten|kampanye|sosial media|penjualan|toko|pelanggan)/.test(text);
  const wantsQa = wantsWeb || /(uji|test|qa|bug|kualitas|review)/.test(text);

  units.push({
    title: 'Analisis kebutuhan dan ruang lingkup',
    description: `Uraikan kebutuhan, batasan, dan kriteria sukses untuk instruksi: "${instruction}".`,
    department: 'Research',
    roleHint: 'Researcher',
    priority: 'Tinggi',
  });

  if (wantsDesign) {
    units.push({
      title: 'Perancangan pengalaman dan antarmuka',
      description: 'Susun struktur informasi, alur pengguna, dan arahan visual yang sesuai kebutuhan.',
      department: 'Design',
      roleHint: 'UI/UX Designer',
      priority: 'Normal',
    });
  }

  units.push({
    title: wantsWeb ? 'Implementasi solusi digital' : 'Penyusunan solusi dan dokumentasi',
    description: 'Bangun solusi yang diminta, lengkap dengan catatan teknis dan asumsi implementasi.',
    department: 'Development',
    roleHint: 'Programmer',
    priority: 'Tinggi',
  });

  if (wantsMarketing) {
    units.push({
      title: 'Penyusunan rencana komunikasi dan promosi',
      description: 'Buat rencana kampanye, pesan utama, dan metrik keberhasilan yang terukur.',
      department: 'Marketing',
      roleHint: 'Marketing Strategist',
      priority: 'Normal',
    });
  }

  if (wantsQa) {
    units.push({
      title: 'Pengujian dan pemeriksaan kualitas',
      description: 'Uji hasil pekerjaan, catat risiko, dan berikan rekomendasi perbaikan.',
      department: 'Quality Assurance',
      roleHint: 'Tester',
      priority: 'Tinggi',
    });
  }

  if (!wantsResearch && !wantsWeb && !wantsMarketing) {
    units.push({
      title: 'Penyusunan rencana operasional',
      description: 'Susun langkah operasional, pembagian peran, dan jadwal pelaksanaan.',
      department: 'Operasional',
      roleHint: 'COO',
      priority: 'Normal',
    });
  }

  return units;
}

export function simulateReport(project, tasks) {
  const lines = [
    simulationBanner(),
    '',
    `Proyek   : ${project.title}`,
    `Instruksi: ${project.instruction}`,
    `Mode     : ${SIMULATION_LABEL}`,
    '',
    'Ringkasan eksekusi:',
  ];
  for (const task of tasks) {
    lines.push(`- [${task.status}] ${task.title} — ${task.department || '-'} (${task.assignee_name || task.assignee_id || '-'})`);
  }
  lines.push(
    '',
    'Catatan:',
    'Seluruh aktivitas di atas adalah simulasi lokal. Hubungkan OpenCode atau Hermes pada menu AI Connections, ' +
    'lalu pastikan semua agen yang terlibat memakai mesin terhubung agar proyek berjalan dengan AI nyata.',
  );
  return lines.join('\n');
}

export function simulateMeetingSummary(title, agenda, attendees) {
  return [
    simulationBanner(),
    '',
    `Rapat   : ${title}`,
    `Agenda  : ${agenda}`,
    `Peserta : ${attendees.join(', ') || '-'}`,
    '',
    'Poin pembahasan (simulasi):',
    '1. Tujuan rapat disepakati dan dipetakan ke kebutuhan divisi terkait.',
    '2. Setiap divisi menyampaikan ketergantungan dan risiko utama.',
    '3. Disepakati tindak lanjut dengan pemilik tugas yang jelas.',
    '',
    'Tindak lanjut: kumpulkan hasil per divisi, lakukan pemeriksaan QA, lalu ajukan laporan ke CEO.',
  ].join('\n');
}
