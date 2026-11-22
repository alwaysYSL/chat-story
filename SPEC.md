# Chat Story — Spesifikasi Aplikasi

Aplikasi Android (PWA) untuk menulis cerita hobi bersama AI (DeepSeek, Vikey, Poolside, OpenRouter, atau penyedia lain berformat OpenAI), dengan alur kerja seperti Notion mobile + Notion AI, tetapi hanya berisi fitur yang dibutuhkan.

Status: **disepakati, siap dibangun (Versi 1)**.

---

## 1. Prinsip

- **Satu tujuan:** menulis cerita bersama AI. Tidak ada fitur di luar itu.
- **Data hanya di HP.** Tidak ada server, akun, atau sinkronisasi cloud.
- **Hemat secara default:** thinking mati, cache penyedia dimaksimalkan, biaya terlihat di setiap balasan (kalau harga model diketahui).
- **Mirip Notion mobile:** Beranda berisi daftar page, page langsung menampilkan naskah, Ask AI di bawah, chat AI menulis langsung ke page.
- **Bahasa antarmuka:** Indonesia. **Tema:** mengikuti pengaturan HP (terang/gelap).

## 2. Platform dan teknologi

| Bagian | Pilihan |
|---|---|
| Bentuk aplikasi | PWA, dipasang lewat Chrome Android → "Tambahkan ke layar utama" |
| UI | React + TypeScript + Vite |
| Editor | TipTap (ProseMirror) |
| Penyimpanan | IndexedDB (via Dexie), dengan permintaan *persistent storage* |
| PWA | vite-plugin-pwa (offline + update otomatis) |
| AI | `fetch` langsung ke penyedia pilihan (format OpenAI Chat Completions, streaming) |
| Hosting | GitHub Pages, deploy otomatis via GitHub Actions dari repo ini |

Kode yang sama bisa dibungkus menjadi APK dengan Capacitor di kemudian hari (Versi 2, opsional).

---

## 3. Navigasi

```
Beranda ─┬─ Page cerita ── Page bab
         │        └── Ask AI → Halaman chat (chat utama cerita)
         ├─ Tab Chat → Halaman chat
         ├─ Cari
         └─ Avatar → Pengaturan (termasuk Sampah, Backup)
```

Bar bawah (di Beranda, tab Chat, dan page): **🔍 Cari · Ask AI · ✏️ Page baru**.

---

## 4. Layar

### 4.0 Onboarding (sekali, saat pertama dibuka)
1. Pilih penyedia AI (DeepSeek, Vikey, Poolside, OpenRouter) dan masukkan API key-nya.
2. Tes koneksi. DeepSeek: cek saldo. Penyedia lain: kirim satu pesan sangat pendek.
3. Minta izin penyimpanan permanen, lalu panduan bergambar "Tambahkan ke layar utama" di Chrome Android.

Bisa dilewati. Kalau API key belum diisi, tombol kirim di chat mengarahkan ke Pengaturan.

### 4.1 Beranda
- **Atas:** avatar (buka Pengaturan), tab **Beranda** dan **Chat**.
- **Terbaru:** kartu horizontal page yang terakhir dibuka (cerita atau bab).
- **Cerita:** daftar page cerita.
  - Setiap baris: tanda `>` untuk membuka daftar bab, ikon, judul, jumlah kata, `⋯`, dan `+` (bab baru).
  - Cerita yang di-pin tampil paling atas. Urutan default: terakhir diedit.
  - Cuplikan 1–2 baris terakhir naskah di kartu Terbaru.
  - "Lihat lainnya" kalau daftar panjang.
- **Menu `⋯` cerita:** ganti nama/ikon, pin, duplikat (untuk mencoba alur alternatif), ekspor, hapus.
- **Kosong:** ajakan "Mulai cerita pertama" yang membuka chat baru.

### 4.2 Tab Chat
- Riwayat chat dikelompokkan: Hari ini, 7 hari terakhir, Lebih lama.
- Setiap baris: judul chat (otomatis dari awal pesan pertama, bisa diganti) dan nama page yang terhubung.
- Tekan lama: ganti nama, hapus. Chat utama cerita **tidak bisa** dihapus terpisah (lihat 5.4).

