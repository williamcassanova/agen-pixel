# PIXEL OFFICE AI — LAPORAN DEBUGGING

Tanggal: 7 November 2026  
Lingkungan: `/root/pixel-office-ai`  
Server aktif: `http://127.0.0.1:3000`  
PID terakhir: `18054`

## Ringkasan Eksekutif

Error `EPROTO: The TLS handshake failed. Does the server speak TLS on this port?`
**bukan berasal dari server Pixel Office AI**. Error tersebut berasal dari aliran
provider OpenCode (keluar) saat model `opencode/deepseek-v4.1-flash-free` dipanggil.

Server Pixel Office AI adalah server HTTP biasa (`node:http`) dan seluruh endpoint
API lokal merespons normal. Tidak ada proxy TLS yang salah, tidak ada URL HTTPS
hardcoded di frontend, dan tidak ada konfigurasi global OpenCode/Hermes/OS yang diubah.

Setelah investigasi, koneksi provider OpenCode diuji ulang dan berhasil. Dengan
demikian insiden `EPROTO` pada `2026-11-07T14:01:20Z` bersifat transien pada
koneksi keluar OpenCode, bukan kegagalan protokol aplikasi Pixel Office.

## Bukti Utama

### 1. Error asli berasal dari OpenCode

Log: `/root/.local/share/opencode/log/opencode.log`

```text
timestamp=2026-11-07T14:01:19.829Z level=INFO run=e7629684
message=stream providerID=opencode modelID=deepseek-v4.1-flash-free
session.id=ses_e49dd067dffetUTvAc0fLhlffM small=false agent=build mode=primary

timestamp=2026-11-07T14:01:20.052Z level=ERROR run=e7629684
message="stream error" providerID=opencode modelID=deepseek-v4.1-flash-free
session.id=ses_e49dd067dffetUTvAc0fLhlffM small=false agent=build mode=primary
error.error="TypeError: EPROTO: The TLS handshake failed. Does the server speak TLS on this port?"
```

Kata kunci penting: `providerID=opencode`. Ini adalah stream outbound OpenCode,
bukan request ke API Pixel Office di port `3000`.

### 2. Endpoint lokal tetap sehat

```text
GET http://127.0.0.1:3000/api/health
HTTP 200
{"ok":true,"name":"Pixel Office AI","time":"2026-11-07T14:08:27.792Z","executions_aktif":0,"antrean":0}

GET http://127.0.0.1:3000/api/projects/prj-e2ffba642807f23a
HTTP 200
status: "Memerlukan persetujuan CEO"
approval_status: "Menunggu"

GET http://127.0.0.1:3000/api/projects/prj-8c5ee0e694605c91
HTTP 200
status: "Selesai"
approval_status: "Disetujui"
```

### 3. Uji HTTPS ke port HTTP memang gagal, tetapi bukan penyebab EPROTO aplikasi

```text
curl https://127.0.0.1:3000/api/health
curl: (35) TLS connect error:
error:0A00010B:SSL routines::wrong version number
```

Ini adalah perilaku normal ketika klien memaksa TLS ke server HTTP. Server lokal
tidak dirancang untuk HTTPS. Frontend memakai path relatif sehingga tetap memakai
`http://127.0.0.1:3000`.

### 4. OpenCode berhasil diuji ulang

```text
opencode run -m opencode/deepseek-v4.1-flash-free "Balas hanya dengan kata: SIAP"
Output: SIAP
Exit: 0
```

Uji dilakukan setelah insiden dan berhasil tanpa `EPROTO`.

### 5. Konektivitas TLS ke domain OpenCode sehat

```text
DNS opencode.ai -> 172.66.173.149, 104.20.32.17
curl https://opencode.ai
HTTP 200
tls_verify_result=0
```

### 6. Konfigurasi 9router berbeda dan sedang tidak aktif

`/root/.config/opencode/opencode.jsonc` memakai:

```text
provider 9router baseURL = http://localhost:20128/v1
```

Port `20128` tidak merespons:

```text
curl http://127.0.0.1:20128/v1/models
Failed to connect to 127.0.0.1 port 20128
```

