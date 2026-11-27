# Chat Story — Spesifikasi Aplikasi

Aplikasi Android (PWA dan APK) untuk menulis cerita hobi bersama AI (DeepSeek, Vikey, Poolside, TokenKoding, OpenRouter, atau penyedia lain berformat OpenAI), dengan alur kerja seperti Notion mobile + Notion AI, tetapi hanya berisi fitur yang dibutuhkan. Mulai Versi 3 ada modul **Roleplay** (bagian 14).

Status: Versi 1, 2, dan 3 (3.0–3.2) selesai. **3.3 (konsistensi cerita): rancangan, menunggu persetujuan.**

---

## 1. Prinsip

- **Dua modul:** menulis cerita bersama AI, dan (Versi 3) roleplay dengan karakter buatan sendiri. Tidak ada fitur di luar itu.
- **Data hanya di HP.** Tidak ada server, akun, atau sinkronisasi cloud.
- **Hemat secara default:** thinking mati, cache penyedia dimaksimalkan, biaya terlihat di setiap balasan (kalau harga model diketahui).
- **Mirip Notion mobile:** Beranda berisi daftar page, page langsung menampilkan naskah, Ask AI di bawah, chat AI menulis langsung ke page.
- **Bahasa antarmuka:** Indonesia. **Tema:** mengikuti pengaturan HP (terang/gelap).

## 2. Platform dan teknologi

| Bagian | Pilihan |
|---|---|
| Bentuk aplikasi | PWA (Chrome Android → "Tambahkan ke layar utama") **dan APK Android** (Capacitor), dari kode yang sama |
| APK | Dibangun GitHub Actions, dirilis di GitHub Releases. Koneksi AI lewat plugin Android `StreamHttp` (tanpa batasan CORS, tetap streaming). Update: banner "versi baru → Unduh". Ditandatangani kunci tetap (`android/keystore.p12.enc`, password = secret `APK_KEY_PASSWORD`) |
| UI | React + TypeScript + Vite |
| Editor | TipTap (ProseMirror) |
| Penyimpanan | IndexedDB (via Dexie), dengan permintaan *persistent storage* |
| PWA | vite-plugin-pwa (offline + update otomatis) |
| AI | `fetch` langsung ke penyedia pilihan (format OpenAI Chat Completions, streaming) |
| Hosting | GitHub Pages, deploy otomatis via GitHub Actions dari repo ini |


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

**Geser antar layar utama** (Versi 2): urutan **Pengaturan ← Beranda → Chat → Roleplay** (tab Roleplay mulai Versi 3, lihat 14.1). Geser jari ke kiri untuk layar di kanan, ke kanan untuk layar di kiri; tombol di atas (avatar, Beranda, Chat) tetap bisa diketuk.
- Tidak aktif kalau gerakan dimulai di tepi layar (dipakai gestur back Android), di kolom isian, atau di area yang bisa digeser ke samping (kartu Terbaru).
- Layar sebelah ikut bergeser menempel jari (seperti ViewPager Android). Di layar paling ujung, layar tidak bergeser.
- **Bar tab di atas tetap diam** (dipakai bersama ketiga layar); hanya isi layar yang bergeser. Penanda tab aktif bergeser dan berubah bentuk mengikuti jari (lingkaran di avatar Pengaturan, pil di Beranda dan Chat), dengan animasi yang sama dengan isi layar. Pengaturan tidak lagi punya tombol ‹ sendiri; kembali lewat tab Beranda atau tombol back Android.
- Riwayat: Beranda adalah akar. Back dari Chat atau Pengaturan selalu kembali ke Beranda, tidak bolak-balik antar tab.

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
Tampilan dan perilaku mengikuti aplikasi chat AI pada umumnya (ChatGPT, Claude, Notion AI).

- **Atas:** ‹ kembali, judul chat, 🕘 riwayat, ✏️ chat baru. Di bawahnya chip page `📄 Judul cerita`.
- **Brief** (pesan pertama chat utama) disematkan di atas daftar pesan dan bisa dilipat.
- **Balasan yang menulis ke page** tampil sebagai kartu ringkas: `✍ Ditulis di Bagian 3 · 642 kata · Rp9 · model`. Ketuk untuk membuka bagian itu di page.
- **Balasan diskusi** tampil sebagai teks biasa.
- **Deretan ikon hanya di balasan terakhir:** Salin, Coba lagi, pemilih versi ‹ 1/3 ›, "Lanjutkan dari sini" (kalau terputus), dan ⋯ (menu aksi).
- **Tahan bubble** membuka sheet aksi:
  - Pesan terakhir: Salin · Edit & tulis ulang · Kirim ulang · Pilih teks · Hapus.
  - Pesan lama: Salin · Pilih teks (pesan lama tidak bisa diedit).
  - Brief: Salin · Edit brief saja · Pilih teks (+ Edit & tulis ulang pembukaan kalau belum ada lanjutan).
  - Balasan AI: Salin · Buka di page · Pilih teks (diskusi); balasan terakhir juga Coba lagi, Lanjutkan dari sini, Batalkan.
- **Error** tampil sebagai satu baris merah (ketuk untuk teks lengkap); Coba lagi ada di deretan ikon.
- **Pasangan yang dibatalkan** dilipat jadi satu baris tipis "N balasan dibatalkan" (ketuk untuk melihat).
- **Tombol ↓** muncul saat menggulir ke atas; daftar hanya mengikuti pesan baru kalau pengguna di bawah.
- **Kolom ketik:** teks, lalu satu baris: `+` (Foto, File teks) · chip mode · chip model · tombol kirim.
  - **Chip mode** (`✍ Normal`, `✍ Bab baru · Panjang`, `✍ Pembukaan`, `💬 Diskusi`) membuka sheet: Tulis ke page / Diskusi, tujuan (akhir bab terakhir / bab baru), panjang (Pendek / Normal / Panjang).
  - **Chip model** membuka daftar model dan saklar mode berpikir. Ikon lampu = berpikir nyala; titik oranye = jam peak DeepSeek. Chat mengingat model terakhir yang dipakai.
  - **Tombol kirim** berubah menjadi **Lanjutkan** saat kolom kosong dalam mode tulis (AI melanjutkan tanpa arahan); menjadi **Stop** selama AI menulis.
  - Maksimal satu catatan di atas kolom ketik (bisa ditutup): API key belum ada, model tidak bisa membaca gambar, saran bab baru, atau info bab lama.
  - Draf yang belum terkirim disimpan otomatis. Mode (tulis/diskusi) dan model mengikuti pesan terakhir di chat itu.
  - ✏️ di chat cerita membuka chat diskusi baru untuk cerita yang sama.
- **Selama AI menulis:** layar dijaga tetap menyala (Wake Lock), dan aplikasi pindah ke page supaya tulisan terlihat mengalir.