### 4.3 Halaman chat
- **Atas:** 🕘 riwayat, judul chat, ✏️ chat baru.
- **Chip page:** `📄 Judul cerita` kalau chat terhubung ke page. Ketuk untuk membuka page.
- **Brief** (pesan pertama chat utama) ditampilkan tersemat di atas dan bisa dibuka penuh.
- **Pesan Anda:** teks + thumbnail lampiran.
- **Balasan yang menulis ke page** tampil sebagai kartu ringkas, bukan teks penuh:
  `✍ Menulis di «Bagian 3» · 642 kata · Rp9`
  - Ketuk kartu → lompat ke bagian itu di page.
  - Tombol **Coba lagi**, **Batalkan**, dan pemilih versi **‹ 1/3 ›**.
- **Balasan diskusi** (saklar "Tulis ke page" mati) tampil sebagai teks biasa di chat.
- **Kolom input:**
  - `+` lampiran (gambar, file teks).
  - Pilihan model dari semua penyedia yang API key-nya terisi, dan saklar thinking (default mati).
  - Saklar **Tulis ke page** (default nyala di chat utama).
  - Chip target: `Tulis ke: Bagian 3 ▾` dengan pilihan **+ Bab baru**.
  - Pilihan panjang: **Pendek** (~300) · **Normal** (500–700) · **Panjang** (~1000) kata.
  - Tombol **Lanjutkan saja** (AI melanjutkan tanpa arahan).
  - Draf yang belum terkirim disimpan otomatis.
- **Selama AI menulis:** tombol **Stop**, layar dijaga tetap menyala (Wake Lock), panel chat mengecil dan pindah ke page supaya tulisan terlihat mengalir.

### 4.4 Page cerita dan page bab
- **Atas:** ‹ kembali, breadcrumb di bab (`Judul cerita › Bagian 3`), ⤴ bagikan/ekspor, `⋯`.
- **Judul** lalu **naskah** yang langsung bisa dibaca dan diedit.
- **Format:** paragraf, judul bab, tebal, miring, pemisah adegan (`***`). Undo/redo. Simpan otomatis.
- **Akhir naskah:**
  - Page cerita: daftar link ke semua bab.
  - Page bab: **‹ Bab sebelumnya** dan **Bab berikutnya ›**.
- **Posisi baca** disimpan per page. Tombol cepat ke awal/akhir.
- **Penanda batas balasan AI:** garis tipis di pinggir, bisa dinyalakan di Pengaturan (default mati).
- **Selama AI menulis:** editor terkunci dengan label "AI sedang menulis…", gulir otomatis mengikuti tulisan dan berhenti kalau Anda menggulir ke atas.
- **Menu `⋯`:** lihat/edit brief, chat baru untuk diskusi, riwayat biaya, bab baru, atur urutan bab (di page cerita), pengaturan baca, hapus.
- **Saran bab baru:** kalau bab terakhir melewati 5.000 kata (bisa diubah), muncul tawaran "Bab ini sudah 5.200 kata. Lanjutkan di bab baru?"
- Info kecil: jumlah kata page ini dan total cerita.

### 4.5 Cari
Mencari di judul dan isi semua page, serta judul chat.

### 4.6 Pengaturan
- **Penyedia AI:** daftar penyedia (DeepSeek, Vikey, Poolside, OpenRouter bawaan, plus penyedia lain yang bisa ditambah). Per penyedia: nama, base URL, API key, tes koneksi, dan daftar model. Per model: model id, nama tampilan, bisa membaca gambar atau tidak, cara mengatur thinking, dan harga per 1 juta token (USD atau Rupiah; boleh kosong).
- **Model default**, thinking default, kreativitas (Stabil / Normal / Liar).
- **Panjang tulisan:** target pembukaan (default 2000–3000 kata), target lanjutan (default 500–700 kata), batas saran bab baru (default 5.000 kata).
- **Biaya:** kurs USD → Rupiah (manual), peringatan jam peak (08–11 dan 13–17 WIB, Senin–Jumat).
- **Tampilan baca:** ukuran huruf, jarak baris, serif/sans, penanda batas balasan AI.
- **Data:** backup, restore, pemakaian penyimpanan, Sampah.
- **Tentang:** versi aplikasi.