Provider yang gagal pada log adalah `opencode`, bukan `9router`. Konfigurasi
global tidak diubah.

### 7. Tidak ada proxy environment

Tidak ditemukan `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, atau `NO_PROXY` yang
mengarahkan koneksi ke proxy TLS yang salah.

## Analisis Akar Masalah

1. Request aplikasi ke backend Pixel Office berjalan melalui HTTP biasa dan
   berhasil.
2. OpenCode melakukan request keluar ke provider `opencode` untuk model
   `deepseek-v4.1-flash-free`.
3. Pada `2026-11-07T14:01:20Z`, koneksi TLS keluar tersebut gagal sebelum
   handshake selesai.
4. Pesan `EPROTO` muncul di OpenCode, bukan di log server Pixel Office.
5. Uji ulang OpenCode CLI dan TLS ke `opencode.ai` berhasil, sehingga kegagalan
   tersebut tidak lagi reproducible dan bersifat transien.

Penyebab pasti di sisi jaringan/penyedia tidak dapat dibuktikan hanya dari log
lokal. Yang dapat dipastikan: **bukan server HTTP Pixel Office, bukan URL API
lokal, dan bukan konfigurasi protokol aplikasi**.

## Perbaikan yang Dilakukan

- Menambahkan handler `server.on('clientError', ...)` di `server.js:821` untuk
  mencatat secara eksplisit jika ada TLS ClientHello yang masuk ke port HTTP.
- Server tetap mengembalikan `400 Bad Request` dan tidak crash saat menerima
  koneksi TLS yang salah port.
- Verifikasi log setelah uji HTTPS ke port `3000`:

```text
[2026-11-07T14:08:32.033Z] TLS handshake diterima di port HTTP;
gunakan http://, bukan https://.
```

- Server dijalankan ulang agar perubahan aktif. Data, agen, proyek, dan database
  tidak dihapus.
- Tidak ada perubahan pada konfigurasi global OpenCode, Hermes, atau OS.

## Verifikasi Setelah Perbaikan

```text
node --check server.js                      OK
node --check public/js/app.js               OK
npm test                                    18/18 lulus, 0 gagal
GET /api/health                             200
GET /api/settings                           200
GET /api/projects/:id                       200
HTTPS ke port 3000                          ditolak dengan log diagnostik
HTTP normal setelah uji TLS                 200
```

Smoke test UI dengan jsdom:

```text
10 route berhasil dirender:
office, dashboard, command, employees, departments,
tasks, meetings, reports, connections, settings

report modal     : true
task drawer      : true (6 log line)
agent modal      : true
engine config    : true
meeting modal    : true
ERRORS           : 0
```

Tidak ada browser native di lingkungan ini, sehingga verifikasi visual/klik
dilakukan dengan jsdom dan harness yang memuat `public/index.html` serta
`public/js/app.js` secara nyata.

## Status Komponen

| Komponen | Status | Catatan |
|---|---|---|
| Server API lokal | Sehat | HTTP 200, port 3000 |
| Frontend | Sehat | 10 route, modal, drawer, tanpa JS error |
| Database | Utuh | Tidak dihapus/direset |
| OpenCode | Terhubung | v1.19.5, prompt `SIAP` exit 0, 22 model terdeteksi |
| 9router | Tidak aktif | Port 20128 tertutup |
| Hermes | Tidak tersedia | `hermes: command not found` |
| EPROTO | Tidak reproducible | Error transien di stream provider OpenCode |
| HTTPS ke port 3000 | Tidak didukung | Memang HTTP-only; gunakan `http://` |
| Browser native | Tidak tersedia | Diverifikasi via jsdom |

## Kesimpulan

`EPROTO` bukan bug protokol Pixel Office AI dan tidak memerlukan perubahan URL,
TLS, atau konfigurasi global OpenCode. Server aplikasi sudah benar berjalan
sebagai HTTP di `127.0.0.1:3000`, seluruh endpoint utama sehat, dan OpenCode
kembali berhasil digunakan. Perbaikan yang ditambahkan adalah diagnostik lokal
agar kesalahan “HTTPS ke port HTTP” tercatat jelas di masa depan.
