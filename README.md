# Chat Story

PWA Android untuk menulis cerita hobi bersama AI (DeepSeek, Vikey, Poolside, OpenRouter, atau penyedia lain berformat OpenAI), dengan alur seperti Notion mobile + Notion AI. Spesifikasi lengkap ada di [SPEC.md](SPEC.md).

**Aplikasi:** https://alwaysysl.github.io/chat-story/

## Cara pakai di HP

1. Buka tautan di atas dengan Chrome Android.
2. Ikuti panduan awal: pilih penyedia AI dan masukkan API key-nya, lalu pasang lewat menu titik tiga → **Tambahkan ke layar utama**.
3. Ketuk **Ask AI**, tulis brief cerita, dan biarkan AI menulis pembukaan di page baru.

Semua data (cerita, chat, gambar, API key) hanya tersimpan di HP. Backup rutin lewat **Pengaturan → Backup sekarang**.

## Aplikasi Android (APK)

Unduh file `.apk` terbaru di [Releases](https://github.com/alwaysYSL/chat-story/releases/latest), lalu pasang. Versi APK bisa memakai penyedia AI yang tidak mengizinkan aplikasi web (CORS), misalnya TokenKoding. Data APK terpisah dari versi web; pindahkan lewat Backup → Restore.

Build lokal: `npm run cap:sync` lalu buka folder `android/` di Android Studio. Rilis dibuat otomatis oleh `.github/workflows/android.yml` saat versi di `package.json` naik.

## Pengembangan

```bash
npm install
npm run dev        # server pengembangan
npm run build      # cek tipe + build produksi ke dist/
```

Setiap push ke `main` di-build dan di-deploy otomatis ke GitHub Pages lewat `.github/workflows/deploy.yml`.

### Struktur kode

| Folder | Isi |
|---|---|
| `src/db.ts` | Skema IndexedDB (Dexie): page, chat, pesan, lampiran, pengaturan |
| `src/lib/providers.ts` | Daftar penyedia & model bawaan, harga, kemampuan |
| `src/lib/api.ts` | Klien API format OpenAI (streaming, thinking per penyedia, tes koneksi, error) |
| `src/lib/context.ts` | Penyusunan konteks percakapan supaya cache penyedia AI tetap kena |
| `src/lib/generate.ts` | Mesin penulisan: kirim, coba lagi, versi, batalkan, lanjutkan |
| `src/lib/markdown.ts` | Konversi teks model ↔ dokumen editor, segmen per balasan AI |
| `src/lib/prompts.ts` | Instruksi sistem dan instruksi per permintaan |
| `src/screens/` | Beranda, Chat, Page, Cari, Pengaturan, Sampah, Onboarding |
| `src/components/` | Editor TipTap, sheet, ikon, menu page |
