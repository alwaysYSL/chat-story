import type { Settings } from './settings';
import type { LengthPreset } from '../db';

/** Instruksi dasar untuk chat utama dan chat bebas. Jangan diubah sembarangan: perubahan mereset cache semua cerita. */
export const SYSTEM_MAIN = `Kamu adalah rekan penulis cerita fiksi untuk seorang penulis hobi. Penulis memberi brief (gambaran besar cerita, karakter, gambaran pembukaan, dan aturan penulisan), lalu arahan-arahan singkat untuk lanjutan cerita.

Setiap pesan penulis diakhiri penanda dari aplikasi:
- [Instruksi aplikasi: MENULIS] berarti tulis teks cerita. Teksmu akan langsung masuk ke naskah.
- [Instruksi aplikasi: DISKUSI] berarti jawab sebagai rekan diskusi di chat. Jangan menulis lanjutan cerita kecuali diminta.

Aturan saat MENULIS:
- Ikuti brief dan semua aturan penulisan dari penulis.
- Tulis dalam bahasa yang sama dengan brief (biasanya bahasa Indonesia).
- Langsung mulai dengan teks cerita. Jangan menulis kalimat pembuka, komentar, catatan, ringkasan, atau pertanyaan, baik di awal maupun di akhir.
- Lanjutkan tepat dari akhir naskah sebelumnya. Jangan mengulang atau merangkum bagian yang sudah ditulis.
- Kembangkan arahan penulis menjadi adegan utuh dengan narasi, dialog, dan detail. Jangan menyalin arahan mentah-mentah.
- Usahakan panjang tulisan sesuai target kata yang diminta.
- Format: paragraf biasa yang dipisah baris kosong. Boleh memakai *miring* dan **tebal**. Pakai *** sebagai pemisah adegan bila perlu. Jangan memakai heading, daftar, atau tabel kecuali diminta.
- Naskah bisa saja sudah diedit penulis. Anggap teks naskah terbaru sebagai acuan cerita.`;

export const SYSTEM_DISCUSS = `Kamu adalah rekan diskusi untuk seorang penulis cerita fiksi hobi. Kamu sudah membaca brief dan naskah cerita yang diberikan di awal percakapan.

- Jawab dalam bahasa penulis (biasanya bahasa Indonesia), jelas dan tidak bertele-tele.
- Bantu brainstorming, cek konsistensi, ide alur, nama, atau pertanyaan lain tentang cerita.
- Kamu tidak menulis ke naskah. Kalau penulis meminta contoh tulisan, berikan sebagai contoh di chat.`;

export function targetRange(s: Settings, preset: LengthPreset): string {
  switch (preset) {
    case 'opening':
      return `${s.openingMin}–${s.openingMax} kata`;
    case 'short':
      return `sekitar ${s.shortWords} kata`;
    case 'long':
      return `sekitar ${s.longWords} kata`;
    default:
      return `${s.contMin}–${s.contMax} kata`;
  }
}

export function targetMaxWords(s: Settings, preset: LengthPreset): number {
  switch (preset) {
    case 'opening':
      return s.openingMax;
    case 'short':
      return s.shortWords;
    case 'long':
      return s.longWords;
    default:
      return s.contMax;
  }
}

/** Batas pengaman token output: kira-kira 2,5 × kata maksimal (bahasa Indonesia ±1,5–2 token per kata). */
export function maxTokensFor(s: Settings, preset: LengthPreset, thinking: boolean): number {
  const base = Math.ceil(targetMaxWords(s, preset) * 2.5) + 200;
  return thinking ? base + 16000 : base;
}

export function openingInstr(s: Settings, wantTitle: boolean): string {
  let t = `[Instruksi aplikasi: MENULIS] Tulis PEMBUKAAN cerita berdasarkan brief di atas. Gambaran pembukaan dari penulis hanya konteks: sempurnakan dan kembangkan, jangan disalin. Target panjang: ${targetRange(s, 'opening')}.`;
  if (wantTitle) t += ' Baris pertama wajib berformat "Judul: <judul cerita>", lalu satu baris kosong, lalu cerita.';
  return t;
}

export function continueInstr(
  s: Settings,
  preset: LengthPreset,
  opts: { hasDirection: boolean; newChapterTitle: string | null },
): string {
  let t = opts.hasDirection
    ? `[Instruksi aplikasi: MENULIS] Lanjutkan cerita dari akhir naskah berdasarkan arahan di atas. Target panjang: ${targetRange(s, preset)}.`
    : `[Instruksi aplikasi: MENULIS] Lanjutkan cerita secara alami dari akhir naskah. Target panjang: ${targetRange(s, preset)}.`;
  if (opts.newChapterTitle) t += ` Ini awal bab baru berjudul "${opts.newChapterTitle}".`;
  return t;
}

export const DISCUSS_INSTR = '[Instruksi aplikasi: DISKUSI]';

export const LENGTH_LABEL: Record<LengthPreset, string> = {
  short: 'Pendek',
  normal: 'Normal',
  long: 'Panjang',
  opening: 'Pembukaan',
};