### 4.7 Sampah
Page, bab, dan chat yang dihapus disimpan 30 hari. Bisa dipulihkan atau dihapus permanen.

---

## 5. Alur utama

### 5.1 Membuat cerita baru
1. Ketuk **Ask AI** dari Beranda (chat baru tanpa page).
2. Tulis brief: gambaran besar, karakter, paragraf gambaran pembukaan, aturan penulisan pembukaan, aturan penulisan lanjutan. Lampirkan gambar referensi kalau ada.
3. Dengan saklar **Tulis ke page** nyala, AI menulis pembukaan (target pembukaan) dengan **menyempurnakan** gambaran pembukaan. Paragraf asli Anda tidak masuk naskah.
4. Aplikasi otomatis membuat **page cerita baru** dengan judul usulan AI (bisa diganti), lalu tulisan mengalir ke page itu.
5. Chat ini menjadi **chat utama** cerita tersebut, dan pesan pertamanya menjadi **brief**.

Kalau saklar mati, chat ini hanya chat diskusi biasa (misalnya brainstorming ide).

### 5.2 Melanjutkan cerita
1. Buka page, baca, edit kalau perlu.
2. Ketuk **Ask AI** → chat utama terbuka, chip page terpasang, target = bab terakhir.
3. Tulis arahan pendek (biasanya < 100 kata). Arahan tidak masuk naskah.
4. AI mengembangkan arahan menjadi lanjutan (target lanjutan) di **akhir bab terakhir** atau di **bab baru**.

### 5.3 Page yang dibuat manual
**✏️ Page baru** membuat page cerita kosong. Saat Ask AI pertama kali dibuka dari page itu, chat utama dibuat; pesan pertama menjadi brief, dan teks yang sudah Anda tulis ikut menjadi konteks.

### 5.4 Aturan chat dan page
- Satu cerita punya **satu chat utama** yang menyambung lintas bab. Hanya chat utama yang bisa menulis ke page.
- **Chat diskusi** bisa dibuat dari menu page (`⋯ → Chat baru untuk diskusi`). AI membaca brief dan seluruh naskah, tetapi saklar Tulis ke page tidak tersedia.
- Chat utama terhapus hanya bersama page cerita. Brief bisa dilihat dan diedit dari menu page.
- AI hanya menulis di akhir bab terakhir atau di bab baru. Kalau Ask AI dibuka dari bab lama, target otomatis menunjuk bab terakhir dengan catatan kecil. Edit manual di bab lama tetap bebas.
- Hanya satu permintaan AI berjalan dalam satu waktu.

### 5.5 Coba lagi, Batalkan, Stop
- **Coba lagi:** AI menulis ulang balasan terakhir. Maksimal 3 versi disimpan; versi yang dipilih menjadi isi naskah.
- **Edit arahan terakhir:** hanya arahan paling akhir yang bisa diedit, lalu ditulis ulang (dihitung sebagai versi baru). Arahan lama hanya bisa dibaca dan disalin.
- **Batalkan:** menghapus balasan terakhir dari naskah; arahannya ditandai "dibatalkan" dan keluar dari konteks.
- **Stop:** teks yang sudah ditulis tetap tersimpan.
- **Koneksi terputus** (layar mati, pindah aplikasi, sinyal hilang): teks yang sudah masuk disimpan, kartu ditandai "terputus", dengan tombol **Lanjutkan dari sini**.

---

## 6. AI

### 6.1 Parameter
- Model default `deepseek-flash` (DeepSeek). Model lain dipilih dari Pengaturan → Penyedia AI, bisa diganti per pesan.
- Parameter thinking menyesuaikan model: DeepSeek/Vikey `thinking.type`, Poolside `chat_template_kwargs.enable_thinking`, OpenRouter `reasoning.enabled`, atau tidak dikirim.
- Thinking default **mati** (`"thinking": {"type": "disabled"}`), karena token thinking ditagih sebagai output.
- `stream: true`.
- Temperature dari pilihan kreativitas: model DeepSeek 1,2 / 1,5 / 1,7 (DeepSeek merekomendasikan 1,5 untuk penulisan kreatif); model lain 0,6 / 0,85 / 1,0.
- `max_tokens` = pengaman di atas target, kira-kira 2,5 × jumlah kata maksimal target. Panjang utama diatur lewat prompt.