### 4.3a Navigasi tanpa riwayat berulang
- Tombol back Android dan Esc menutup sheet paling atas dulu (CloseWatcher), baru kemudian halaman.
- Tombol ‹ di halaman yang dibuka langsung (tautan/bookmark) kembali ke Beranda, bukan keluar aplikasi.
- Page dan bab yang dibuat lalu ditinggal tanpa diisi apa pun dihapus otomatis.
- Page membuka chat; setelah mengirim, chat **kembali** ke page itu (history back), bukan membuka page baru.
- Kalau chat tidak dibuka dari page tujuan (chat baru dari Beranda, dari daftar chat, atau menulis ke bab baru), page **menggantikan** chat di riwayat.
- Pindah antara page cerita dan bab (breadcrumb, daftar bab, Bab sebelumnya/berikutnya) menggantikan entri riwayat, jadi back dari page mana pun langsung kembali ke halaman sebelum cerita dibuka.

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
- **Penyedia AI:** daftar penyedia (DeepSeek, Vikey, Poolside, TokenKoding, OpenRouter bawaan, plus penyedia lain yang bisa ditambah). Per penyedia: nama, base URL, API key, tes koneksi, dan daftar model. Per model: model id, nama tampilan, bisa membaca gambar atau tidak, cara mengatur thinking, dan harga per 1 juta token (USD atau Rupiah; boleh kosong), tagihan minimal per permintaan, dan batas konteks. Tombol **Ambil daftar model** mengisi model dari endpoint `/models` penyedia.
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
- Kalau model menolak mode berpikir dimatikan ("reasoning is mandatory"), permintaan diulang otomatis tanpa parameter berpikir dengan batas token lebih besar, dan model itu diingat selama aplikasi terbuka.
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
- **Brief** = pesan pertama yang dikirim dalam mode tulis (diskusi sebelumnya tidak dihitung). Brief **selalu** dikirim, walaupun pembukaannya sudah dihapus dari naskah.
- **Pembukaan** = pesan tulis pertama di chat utama. Kalau page sudah berisi teks manual, instruksinya meminta AI melanjutkan dan mengembangkan teks awal itu menjadi pembukaan.
- **Pengingat aturan** (*author's note*): teks pendek per cerita yang ditempel di akhir setiap permintaan menulis lanjutan (bukan pembukaan). Bawaannya diambil otomatis dari bagian "aturan lanjutan" di brief; bisa diedit atau dimatikan dari brief yang disematkan. Tidak disimpan ke riwayat, jadi cache tidak terganggu.
- **Penanda bab:** setiap bab yang punya isi diawali `[Bab berikutnya dimulai: "Judul"]` di konteks. Kalau AI menulis di bab yang masih kosong, permintaan itu diberi catatan "awal bab".
- **Keluarkan dari konteks:** pasangan diskusi bisa dikeluarkan (dan dimasukkan lagi) lewat menu tahan bubble.
- **Coba lagi / Lanjutkan dari sini / Edit & tulis ulang** memakai model yang sedang dipilih di chip model.
- **Ukuran konteks:** perkiraan token cerita tampil di sheet model. Setiap model punya isian batas konteks; kalau cerita melewati 85% batas model, muncul peringatan.
- **Bab:** konteks disusun mengikuti urutan bab. Judul bab disisipkan sebagai heading di awal balasan pertama bab itu, supaya AI tahu batas bab.
- **Pesan diskusi** di chat utama ikut konteks di posisi kronologisnya.
- **Paragraf AI vs paragraf penulis:** setiap paragraf tahu siapa penulisnya. Teks AI yang diedit atau dipecah (Enter di tengah) tetap milik AI. Paragraf baru yang diketik penulis, dan teks yang ditempel, milik penulis.
- **Teks manual:** untuk konteks AI, paragraf penulis dibaca bersama balasan AI di atasnya. Coba lagi, Batalkan, dan ganti versi hanya mengubah paragraf milik AI; paragraf penulis tidak pernah ikut terhapus.
- **Menulis ulang yang nyambung:** saat Coba lagi, Edit & tulis ulang, atau Lanjutkan dari sini, paragraf penulis di bawah balasan itu ikut dikirim sebagai "teks sesudahnya", dan AI diminta menulis supaya nyambung ke situ. Tulisan baru ditempatkan di posisi balasan lama (di atas paragraf penulis), dan selama menulis teksnya mengalir di posisi itu. Kalau sebuah bab hanya berisi teks manual, teks itu dikirim sebagai pesan user berlabel "teks yang ditulis penulis".
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
- **Restore:**
  - **Gabungkan:** item yang belum ada ditambahkan; yang ada di keduanya memakai versi yang lebih baru. Pengaturan di HP tidak diubah.
  - **Ganti semua:** konfirmasi kedua, lalu data sekarang diunduh dulu sebagai file pengaman. Penyedia AI dan API key di HP tetap ada.
  - Item yang di backup ada di Sampah mendapat masa 30 hari baru.
- **Backup otomatis sebelum pembaruan:** sebelum pembaruan yang mengubah format data, seluruh data disalin di HP (tanpa API key) dan bisa diunduh dari Pengaturan → Data.
- **Backup** baru dianggap selesai kalau file benar-benar dibagikan atau diunduh (menutup menu share = batal).
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

**Penomoran:** nomor utama aplikasi mengikuti Versi di dokumen ini. Fitur Versi 2 pertama dirilis sebagai **2.0.0**, fitur berikutnya 2.1.0, 2.2.0, dan seterusnya; perbaikan kecil menaikkan angka terakhir. Setiap rilis di `main` otomatis membuat APK baru di Releases.

**Versi 1 (1.0–1.5):** semua yang dijelaskan di bagian 1–11.

**Versi 2**, urutan pengerjaan:

| # | Fitur | Rilis |
|---|---|---|
| 1 | **TokenKoding sebagai penyedia bawaan** (harga Rupiah, minimal Rp10 per permintaan; penyedia TokenKoding yang dulu ditambahkan sendiri otomatis menjadi bawaan tanpa kehilangan API key dan riwayat). **Biaya minimum per permintaan** bisa diisi per model. **Ambil daftar model** dari endpoint `/models` penyedia (di APK berlaku untuk semua penyedia; di versi web hanya penyedia yang mengizinkan CORS). **Geser antar layar utama.** | 2.0.0 |
| 2 | **Backup otomatis di APK:** backup mingguan ke `Documents/ChatStory/otomatis` saat aplikasi dibuka atau disembunyikan, hanya kalau ada perubahan; 4 file terakhir disimpan. Bisa dimatikan di Pengaturan → Data. | 2.1.0 |
| 3 | **Cari & ganti** (ikon 🔍 di page): huruf besar/kecil, kata utuh, sebelumnya/berikutnya, ganti satu, ganti semua, dan pilihan **seluruh cerita** (semua bab; perubahan di bab lain tidak bisa di-undo, jadi dikonfirmasi dulu). **Tandai tulisan saya:** tombol 👤 di bar format muncul kalau kursor/pilihan berada di paragraf tulisan AI; paragraf itu tidak diganti lagi saat Coba lagi. Dibuat sebagai tombol, bukan tahan lama, karena tahan lama di editor Android dipakai untuk memilih teks. | 2.1.0 |
| 4 | **Catatan cerita** (*story bible*): teks bebas per cerita, tampil di brief tersemat dan menu page. Dikirim di bagian akhir setiap permintaan menulis (dekat pengingat aturan), supaya mengubah catatan tidak mereset cache naskah. Saat bab sebelumnya selesai, kolom ketik menawarkan **Perbarui**: AI mengusulkan catatan baru dari bab itu, penulis memeriksa lalu Terima atau Batal. | 2.1.0 |
| 5 | **Ringkasan bab lama:** mode Otomatis (bawaan; aktif kalau cerita melewati 60% batas konteks model), Selalu, atau Mati, per cerita. 2 page terakhir selalu dikirim utuh. Ringkasan dibuat sekali per bab dan disimpan (supaya tetap kena cache), dibuat ulang kalau bab diubah, dan bisa diedit. Menu page → Ringkasan bab lama. | 2.1.0 |
| 6 | **Pilih teks → tulis ulang:** tombol ✦ di bar format saat ada teks terpilih. Pilihan Perhalus / Perpanjang / Persingkat atau arahan sendiri. AI membaca brief, catatan cerita, teks sebelum dan sesudahnya. Hasil ditampilkan dulu (Ganti / Coba lagi / Batal); setelah diganti bisa di-Undo. | 2.1.0 |
| 7 | **Lampiran PDF:** teks diambil langsung di HP dengan pdf.js (gratis, semua penyedia, juga offline), dikirim seperti file teks. PDF hasil scan (berupa gambar) diberi pesan "tidak ada teks"; OCR menyusul. | 2.1.0 |

**Versi 3 (Roleplay):** lihat bagian 14.

| # | Fitur | Rilis |
|---|---|---|
| 1 | Tab Roleplay, karakter (tulis sendiri, buat dengan AI, impor kartu PNG/JSON), persona, chat roleplay dengan versi balasan, edit/hapus pesan, Bantu persona, memori chat, ringkasan pesan lama, lorebook, pengingat aturan, ekspor kartu, backup | 3.0.0 ✓ |
| 2 | Perbaikan: persona terhapus, ringkasan per blok, chat panjang, batas konteks roleplay, riwayat biaya karakter, kata kunci kedua lorebook, pengaman balasan, kotak teks di sheet | 3.0.1 ✓ |
| 3 | Foto avatar (lihat, perbesar, crop saat unggah), model & kreativitas per karakter, lihat yang dikirim ke AI, saran balasan, cabang chat, sematkan & cari pesan, jadikan cerita, gaya cerita per chat (bagian 14.12) | 3.1.0 ✓ |
| 4 | Group chat: beberapa karakter dalam satu chat (bagian 14.13) | 3.2.0 ✓ |
| 5 | Konsistensi cerita: keadaan adegan otomatis, memori linimasa & rencana otomatis, instruksi kesinambungan, suhu Konsisten (bagian 14.14) | 3.3.0 |

**Tidak dibuat:** pembuatan gambar, sinkronisasi cloud, kolaborasi, agent/asisten kustom, database/tabel, template, input suara terpisah (pakai ketik suara Gboard), sub-page lebih dari satu tingkat. Untuk Roleplay: galeri/berbagi karakter publik, script lorebook, suara (TTS).

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
| Lampiran | Gambar (baca saja), file teks, dan PDF (teksnya) |
| Pembuatan gambar | Tidak dibuat |
| Penyedia AI | DeepSeek, Vikey, Poolside, OpenRouter bawaan, plus penyedia lain berformat OpenAI; model bisa diganti per pesan |
| Modul roleplay | Versi 3, tab sendiri di kanan Chat, riwayat chat terpisah dari chat cerita |
| Gaya roleplay | Bahasa Indonesia, narasi orang ketiga, AI tidak memerankan persona pengguna |
| Kartu karakter | Format standar Character Card V2/V3 (PNG/JSON) supaya kartu dari Chub/SillyTavern bisa dipakai |

---

## 14. Versi 3: Modul Roleplay

Bermain peran dengan karakter buatan sendiri, mirip Janitor AI dan SillyTavern, tetapi tetap lokal di HP dan memakai penyedia AI yang sama dengan modul cerita. Pembanding: [Janitor AI](https://janitorai.com), [SillyTavern](https://docs.sillytavern.app), [Character Card V2](https://github.com/malfoyslastname/character-card-spec-v2).

### 14.1 Navigasi dan riwayat
- **Tab baru Roleplay** (ikon 🎭) di kanan tab Chat: **Pengaturan ← Beranda → Chat → Roleplay**. Bisa digeser dan diketuk seperti tab lain. Back dari Roleplay kembali ke Beranda.
- **Riwayat terpisah.** Tab Chat tetap hanya berisi chat cerita (chat utama, diskusi, chat bebas). Chat roleplay hanya ada di tab Roleplay dan di halaman karakternya. Alasannya, chat roleplay biasanya jauh lebih banyak dan panjang, dan dikelompokkan per karakter, bukan per cerita.
- **Cari** juga menemukan karakter dan chat roleplay, dalam kelompok sendiri di bawah hasil cerita.
- **Sampah** menampung karakter, persona, dan chat roleplay yang dihapus (30 hari), sama seperti cerita.

```
Tab Roleplay ─┬─ Halaman karakter ─┬─ Chat roleplay
              │                    └─ Editor karakter ── Lorebook
              ├─ Persona saya ── Editor persona
              └─ Lorebook dunia
```

### 14.2 Tab Roleplay
- **Atas:** baris tab yang sama (avatar, Beranda, Chat, Roleplay).
- **Lanjutkan:** kartu horizontal chat roleplay terakhir: avatar karakter, nama, cuplikan pesan terakhir, waktu.
- **Karakter:** daftar karakter (avatar, nama, tag, jumlah chat), urut terakhir dipakai. Yang di-pin di atas. Filter tag.
- **Menu `⋯` / tahan lama karakter:** edit, pin, duplikat, ekspor kartu, hapus.
- **Bawah daftar:** tautan **Persona saya** dan **Lorebook dunia**.
- **Bar bawah:** 🔍 Cari · **＋ Karakter baru** · 👤 Persona saya.
  - ＋ Karakter baru membuka sheet: **Tulis sendiri** · **Buat dengan AI** · **Impor kartu** (PNG/JSON).
- **Kosong:** ajakan "Buat karakter pertama" dengan ketiga pilihan di atas.

### 14.3 Halaman karakter
- Avatar besar, nama, tag, dan **catatan pembuat** (kalau ada; tidak dikirim ke AI).
- **Mulai chat:** kalau ada beberapa pesan pembuka, pilih dulu (bisa juga diganti di chat sebelum Anda membalas). Persona memakai persona yang diikat ke karakter ini, atau persona bawaan. Kalau belum ada persona sama sekali, aplikasi menanyakan nama Anda dulu dan membuat persona bawaan.
- **Chat dengan karakter ini:** judul, cuplikan pesan terakhir, waktu. Tahan lama: ganti nama, duplikat, hapus.
- **Menu `⋯`:** edit karakter, lorebook karakter, ekspor kartu (PNG/JSON), duplikat, hapus (chat-chatnya ikut ke Sampah).

### 14.4 Editor karakter
Kolom (label Indonesia, nama kolom kartu dalam kurung):

| Kolom | Isi |
|---|---|
| Avatar | Foto dari galeri, dipotong persegi dan diperkecil |
| Nama* (`name`) | Nama karakter, menggantikan `{{char}}` |
| Tag (`tags`) | Untuk mengelompokkan |
| Deskripsi (`description`) | Siapa dia: penampilan, latar, sifat, kebiasaan, cara bicara |
| Kepribadian (`personality`) | Ringkasan sifat |
| Skenario (`scenario`) | Situasi dan hubungan di awal roleplay |
| Pesan pembuka (`first_mes`) + pembuka alternatif (`alternate_greetings`) | Bisa lebih dari satu; dipilih saat mulai chat |
| Contoh dialog (`mes_example`) | Contoh gaya bicara, blok diawali `<START>` |
| *Lanjutan (dilipat):* Instruksi sistem khusus (`system_prompt`) | Menggantikan instruksi roleplay bawaan kalau diisi |
| *Lanjutan:* Pengingat aturan karakter (`post_history_instructions`) | Dikirim di akhir setiap permintaan |
| *Lanjutan:* Catatan pembuat (`creator_notes`) | Tidak dikirim ke AI |
| *Lanjutan:* Persona yang diikat | Persona yang otomatis dipakai di chat baru dengan karakter ini |

- **Tersimpan otomatis** begitu nama terisi (seperti page). Tombol **Selesai** membuka halaman karakter.
- Perkiraan token kartu tampil di bawah, dengan peringatan kalau kartu sangat besar (mis. > 3.000 token).
- **Buat dengan AI:** tulis ide singkat (mis. "gitaris band SMA yang sinis tapi peduli, latar Bandung 2005"), AI mengisi semua kolom. Hasilnya ditampilkan di editor untuk diperiksa, tidak langsung disimpan.
- **✦ per kolom:** Kembangkan / Persingkat / Perbaiki satu kolom dengan AI. Hasil langsung masuk ke kolom, dengan tautan **Urungkan**.
- **Terjemahkan ke bahasa Indonesia:** untuk kartu impor berbahasa lain. AI menerjemahkan semua kolom; hasilnya diperiksa dulu.
- Penanda `{{char}}` dan `{{user}}` boleh dipakai di semua kolom.

### 14.5 Persona
- Persona = siapa Anda di roleplay: avatar, nama (menggantikan `{{user}}`), deskripsi (penampilan, sifat, latar, hal yang perlu diketahui karakter).
- Boleh lebih dari satu. Satu ditandai **bawaan**.
- **Buat dengan AI** dari ide singkat, sama seperti karakter.
- Persona dipilih per chat (chip persona di kepala chat). Mengganti persona berlaku untuk pesan berikutnya.

### 14.6 Chat roleplay
- **Atas:** ‹ kembali, avatar + nama karakter, chip persona, `⋯`.
- **Menu `⋯`:** Memori chat · Ringkasan pesan lama · Lorebook · Pengingat aturan chat · Panjang balasan · Ganti nama · Riwayat biaya · Hapus chat.
- **Pesan:**
  - Balasan karakter di kiri dengan avatar dan nama. Pesan Anda di kanan dengan avatar persona.
  - Teks dirender: narasi biasa, dialog dalam tanda kutip, *miring* untuk pikiran atau penekanan, **tebal**.
  - Pesan pembuka tampil sebagai balasan pertama karakter. Sebelum Anda membalas, pembuka bisa digeser untuk memilih pembuka lain.
- **Balasan terakhir:** geser kiri/kanan (atau ‹ 2/5 ›) untuk melihat versi lain. Coba lagi membuat versi baru, maksimal 10 versi. Juga ada Salin, Lanjutkan (kalau terpotong), dan `⋯`.
- **Tahan pesan:** Salin · Edit (semua pesan, milik Anda maupun karakter; mengedit pesan lama tidak menulis ulang pesan sesudahnya) · Hapus pesan ini · Hapus dari sini ke bawah · Coba lagi (balasan terakhir).
- **Kolom ketik:** teks · chip model · tombol **✦ Bantu persona** · tombol kirim.
  - **Bantu persona** (*impersonate*): AI menulis giliran Anda sebagai persona, sesuai alur terakhir. Kalau kolom ketik berisi arahan singkat (mis. "aku menolak dengan halus lalu pergi"), AI mengembangkannya. Hasil masuk ke **kolom ketik** untuk diedit, tidak langsung dikirim. Coba lagi dengan mengetuk tombolnya lagi.
  - Kalau kolom ketik berisi teks, tombol **✦ Bantu** membuka pilihan: Kembangkan jadi giliran utuh, atau **Perhalus pesanku**. Perhalus juga ada di menu tahan pesan Anda yang paling akhir. Hasil ditampilkan dulu (Ganti / Coba lagi / Batal).
  - Kolom kosong → tombol kirim menjadi **Lanjutkan**: karakter melanjutkan adegan tanpa giliran Anda. (Balasan yang terpotong disambung lewat tombol **Sambung balasan** di bawah balasan itu.)
  - Selama AI menulis → tombol **Stop**. Teks yang sudah masuk tetap tersimpan.
- **Panjang balasan** per chat: Pendek (±100–200 kata) · Normal (±250–400 kata, bawaan) · Panjang (±500–800 kata).
- Draf, model, dan thinking mengikuti cara chat cerita (draf tersimpan otomatis, model terakhir diingat per chat).

### 14.7 Memori
- **Memori chat** (*chat memory*): catatan bebas per chat berisi hubungan, situasi sekarang, fakta yang sudah pasti, dan tujuan yang belum selesai. Bisa diedit dari menu chat. Setiap kira-kira 30 pesan, kolom ketik menawarkan **Perbarui memori**: AI mengusulkan memori baru dari pesan terbaru, Anda Terima atau Batal (mekanisme catatan cerita Versi 2).
- **Ringkasan pesan lama:** mode Otomatis (bawaan) · Selalu · Mati.
  - Otomatis aktif kalau chat melewati **batas konteks roleplay** per chat: 16 / 32 (bawaan) / 64 / 128 ribu token, atau "Model" (60% batas konteks model). Batas model saja tidak cukup, karena model DeepSeek dan TokenKoding berkonteks ±1 juta token sehingga ringkasan hampir tidak pernah aktif dan biaya per giliran terus naik.
  - Batas blok mengikuti ringkasan yang sudah tersimpan: menghapus satu pesan lama hanya membuat blok pesan itu diringkas ulang. Ringkasan yang pesannya sudah terhapus semua dibuang. Duplikat chat ikut menyalin ringkasannya.
  - Pesan lama diringkas per blok ±30 pesan. Setiap ringkasan dibuat sekali, disimpan (supaya tetap kena cache), dibuat ulang kalau ada pesan di blok itu yang diedit atau dihapus, dan bisa diedit.
  - 30 pesan terakhir selalu dikirim utuh. Pesan pembuka selalu dikirim utuh.
- **Lorebook:**
  - **Lorebook karakter** (ikut kartu, ikut diekspor) dan **lorebook dunia** (berdiri sendiri, bisa dipasang ke beberapa karakter, mis. satu dunia untuk banyak karakter).
  - Entri: judul, kata kunci (dipisah koma), isi, saklar aktif, saklar **selalu dikirim**, urutan prioritas.
  - Entri dikirim kalau salah satu kata kuncinya muncul di 4 pesan terakhir atau di pesan yang sedang dikirim (huruf besar/kecil tidak dibedakan, kata utuh). Jangkauan bisa diubah per lorebook.
  - Batas: entri yang cocok dikirim sampai 1.500 token (bisa diubah), urut prioritas. Sisanya dilewati, dengan penanda di info pesan.
  - Info balasan (tahan → Info) menampilkan entri lorebook yang aktif saat balasan itu ditulis.
  - **Kata kunci kedua** (opsional) dengan syarat: dan salah satu / dan semua / dan tidak ada / dan tidak semua. **Bedakan huruf besar/kecil** per entri. Keduanya dibaca dari dan disimpan ke kartu SillyTavern (`secondary_keys`, `selective`, `selectiveLogic`, `case_sensitive`).

### 14.8 Susunan pesan
```
system    : instruksi roleplay bawaan (atau instruksi sistem khusus kartu)
            + kartu karakter (deskripsi, kepribadian, skenario)
            + persona Anda
            + contoh dialog
            + entri lorebook "selalu dikirim"
assistant : pesan pembuka (selalu utuh)
user      : [ringkasan pesan lama 1..n]        ← kalau ringkasan dipakai, di posisi kronologisnya
user      : pesan Anda 1
assistant : balasan 1 (versi yang dipilih)
...
user      : pesan Anda terbaru
            + [entri lorebook yang cocok] + [memori chat]
            + [pengingat aturan karakter/chat] + target panjang   ← tidak disimpan ke riwayat
```
- **Instruksi roleplay bawaan:** memerankan `{{char}}` dan tokoh lain di sekitarnya; bahasa Indonesia; narasi orang ketiga, dialog dalam tanda kutip; **tidak menulis aksi, ucapan, atau pikiran `{{user}}`**; tidak mengulang kalimat dari balasan sebelumnya; tidak keluar dari peran; mengakhiri balasan di titik yang memberi giliran ke `{{user}}`.
- **Hemat cache:** bagian tetap di depan, riwayat menyambung (*append-only*), bagian yang berubah tiap giliran (lorebook yang cocok, memori, pengingat) hanya ditempel di pesan terakhir dan tidak disimpan. Mengedit kartu, persona, atau pesan lama membuat cache reset dari titik itu, untuk satu permintaan berikutnya.
- **Pengaman balasan:** label nama di awal balasan ("Rika: …") dibuang. Kalau AI mulai menulis baris yang diawali nama persona ("Dimas: …"), balasan dipotong di situ dan permintaan dihentikan (hemat token); Info balasan menandainya. Bantu persona memakai pengaman yang sama dengan arah sebaliknya.
- **depth_prompt** kartu SillyTavern (catatan karakter) bisa diedit di Lanjutan dan dikirim di akhir permintaan bersama pengingat aturan, bukan di kedalaman tertentu, supaya riwayat tetap kena cache.
- **Persona** yang dihapus tidak dipakai lagi: chat lama dan chat baru jatuh ke persona bawaan.
- **Bantu persona** memakai susunan yang sama, dengan instruksi terakhir "tulis giliran `{{user}}` berikutnya sesuai persona" dan hasilnya tidak disimpan ke riwayat.
- `{{char}}` dan `{{user}}` diganti nama karakter dan persona saat dikirim. Isi kartu disimpan apa adanya.
- Temperature mengikuti pengaturan kreativitas (sama dengan cerita). Thinking bawaan mati.

### 14.9 Impor dan ekspor kartu
- **Impor:** file PNG (data kartu di dalam gambar, chunk `chara` untuk V2 dan `ccv3` untuk V3) atau JSON. Diambil: nama, deskripsi, kepribadian, skenario, pembuka dan pembuka alternatif, contoh dialog, instruksi sistem, pengingat aturan (`post_history_instructions`), catatan pembuat, tag, dan lorebook karakter (`character_book`). Gambar PNG menjadi avatar.
- Kolom yang tidak dipakai aplikasi (mis. `extensions`) tetap disimpan, supaya ekspor ulang tidak kehilangan data.
- Setelah impor, editor terbuka untuk diperiksa. Kalau kartu bukan berbahasa Indonesia, editor menawarkan **Terjemahkan ke bahasa Indonesia**.
- **Ekspor:** PNG (avatar + data kartu V2) dan JSON, lewat menu share atau simpan file.
- Janitor AI tidak menyediakan unduhan kartu resmi, jadi karakter dari sana disalin manual ke editor.
- Format file backup naik ke skema 2. Aplikasi versi lama menolak backup baru dengan pesan "perbarui aplikasi dulu", supaya data roleplay tidak hilang diam-diam.

### 14.10 Data
| Entitas | Isi utama |
|---|---|
| **Karakter** | id, nama, avatar (blob), kolom kartu (14.4), tag, persona yang diikat, lorebook dunia yang dipasang, data kartu tambahan, pin, dibuat/diubah/dipakai terakhir, dihapusPada |
| **Persona** | id, nama, avatar, deskripsi, bawaan, dibuat/diubah, dihapusPada |
| **Lorebook** | id, nama, milik karakter (characterId) atau dunia, jangkauan pindai, batas token, entri (judul, kata kunci, isi, aktif, selalu dikirim, prioritas) |
| **Chat roleplay** | tabel Chat yang sudah ada, jenis `roleplay`: characterId, personaId, pembuka yang dipilih, memori, mode ringkasan, panjang balasan, pengingat aturan chat |
| **Pesan** | tabel Pesan yang sudah ada; balasan karakter menyimpan versi (maks. 10) dan versi aktif |
| **Ringkasan** | chatId, pesan pertama–terakhir yang diringkas, teks, waktu dibuat |

- Backup, restore (gabungkan/ganti semua), dan backup otomatis APK ikut mencakup semua tabel baru.
- Migrasi otomatis ke skema baru, dengan backup sebelum pembaruan seperti biasa.

### 14.11 Biaya
- Setiap balasan menampilkan biaya seperti chat cerita. Bantu persona, ringkasan, usulan memori, dan perhalus dicatat di **riwayat biaya** chat. Halaman karakter → Riwayat biaya merangkum total tiap chat ditambah Buat dengan AI, terjemahan, dan ✦ per kolom. Biaya bantuan AI untuk persona tampil di Persona saya.
- Chat panjang: hanya 120 pesan terakhir yang digambar (tombol **Tampilkan pesan sebelumnya** untuk yang lebih lama), dan baris pesan yang tidak berubah tidak digambar ulang saat mengetik atau saat AI menulis.
- Chat roleplay biasanya panjang, jadi peringatan batas konteks (85% batas model) dan ringkasan otomatis (batas konteks roleplay) sama pentingnya dengan di cerita.

### 14.12 Versi 3.1

#### a. Foto avatar
- **Lihat foto:** ketuk avatar karakter atau persona di chat roleplay (di kepala chat, di samping pesan, dan di chip persona), juga avatar besar di halaman karakter. Foto muncul sebagai **jendela kecil yang melayang** di atas chat, seperti picture-in-picture.
  - **Latar tidak digelapkan.** Chat di belakangnya tetap terlihat dan tetap bisa digulir dan dibaca. Ketuk di luar jendela tidak menutupnya.
  - Ukuran awal kira-kira 60% lebar layar, cukup untuk dilihat tanpa menutupi seluruh chat. Posisi awal di tengah agak ke atas.
  - **Geser jendela** untuk memindahkannya. Jendela tidak bisa keluar layar: tepinya berhenti di tepi layar.
  - **Cubit** atau **tahan pegangan di sudut jendela lalu geser** untuk memperbesar/memperkecil (dari ±120 px sampai selebar/setinggi layar). Foto ikut membesar bersama jendelanya.
  - **Ketuk dua kali** untuk bergantian antara ukuran awal dan ukuran besar.
  - Tombol kecil **✕** di pojok kanan atas jendela menutupnya. Tombol back Android juga menutup. Nama karakter/persona tampil kecil di bawah foto.
  - Membuka avatar lain mengganti isi jendela, posisi dan ukurannya tetap.
- **Foto asli disimpan** (sisi terpanjang maks. 1600 px) di samping avatar bulat, supaya overlay menampilkan foto utuh (mis. foto potret dari kartu Chub), bukan hanya potongan persegi. Avatar bulat dibuat dari foto asli sesuai potongan (crop) yang dipilih. Kartu impor PNG: gambar kartu menjadi foto asli.
- **Unggah foto (karakter dan persona):**
  1. Pilih foto dari galeri.
  2. **Indikator proses** tampil di atas editor: "Membaca foto… / Memproses…" dengan persentase saat membaca file, lalu animasi saat memperkecil. Tombol lain di editor nonaktif sampai selesai. Semua proses terjadi di HP (tidak ada unggahan ke internet); indikator ini menunjukkan proses di HP.
  3. **Layar crop:** bingkai lingkaran (pratinjau avatar) di atas foto. Geser foto untuk mengatur posisi, cubit atau slider untuk zoom. Tombol **Batal** dan **Pakai**.
  4. **Atur ulang potongan** tanpa memilih foto lagi: ketuk avatar di editor → Atur potongan / Ganti foto / Lihat foto / Hapus foto.
- Backup ikut menyimpan foto asli dan potongannya.

#### b. Model & kreativitas per karakter
- Editor karakter → Lanjutan: **Model bawaan** (Ikuti pengaturan, atau pilih model) dan **Kreativitas** (Ikuti pengaturan / Stabil / Normal / Liar).
- Urutan pilihan model di chat: model yang dipilih barusan → model terakhir di chat itu → **model bawaan karakter** → model default Pengaturan.
- Kreativitas karakter menggantikan kreativitas global untuk balasan karakter itu (Bantu persona dan saran balasan ikut).

#### c. Lihat yang dikirim ke AI
- Menu chat → **Lihat yang dikirim ke AI**: pratinjau permintaan berikutnya (memakai isi kolom ketik, atau "Lanjutkan" kalau kosong), tanpa mengirim apa pun.
- Dikelompokkan dengan perkiraan token per bagian: Instruksi · Kartu · Persona · Contoh dialog · Lore selalu · Ringkasan (n blok) · Riwayat (n pesan) · Lore yang cocok · Memori · Momen tersemat · Pengingat & gaya · Target panjang. Total dan perkiraan biaya (dengan cache).
- Setiap bagian bisa dibuka untuk melihat teks lengkap. Tombol **Salin semua**.

#### d. Saran balasan
- Tombol **✦ Bantu** membuka pilihan: **Tulis giliranku** (Bantu persona; kalau kolom ketik berisi teks: Kembangkan jadi giliran utuh), **Saran balasan**, dan **Perhalus pesanku** (kalau kolom ketik berisi teks).
- **Saran balasan**: AI memberi **3 pilihan** giliran singkat untuk persona (1–3 kalimat, gaya berbeda: mis. tenang, berani, bercanda), tampil sebagai kartu di atas kolom ketik.
- Ketuk satu → masuk ke kolom ketik untuk diedit. **↻** meminta 3 saran baru. ✕ menutup.
- Memakai konteks yang sama dengan Bantu persona; satu permintaan untuk 3 saran. Biaya dicatat di riwayat biaya chat.

#### e. Cabang chat
- Tahan pesan mana pun → **Buat cabang dari sini**: chat baru berisi semua pesan sampai pesan itu (termasuk versi balasan), memori, pengingat, gaya, persona, dan ringkasan blok yang tersalin utuh. Judul "… (cabang)".
- Chat cabang menampilkan "↳ Cabang dari *judul chat asal*" di kepala chat (ketuk untuk membuka chat asal). Daftar chat karakter menandai cabang.
- Berbeda dengan Duplikat (seluruh chat), cabang berhenti di pesan yang dipilih.

#### f. Sematkan & cari pesan
- Tahan pesan → **Sematkan**. Pesan tersemat diberi tanda 📌.
- Menu chat → **Pesan tersemat**: daftar pesan tersemat; ketuk untuk melompat ke pesan itu (pesan lama otomatis dimuat, lalu disorot sebentar). Lepas semat dari daftar atau menu pesan.
- **Dibaca AI sebagai momen penting:** pesan tersemat yang sudah tidak dikirim utuh (sudah masuk ringkasan) dikirim apa adanya di blok "[Momen penting]" di akhir permintaan, maksimal 1.500 token (yang terbaru didahulukan). Pesan tersemat yang masih dikirim utuh tidak diulang. Memori chat tidak diubah.
- Menu chat → **Cari di chat ini**: cari teks di semua pesan chat, hasil dengan cuplikan; ketuk untuk melompat. Tombol ‹ › untuk hasil berikutnya.

#### g. Jadikan cerita
- Menu chat → **Jadikan cerita**: mengubah sesi roleplay menjadi naskah prosa di modul cerita.
- Pilihan:
  - **Rentang:** seluruh chat, mulai dari pesan tersemat tertentu, atau N pesan terakhir.
  - **Tujuan:** cerita baru (judul usulan dari judul chat), atau bab baru di cerita yang sudah ada.
  - **Panjang:** ringkas (±40% dari panjang chat) / seimbang / lengkap (mendekati panjang chat).
- Proses: transkrip dibagi per ±30 pesan; setiap bagian ditulis ulang AI menjadi prosa orang ketiga berbahasa Indonesia (dialog dipertahankan, aksi dirapikan, sudut pandang konsisten), dengan akhir naskah bagian sebelumnya (±1.500 karakter) sebagai sambungan. Selama proses, page tujuan dikunci (bar "Menjadikan cerita · bagian n/m" dengan Stop). Tulisan mengalir ke page; bagian baru menjadi bab baru kalau melewati batas saran bab (5.000 kata). Bisa dihentikan; bagian yang sudah jadi tetap tersimpan.
- Cerita baru otomatis mendapat chat utama dengan **brief** yang disusun dari kartu karakter, persona, skenario, dan memori chat (bisa diedit), sehingga Ask AI bisa langsung melanjutkan ceritanya. Tulisan hasil konversi dianggap tulisan penulis (tidak diganti saat Coba lagi).
- Perkiraan biaya ditampilkan sebelum mulai.

#### h. Gaya cerita per chat
- Menu chat → **Gaya cerita**:
  - **Sudut pandang:** orang ketiga (bawaan) · orang kedua ("kamu" untuk {{user}}) · orang pertama (sebagai {{char}}).
  - **Peran AI:** pemeran {{char}} (bawaan) · narator/game master (AI menjadi narator dunia, memerankan semua tokoh, menggambarkan akibat tindakan {{user}}, dan boleh menawarkan pilihan).
  - **Tempo:** lambat (banyak detail dan suasana) · sedang · cepat (adegan bergerak maju).
  - **Ragam bahasa:** baku · santai (bawaan) · gaul.
- Dikirim sebagai blok "[Gaya]" di akhir permintaan (bersama pengingat), jadi mengubah gaya tidak mereset cache. Kalau sudut pandang bukan orang ketiga, instruksi bawaan menyesuaikan.

### 14.13 Versi 3.2: Group chat

#### a. Membuat dan mengelola grup
- **Buat:** tab Roleplay → ＋ → **Group chat baru**. Pilih 2–5 karakter (urutan pilihan = urutan anggota), persona, dan nama grup (bawaan: nama-nama anggota, mis. "Rika, Sari & Bayu").
- **Pembuka:** pilih karakter yang membuka dan pembukanya (dari pembuka kartu karakter itu), atau **Tanpa pembuka** (Anda yang mulai). Pembuka bisa digeser selama belum dibalas, seperti chat biasa.
- **Ubah chat 1:1 jadi grup:** menu chat → Anggota → Tambah karakter. Chat yang sama berlanjut; balasan lama ditandai milik karakter semula.
- Halaman karakter → menu → **Group chat baru dengan karakter ini** (karakter itu sudah terpilih).
- **Menu chat → Anggota:**
  - Daftar anggota dengan avatar (ketuk = jendela foto), atur urutan, **bisukan** sementara (tidak mendapat giliran otomatis/berurutan, tetap ada di cerita, masih bisa dipilih manual), dan keluarkan dari grup.
  - Karakter yang dikeluarkan atau dihapus: pesan lamanya tetap tampil dengan nama dan avatarnya (nama disimpan di pesan) dan tetap dikirim ke AI sebagai riwayat; kartunya tidak dikirim lagi.
  - Minimal satu anggota. Grup dengan satu anggota berperilaku seperti chat biasa.
- **Skenario grup** (opsional, menu chat): kalau diisi, menggantikan skenario masing-masing kartu (skenario kartu biasanya ditulis untuk berdua dengan {{user}} dan bisa bertentangan). Kosong = skenario semua kartu dikirim, berlabel nama karakter.

#### b. Tampilan
- Kepala chat: avatar anggota bertumpuk (maks. 3 + "+n"), nama grup, chip persona. Ketuk avatar bertumpuk = sheet Anggota.
- Setiap balasan menampilkan avatar dan nama karakter yang bicara.
- **Baris anggota** di atas kolom ketik: avatar kecil anggota yang tidak dibisukan; karakter yang akan bicara berikutnya diberi cincin. Ketuk avatar = karakter itu yang menjawab berikutnya (sekali); ketuk lagi = kembali otomatis.
- Tab Roleplay: grup tampil di **Lanjutkan** dengan avatar bertumpuk. Halaman karakter: grup yang diikuti karakter itu tampil di daftar chat, ditandai 👥.

#### c. Giliran bicara
- **Mode** (menu chat → Giliran bicara):
  - **Otomatis** (bawaan), tanpa biaya tambahan. Urutan pilihan: (1) karakter yang dipilih di baris anggota; (2) karakter yang namanya disebut paling akhir di pesan Anda; (3) karakter yang disebut di balasan terakhir (mis. ditanya karakter lain), selain yang baru bicara; (4) anggota yang paling lama tidak bicara. Karakter yang baru saja bicara tidak dipilih lagi, kecuali satu-satunya anggota aktif.
  - **Berurutan:** bergiliran sesuai urutan anggota.
  - **Manual:** tidak ada balasan otomatis setelah Anda mengirim; ketuk avatar di baris anggota untuk memilih siapa yang menjawab.
- **Balasan per giliran:** 1 (bawaan) · hingga 2 · hingga 3. Setelah Anda mengirim, karakter berikutnya ikut menanggapi berantai (setiap balasan = satu permintaan; karakter yang sudah menjawab di giliran itu tidak dipilih lagi). Stop menghentikan seluruh rantai.
- **Lanjutkan** (kolom kosong): karakter berikutnya menurut mode yang berlaku melanjutkan adegan, tanpa pesan pengguna di riwayat. Di mode Manual, Lanjutkan meminta Anda memilih karakter dulu.

#### d. Susunan pesan
```
system    : instruksi roleplay grup
            + kartu semua anggota, masing-masing berlabel nama (deskripsi, kepribadian)
            + skenario grup, atau skenario tiap kartu berlabel
            + persona Anda
            + contoh dialog tiap kartu (berlabel)
            + lore "selalu dikirim" dari semua lorebook anggota (tanpa duplikat)
assistant : Rika: pembuka
user      : giliran Anda
assistant : Rika: …
            Sari: …          ← balasan berurutan digabung dalam satu giliran assistant
user      : giliran Anda terbaru
            + [lore cocok] + [memori] + [momen tersemat] + [pengingat pembicara + chat] + [gaya]
            + [Giliran berikutnya: Sari. Tulis HANYA sebagai Sari.] + target panjang   ← tidak disimpan
```
- Di riwayat, setiap balasan diberi label nama pembicara ("Rika: …") dengan format yang selalu sama, supaya kena cache.
- **Instruksi grup:** memerankan beberapa tokoh; setiap balasan hanya sebagai tokoh yang diminta; tidak menulis ucapan/aksi {{user}} maupun anggota grup lain (mereka mendapat gilirannya sendiri); tokoh figuran di luar grup boleh diperankan; sudut pandang, tempo, dan ragam bahasa mengikuti Gaya cerita chat.
- `{{char}}` di setiap kartu diganti nama karakter kartu itu; di instruksi akhir diganti nama pembicara.
- **Pengaman balasan:** label nama pembicara di awal dibuang; balasan dipotong kalau mulai ada baris berlabel {{user}} atau anggota lain.
- Instruksi sistem khusus kartu (`system_prompt`) tidak dipakai di grup, karena ditulis untuk chat berdua; instruksi grup yang dipakai.
- Pengingat aturan kartu (`post_history_instructions`) dan depth prompt: hanya milik karakter yang sedang bicara. Kreativitas: milik pembicara. Model: pilihan di chat → model terakhir di chat → model bawaan anggota pertama → default.
- Lorebook: lorebook karakter semua anggota + lorebook dunia yang dipasang ke salah satu anggota (tanpa duplikat); batas token per lorebook seperti biasa.
- Menambah, mengeluarkan, membisukan, atau mengurutkan anggota dan mengubah skenario grup mengubah bagian system, jadi cache dimulai ulang sekali.

#### e. Fitur yang tetap berlaku
- **Coba lagi** menulis ulang balasan oleh karakter yang sama. Menu balasan → **Tulis ulang sebagai…** memilih anggota lain (jadi versi baru dengan pembicara itu; setiap versi menyimpan pembicaranya).
- Versi, Sambung balasan, edit, hapus, semat, cari, cabang, duplikat, memori, ringkasan (transkrip memakai nama pembicara), Bantu persona, saran balasan, gaya cerita, pratinjau (kartu tiap anggota tampil terpisah dengan tokennya), dan Jadikan cerita.
- Usulan memori untuk grup mencakup hubungan antar tokoh.
- Riwayat biaya chat seperti biasa; riwayat biaya karakter memasukkan grup yang diikutinya.
- Backup dan restore mencakup grup.

### 14.14 Versi 3.3: Konsistensi cerita

Tujuan: detail kecil (waktu, pakaian, barang yang dipegang, siapa di mana) tidak dilupakan atau dihidupkan lagi selama detail itu masih berhubungan dengan cerita. Contoh masalah di 3.2: permen karet yang sudah dibuang dikunyah lagi; "besok Minggu, libur" dilupakan; jaket yang sudah digantung di kursi masih dipakai.

**Penyebab di 3.2:** tidak ada catatan keadaan adegan; kartu (mis. "selalu memakai jaket") dikirim utuh di setiap permintaan tanpa penjelasan bahwa itu kebiasaan umum; memori diperbarui manual setiap ±30 pesan dan tidak mencatat waktu, pakaian, atau barang; ringkasan pesan lama membuang detail keadaan; tambahan aplikasi ditempel menyatu dengan pesan pengguna; `system_prompt` kartu menggantikan seluruh instruksi aplikasi.

#### a. Keadaan adegan (untuk AI)
- Catatan terstruktur yang **diperbarui otomatis setelah setiap balasan** lewat permintaan terpisah yang kecil. Tidak tampil di layar chat; hanya untuk AI.
- Bagian tetap:
  ```
  Waktu   : hari & waktu cerita (mis. Sabtu malam ±21.00, hari ke-2). Besok: Minggu, libur kuliah.
  Lokasi  : tempat sekarang
  Hadir   : siapa saja di adegan, posisinya kalau penting
  Pakaian : per tokoh: yang dipakai, dan yang dilepas beserta letaknya (mis. jaket kulit digantung di kursi)
  Barang  : yang dipegang / dibawa / ada di dekat tokoh; yang sudah dibuang, habis, atau ditinggal beserta letaknya
  Kondisi : fisik & emosi yang sedang berlaku (basah, mengantuk, luka di tangan kiri, marah ke Dimas)
  Sekitar : keadaan tempat yang berpengaruh (lampu mati, hujan deras, pintu dikunci)
  ```
- **Aturan pencatat:** pertahankan setiap detail selama masih berhubungan dengan cerita; ubah hanya kalau cerita mengubahnya; catat juga perubahan yang ditulis pengguna ("aku buang permenku"); detail yang sudah tidak berhubungan sama sekali (adegan lain, lama tidak disebut) boleh dihapus. Maks. ±350 kata.
- Masukan pencatat: keadaan sebelumnya, giliran pengguna terakhir, balasan terakhir, dan kartu ringkas (nama + deskripsi, sebagai acuan awal saja). Model: model chat itu, thinking mati, suhu Stabil, `max_tokens` ±700.
- **Disimpan per versi balasan** (snapshot keadaan sesudah balasan itu). Akibatnya Coba lagi, ganti versi, hapus pesan, edit, cabang, dan duplikat otomatis memakai keadaan yang benar: permintaan berikutnya memakai snapshot dari balasan terakhir sebelum titik itu. Mengedit pesan menghapus snapshot pesan itu; permintaan berikutnya menghitung ulang dari snapshot sebelumnya.
- **Urutan & kunci:** pencatatan berjalan segera setelah balasan selesai, di belakang layar. Kalau Anda mengirim sebelum selesai, pesan menunggu sebentar (kolom ketik menulis "Mencatat keadaan adegan…") karena balasan berikutnya butuh keadaan terbaru. Stop membatalkan pencatatan; sebelum balasan berikutnya keadaan dihitung dulu. Kalau pencatatan gagal, balasan tetap ditulis dengan snapshot terakhir yang berhasil, dan pencatatan diulang di giliran berikutnya.
- Group chat: semua tokoh yang hadir dicatat. Berantai: satu pencatatan per balasan.
- **Lihat & koreksi:** menu chat → **Keadaan adegan** menampilkan catatan saat ini dan bisa diedit (koreksi disimpan ke snapshot balasan terakhir dan dipakai di permintaan berikutnya). Saklar **Catat keadaan adegan** (bawaan nyala) per chat.
- Biaya dicatat di riwayat biaya chat sebagai "Keadaan adegan" (perkiraan ±Rp6 per giliran di DeepSeek Flash resmi; minimal Rp10 di TokenKoding karena tagihan minimal).

#### b. Memori: linimasa & rencana, otomatis
- Memori chat mendapat bagian tetap: **Hubungan** · **Linimasa** (per hari cerita: "Hari 1 (Jumat): …") · **Rencana & janji** (dengan waktunya: "Minggu: libur, mau ke pantai") · **Fakta yang sudah pasti** · **Benang terbuka**. Perubahan jangka panjang (mis. Rika memotong rambut) masuk Fakta; detail sesaat masuk Keadaan adegan.
- **Diperbarui otomatis setiap 10 pesan** (di belakang layar, sesudah pencatatan keadaan), tanpa tawaran. Pembaruan membaca memori lama, keadaan adegan, dan pesan sejak pembaruan terakhir. Memori tetap bisa diedit; saklar **Perbarui otomatis** di sheet Memori (bawaan nyala). Biaya dicatat sebagai "Perbarui memori".
- Ringkasan pesan lama wajib ditutup dengan **"Keadaan di akhir bagian"**: waktu, lokasi, pakaian, barang, dan rencana yang masih berlaku.

#### c. Cara instruksi dikirim
- Instruksi aplikasi **selalu dipakai**. `system_prompt` kartu ditambahkan di bawahnya sebagai **[Instruksi tambahan dari kartu]**, tidak lagi menggantikan (termasuk di grup).
- Aturan kesinambungan baru di instruksi bawaan:
  - Sebelum menulis, cocokkan dengan Keadaan adegan dan Memori; keduanya lebih berlaku daripada kartu.
  - Kartu menggambarkan kebiasaan umum tokoh; keadaan adegan saat ini yang menentukan apa yang sedang dipakai, dipegang, dan dilakukan.
  - Jangan memakai lagi barang yang sudah dibuang/habis/ditinggal, pakaian yang sudah dilepas, atau mengubah waktu dan rencana tanpa sebab di cerita.
  - Waktu cerita hanya maju kalau cerita memajukannya.
- Semua tambahan per giliran dikirim sebagai **satu pesan terpisah** sesudah giliran pengguna, berlabel "[Catatan aplikasi untuk balasan berikutnya. Bukan bagian cerita; jangan dikutip.]", urut: lore yang cocok → memori → momen tersemat → pengingat aturan (daftar bernomor) → gaya → **keadaan adegan** → giliran (grup) → target panjang. Tidak disimpan ke riwayat (cache tetap kena).
- Perubahan instruksi bawaan ini membuat cache chat lama dimulai ulang sekali.

#### d. Suhu: pilihan "Konsisten"
- Gaya cerita → **Suhu:** *Ikuti kreativitas* (bawaan, seperti sekarang) · *Konsisten* (memakai tingkat Stabil: 1,2 di DeepSeek resmi, 0,6 di penyedia lain). Konsisten lebih patuh pada detail dan aturan, variasi kalimat sedikit berkurang.

#### e. Tidak dibuat di 3.3
- Pemeriksa kesinambungan (AI kedua mengecek dan memperbaiki setiap balasan): biaya ±2× per giliran dan balasan lebih lambat. Dipertimbangkan lagi kalau 3.3 belum cukup.
