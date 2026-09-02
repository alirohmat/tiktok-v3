# TikTok v2 — AI Video Clipper (Anti-Duplication Engine)

Aplikasi vertical 9:16 automated video clipper berbasis **TypeScript**, **Node.js/Express**, **Svelte**, dan **FFmpeg & yt-dlp**. Dirancang khusus untuk memotong konten video panjang menjadi klip vertikal siap FYP dengan optimasi anti-duplikasi algoritma (TikTok, Reels, Shopee Video).

## 🚀 Fitur Utama

1. **Unduhan yt-dlp Terintegrasi**:
   - Mendukung unduhan video & audio dari YouTube, TikTok, dan URL stream lainnya.
   - Real-time stream tracking via SSE (Server-Sent Events).

2. **Auto-Framing 9:16 HD & Watermark**:
   - Konversi format landscape 16:9 ke vertical 9:16 (1080x1920 HD) otomatis.
   - Watermark handle `@brogalanblora` terinjeksi secara native pada video.

3. **Pembersihan Filler Words & Dead-Air**:
   - Memotong jeda hening (*dead-air*) >0.45 detik otomatis via filter FFmpeg `silenceremove`.
   - Menghasilkan narasi kinetik dan padat (~160 WPM) untuk retensi tinggi penonton.

4. **Stock Backsound Sesuai Tema & Auto-Ducking**:
   - Tersedia instrumen audio bebas royalti (Lofi Chill 90 BPM, Energetic Trap 128 BPM, Cinematic Ambient 85 BPM, Funky Groove 110 BPM).
   - Injeksi audio mixing FFmpeg dengan auto-ducking (volume musik mengecil saat vokal berbicara).

5. **Seamless Loop 200% & Anti-Duplikasi Ultrasonik**:
   - Deteksi kalimat bridge penutup dan crossfade audio 120ms ke frame awal untuk memicu loop re-watch 200%.
   - Injeksi frekuensi ultrasonik 19kHz berlevel mikro untuk merombak sidik jari audio video (*audio hash rebirth*).

6. **Viral Caption, Hashtag & Matriks Jadwal Posting WIB**:
   - Generator hook 3 detik, caption kontekstual, dan tombol salin hashtag interaktif.
   - Panduan matriks waktu posting harian WIB (GMT+7) termasuk Golden Peak Time malam (19:00 - 21:45 WIB).
   - Video player preview 9:16 langsung di browser sebelum unduhan.

---

## 🛠️ Persyaratan Sistem

- **Node.js** >= 18 atau 20 LTS
- **FFmpeg** & **FFprobe** terinstal di PATH
- **yt-dlp** terinstal di `/usr/local/bin/yt-dlp` atau PATH

---

## 💻 Cara Menjalankan (Lokal)

1. Clone repositori:
   ```bash
   git clone <repo-url>
   cd tiktok-v2
   ```

2. Instal dependensi:
   ```bash
   npm install
   ```

3. Konfigurasi Environment:
   ```bash
   cp .env.example .env
   ```

4. Jalankan mode pengembangan:
   ```bash
   npm run dev
   ```
   Aplikasi akan berjalan di `http://localhost:3000`.

5. Build untuk produksi:
   ```bash
   npm run build
   npm start
   ```

---

## 🐳 Menjalankan dengan Docker

```bash
# Build dan jalankan container
docker compose up -d

# Cek logs
docker compose logs -f

# Buka di browser
http://localhost:3000
```

---

## 📁 Struktur Direktori

```text
├── Dockerfile                  # Container build dengan FFmpeg & yt-dlp
├── docker-compose.yml          # Konfigurasi container
├── package.json                # Dependensi Node & script build
├── server.ts                   # Express server, SSE, FFmpeg engine & yt-dlp pipeline
├── src/
│   ├── App.svelte              # Antarmuka dashboard (Download, Clipper, Kelola)
│   ├── app.css                 # Konfigurasi Tailwind styling
│   └── lib/
│       └── store.js            # Svelte store & SSE client
└── storage/
    ├── downloads/              # File sumber yang diunduh
    ├── renders/                # Hasil render klip vertikal 9:16
    ├── audio_assets/           # Track instrumen backsound fisik
    └── uploads/                # File upload lokal
```