### 6.2 Susunan pesan (chat utama)

```
system    : instruksi dasar bawaan aplikasi (tetap, tidak terlihat)
user      : brief + lampiran brief + target pembukaan
assistant : pembukaan            ← isi naskah versi terbaru
user      : arahan 1 (+ lampiran)
assistant : lanjutan 1           ← isi naskah versi terbaru
user      : (diskusi, kalau ada)
assistant : (jawaban diskusi)
...
user      : arahan baru + target panjang   ← permintaan sekarang
```

- **Instruksi dasar bawaan:** menulis dalam bahasa Indonesia, langsung menulis cerita tanpa kalimat pembuka/penutup atau komentar, tidak mengulang teks sebelumnya, tidak menyalin arahan mentah-mentah, mengikuti aturan penulisan di brief, dan berusaha memenuhi target kata.
- **Isi balasan AI selalu diambil dari naskah versi terbaru**, jadi editan Anda terbaca oleh AI.
- **Bab:** konteks disusun mengikuti urutan bab. Judul bab disisipkan sebagai heading di awal balasan pertama bab itu, supaya AI tahu batas bab.
- **Pesan diskusi** di chat utama ikut konteks di posisi kronologisnya.
- **Teks manual:** teks yang Anda ketik sendiri digabung ke balasan AI terdekat di page yang sama. Kalau sebuah bab hanya berisi teks manual, teks itu dikirim sebagai pesan user berlabel "teks yang ditulis penulis".
- **Balasan yang dihapus seluruhnya dari naskah** atau dibatalkan: pasangan arahan dan balasannya keluar dari konteks.
- **Pembukaan:** permintaan pertama meminta AI menulis judul di baris pertama dengan format tetap, lalu aplikasi memisahkan judul dari naskah.
- **Pembersihan hasil:** kalimat pembuka semacam "Berikut lanjutannya:" dibuang otomatis.

### 6.3 Chat diskusi
```
system : instruksi dasar mode diskusi
user   : brief + seluruh naskah (berurutan per bab) + pertanyaan pertama
...
```

### 6.4 Cache dan biaya
- Susunan di atas bersifat *append-only*, cocok dengan context caching: bagian awal yang sama persis ditagih tarif cache (DeepSeek, Vikey, dan penyedia lain yang mendukung cache).
- Jam peak (harga 2×) hanya berlaku untuk DeepSeek resmi.
- "Lanjutkan dari sini": DeepSeek memakai Chat Prefix Completion; penyedia lain menerima teks terpotong sebagai jawaban lalu diminta menyambung.
- Edit bab lama, ubah brief, ubah urutan bab, atau hapus bab membuat cache reset mulai dari titik perubahan, hanya untuk satu permintaan berikutnya.
- Setiap balasan menyimpan dan menampilkan: token input cache hit, cache miss, token output, biaya USD dan Rupiah, jumlah kata sebenarnya.
- Harga dihitung dari tabel harga (off-peak/peak) yang disimpan di aplikasi dan bisa diperbarui lewat update aplikasi.

### 6.5 Error yang ditangani (pesan bahasa Indonesia)
Tidak ada internet · API key salah · saldo habis · terlalu banyak permintaan · server sibuk · model/alamat tidak ditemukan · konten/gambar ditolak oleh pemeriksaan konten penyedia · koneksi terputus saat streaming.

---

## 7. Lampiran

- **Gambar** (JPEG, PNG, WebP, GIF) untuk referensi karakter, lokasi, dan suasana. AI hanya **membaca** gambar; aplikasi tidak membuat gambar.
  - Diperkecil otomatis di HP sebelum disimpan (penyedia juga memperkecilnya, jadi tidak ada kualitas yang hilang).
  - Satu gambar maksimal sekitar 1024 token. Gambar di brief ikut kena cache setelah permintaan pertama.
  - Hanya model yang ditandai "bisa membaca gambar" yang menerima gambar. Untuk model lain gambar dilewati dan aplikasi memberi peringatan.
- **File teks** (`.txt`, `.md`): isinya disisipkan sebagai teks dengan nama file.
- PDF: Versi 2.

---

## 8. Data

