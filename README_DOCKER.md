# Deploy Docker — TikTok v2 AI Video Clipper

## 1. Menjalankan Kontainer dengan Docker Compose

```bash
# Salin konfigurasi env (opsional)
cp .env.example .env

# Jalankan service
docker compose up -d --build
```

Akses di browser:
- Aplikasi Web: `http://localhost:3000`
- Cek Status Kesehatan: `http://localhost:3000/health`
- Cek Diagnostik Storage: `http://localhost:3000/clip/diagnostics`

## 2. Monitor Log & Status

```bash
# Pantau log secara real-time
docker compose logs -f

# Cek status container
docker compose ps
```

## 3. Persistensi Storage

Direktori `./storage` di-mount ke `/app/storage` di dalam container sehingga:
- File unduhan di `./storage/downloads` tetap tersimpan
- File hasil render di `./storage/renders` tidak akan hilang saat container di-restart
- Aset audio di `./storage/audio_assets` otomatis tersedia

## 4. Perintah Berguna

```bash
# Menghentikan container
docker compose down

# Rebuild container setelah update kode
docker compose up -d --build
```