| Entitas | Isi utama |
|---|---|
| **Page** | id, parentId (null = cerita, terisi = bab), urutan, judul, ikon, pin, isi editor, jumlah kata, posisi baca, dibuat/diubah/dibuka terakhir, dihapusPada |
| **Segmen** | id, pageId, urutan, sumber (AI/manual), messageId balasan terkait, versi (maks. 3) dan versi aktif |
| **Chat** | id, judul, pageId (cerita), jenis (utama/diskusi/bebas), dibuat/diubah, dihapusPada |
| **Pesan** | id, chatId, urutan, peran, teks, lampiran, mode (tulis/diskusi), target pageId, target panjang, status (selesai/dihentikan/terputus/gagal/dibatalkan), model, token (hit/miss/output), biaya |
| **Lampiran** | id, pesanId, jenis, nama, data (blob terkompresi) |
| **Pengaturan** | API key, model, thinking, kreativitas, target kata, batas bab, kurs, tampilan, waktu backup terakhir |

Data diberi nomor versi skema dengan migrasi otomatis. Aplikasi membuat backup otomatis sebelum migrasi.

## 9. Backup dan ekspor
- **Backup:** satu file berisi semua page, chat, lampiran, dan pengaturan (tanpa API key). Bisa langsung dikirim ke Google Drive lewat menu share.
- **Pengingat backup** setiap 7 hari kalau ada perubahan.
- **Restore:** pilihan "Gabungkan" atau "Ganti semua", dengan konfirmasi.
- **Ekspor cerita:** salin sebagai Markdown (siap ditempel ke Notion) atau bagikan file `.md`/`.txt`, untuk satu bab atau seluruh cerita.

## 10. Keamanan
- API key hanya disimpan di HP dan tidak ikut di file backup.
- Tidak memakai script pihak ketiga.
- API key setiap penyedia hanya disimpan di HP dan tidak ikut di file backup.
- Content Security Policy hanya mengizinkan kode aplikasi sendiri. Koneksi boleh ke alamat `https` mana pun supaya penyedia bisa dipilih bebas.
- Repo public hanya berisi kode, tanpa data atau kunci.

## 11. Offline dan performa
- Aplikasi bisa dibuka, dibaca, dan diedit tanpa internet. Fitur AI nonaktif dengan pesan jelas.
- Target: editor tetap lancar sampai sekitar 50.000 kata per page.

---

## 12. Cakupan versi

**Versi 1:** semua yang dijelaskan di dokumen ini.

**Versi 2 (nanti):**
- Cari kata di dalam naskah yang sedang dibuka.
- Pilih teks → minta AI menulis ulang bagian itu.
- Lampiran PDF (lewat API OCR DeepSeek).
- Ringkasan bab lama untuk cerita yang sangat panjang.
- Bungkus menjadi APK dengan Capacitor (opsional).

**Tidak dibuat:** pembuatan gambar, sinkronisasi cloud, kolaborasi, agent/asisten kustom, database/tabel, template, input suara terpisah (pakai ketik suara Gboard), sub-page lebih dari satu tingkat.

---

## 13. Catatan keputusan

| Topik | Keputusan |
|---|---|
| Platform | PWA (lebih mudah dibuat, diuji, dan diperbarui dari HP) |
| Hasil AI | Otomatis masuk ke page |
| Tema | Mengikuti HP |
| Paragraf pembukaan | Hanya konteks; AI menyempurnakannya, paragraf asli tidak masuk naskah |
| Arahan lanjutan | Tidak masuk naskah; AI mengembangkannya |
| Setup cerita | Lewat pesan pertama chat (brief), bukan formulir |
| Agent kustom | Tidak dibuat |
| Sub-page | Ya, satu tingkat (cerita → bab) |
| Saran bab baru | Di 5.000 kata, bisa diubah |
| Tulis ke page | Saklar di kolom input |
| Chat per cerita | Satu chat utama + chat diskusi |
| Coba lagi | Simpan maksimal 3 versi |
| Lampiran | Gambar (baca saja) dan file teks |
| Pembuatan gambar | Tidak dibuat |
| Penyedia AI | DeepSeek, Vikey, Poolside, OpenRouter bawaan, plus penyedia lain berformat OpenAI; model bisa diganti per pesan |
