import { db, type Page, type UsageLog } from '../db';
import { ApiError, streamChat } from './api';
import { findBrief } from './context';
import { exclusive } from './generate';
import { docBlocks, serializeBlocks } from './markdown';
import { displayTitle, getMainChat, getStoryPages } from './pages';
import { costUsd, isPeak } from './pricing';
import { findModel, usableModels, type ModelConfig, type ProviderConfig } from './providers';
import { getSettings, markChanged, temperatureFor } from './settings';
import { countWords, uid } from './util';

/**
 * Permintaan AI di luar chat: memperbarui catatan cerita, meringkas bab, menulis ulang teks terpilih.
 * Memakai model terakhir di chat utama cerita (kalau masih bisa dipakai), lalu model default.
 */

export const SYSTEM_NOTES = `Kamu membantu penulis cerita fiksi menjaga "catatan cerita" (story bible): daftar fakta yang harus konsisten di seluruh cerita.

- Tulis dalam bahasa cerita (biasanya bahasa Indonesia), ringkas, berupa poin.
- Kelompokkan dengan judul pendek: Karakter, Hubungan, Latar & fakta, Status terkini, Benang cerita terbuka.
- Pertahankan isi catatan lama yang masih berlaku, tambahkan fakta baru dari bab, ubah yang sudah berubah, hapus yang tidak berlaku lagi.
- Hanya fakta dari cerita. Jangan menebak kelanjutan, jangan memberi saran.
- Maksimal sekitar 400 kata.
- Keluarkan HANYA isi catatan baru, tanpa kalimat pembuka atau penutup.`;

export const SYSTEM_SUMMARY = `Kamu meringkas satu bab cerita fiksi supaya AI penulis tetap ingat isinya tanpa membaca bab utuh.

- Tulis dalam bahasa cerita (biasanya bahasa Indonesia), 150–300 kata, kalimat lampau yang padat.
- Urutkan kejadian penting, sebut nama karakter, tempat, keputusan, rahasia yang terungkap, dan keadaan di akhir bab.
- Jangan menilai, jangan menambah hal yang tidak ada di teks.
- Keluarkan HANYA ringkasan, tanpa kalimat pembuka atau judul.`;

export const SYSTEM_REWRITE = `Kamu menulis ulang satu bagian cerita fiksi sesuai permintaan penulis.

- Pertahankan bahasa, sudut pandang, gaya, nama, dan fakta cerita.
- Tulisan harus nyambung dengan teks sebelum dan sesudahnya.
- Format: paragraf biasa dipisah baris kosong; boleh *miring* dan **tebal**.
- Keluarkan HANYA teks pengganti untuk bagian itu. Jangan mengulang teks sebelum/sesudah, jangan memberi komentar.`;

export interface AssistModel {
  provider: ProviderConfig;
  model: ModelConfig;
}

export async function pickModel(rootId: string | null): Promise<AssistModel> {
  const s = await getSettings();
  const usable = usableModels(s.providers);
  const ok = (r: { provider: string; model: string } | null | undefined) =>
    r && usable.some((u) => u.provider.id === r.provider && u.model.id === r.model) ? findModel(s.providers, r) : null;
  let lastUsed: { provider: string; model: string } | null = null;
  if (rootId) {
    const chat = await getMainChat(rootId);
    if (chat) {
      const msgs = await db.messages.where('chatId').equals(chat.id).sortBy('seq');
      const m = [...msgs].reverse().find((x) => x.role === 'user' && x.model && x.status !== 'canceled');
      if (m) lastUsed = { provider: m.provider ?? 'deepseek', model: m.model };
    }
  }
  const r = ok(lastUsed) ?? ok(s.defaultModel) ?? (usable[0] ? { provider: usable[0].provider, model: usable[0].model } : null);
  if (!r) throw new ApiError('auth', 'Belum ada penyedia AI dengan API key. Atur di Pengaturan → Penyedia AI.');
  return r;
}

export interface AssistRequest {
  rootId: string;
  kind: UsageLog['kind'];
  label: string;
  system: string;
  user: string;
  maxTokens: number;
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}

/** Jalankan satu permintaan bantu (memakai kunci yang sama dengan chat: satu permintaan dalam satu waktu). */
export function runAssist(r: AssistRequest): Promise<string> {
  return exclusive(async () => {
    const s = await getSettings();
    const { provider, model } = await pickModel(r.rootId);
    const peak = isPeak();
    let text = '';
    let usage = { hit: 0, miss: 0, out: 0 };
    const log = async (u: typeof usage) => {
      const c = costUsd(provider, model, u, peak, s.usdToIdr);
      await db.usage.add({
        id: uid(),
        rootId: r.rootId,
        kind: r.kind,
        label: r.label,
        costUsd: c ?? 0,
        costUnknown: c === null || u.hit + u.miss + u.out === 0,
        model: model.id,
        at: Date.now(),
      });
    };
    try {
      const res = await streamChat(
        {
          provider,
          model,
          messages: [
            { role: 'system', content: r.system },
            { role: 'user', content: r.user },
          ],
          thinking: false,
          temperature: temperatureFor(provider, model, 'stable'),
          maxTokens: r.maxTokens,
        },
        (d, k) => {
          if (k !== 'content') return;
          text += d;
          r.onDelta?.(text);
        },
        r.signal ?? new AbortController().signal,
      );
      text = res.content;
      usage = res.usage;
    } catch (e) {
      const err = e as ApiError & { usage?: typeof usage };
      await log(err.usage ?? usage);
      throw e;
    }
    await log(usage);
    return text.replace(/^\s+|\s+$/g, '');
  });
}

/* ---------- Catatan cerita ---------- */

export async function proposeNotes(rootId: string, pageId: string, onDelta?: (t: string) => void, signal?: AbortSignal): Promise<string> {
  const chat = await getMainChat(rootId);
  const page = await db.pages.get(pageId);
  if (!chat || !page) throw new ApiError('invalid', 'Cerita atau bab tidak ditemukan.');
  const brief = findBrief(await db.messages.where('chatId').equals(chat.id).sortBy('seq'));
  const user = [
    `[Brief cerita]\n${brief?.text ?? '(tidak ada)'}`,
    `[Catatan cerita saat ini]\n${chat.notes?.trim() || '(masih kosong)'}`,
    `[Isi bab "${displayTitle(page)}"]\n${serializeBlocks(docBlocks(page.doc))}`,
    'Perbarui catatan cerita berdasarkan bab di atas.',
  ].join('\n\n');
  return runAssist({ rootId, kind: 'notes', label: `Catatan dari ${displayTitle(page)}`, system: SYSTEM_NOTES, user, maxTokens: 1600, onDelta, signal });
}

/* ---------- Ringkasan bab ---------- */

export function summaryStale(p: Page): boolean {
  return !!p.summary && p.updatedAt > p.summary.at + 1000;
}

export async function summarizePage(rootId: string, pageId: string, onDelta?: (t: string) => void, signal?: AbortSignal): Promise<string> {
  const page = await db.pages.get(pageId);
  if (!page) throw new ApiError('invalid', 'Bab tidak ditemukan.');
  const user = `[Bab "${displayTitle(page)}"]\n${serializeBlocks(docBlocks(page.doc))}\n\nRingkas bab di atas.`;
  const text = await runAssist({ rootId, kind: 'summary', label: `Ringkasan ${displayTitle(page)}`, system: SYSTEM_SUMMARY, user, maxTokens: 900, onDelta, signal });
  if (text) await saveSummary(pageId, text);
  return text;
}

export async function saveSummary(pageId: string, text: string): Promise<void> {
  const page = await db.pages.get(pageId);
  if (!page) return;
  // `at` sedikit di depan updatedAt supaya tidak langsung dianggap usang.
  await db.pages.update(pageId, { summary: { text: text.trim(), at: Math.max(Date.now(), page.updatedAt) } });
  markChanged();
}

export const KEEP_FULL = 2;
export const AUTO_SUMMARY_RATIO = 0.6;

/** Bab yang dikirim sebagai ringkasan (indeks di daftar page cerita), atau kosong kalau ringkasan tidak dipakai. */
export function summarizedIndexes(pages: Page[], mode: 'auto' | 'always' | 'off', contextLimit: number | undefined, contextTokens: number): number[] {
  if (mode === 'off' || pages.length <= KEEP_FULL) return [];
  if (mode === 'auto' && !(contextLimit && contextTokens > contextLimit * AUTO_SUMMARY_RATIO)) return [];
  return pages.slice(0, pages.length - KEEP_FULL).map((_, i) => i);
}

/** Pastikan bab lama punya ringkasan terbaru sebelum menulis. Mengembalikan jumlah ringkasan yang dibuat. */
export async function ensureSummaries(
  rootId: string,
  indexes: number[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<number> {
  const pages = await getStoryPages(rootId);
  const todo = indexes.map((i) => pages[i]).filter((p) => p && p.text.trim() && (!p.summary || summaryStale(p)));
  let n = 0;
  for (const p of todo) {
    onProgress?.(n, todo.length);
    if (signal?.aborted) break;
    await summarizePageInner(rootId, p, signal);
    n++;
  }
  return n;
}

/** Versi tanpa kunci, dipakai dari dalam permintaan menulis yang sudah memegang kunci. */
async function summarizePageInner(rootId: string, page: Page, signal?: AbortSignal): Promise<void> {
  const s = await getSettings();
  const { provider, model } = await pickModel(rootId);
  const user = `[Bab "${displayTitle(page)}"]\n${serializeBlocks(docBlocks(page.doc))}\n\nRingkas bab di atas.`;
  const res = await streamChat(
    {
      provider,
      model,
      messages: [
        { role: 'system', content: SYSTEM_SUMMARY },
        { role: 'user', content: user },
      ],
      thinking: false,
      temperature: temperatureFor(provider, model, 'stable'),
      maxTokens: 900,
    },
    () => {},
    signal ?? new AbortController().signal,
  );
  const c = costUsd(provider, model, res.usage, isPeak(), s.usdToIdr);
  await db.usage.add({
    id: uid(),
    rootId,
    kind: 'summary',
    label: `Ringkasan ${displayTitle(page)}`,
    costUsd: c ?? 0,
    costUnknown: c === null,
    model: model.id,
    at: Date.now(),
  });
  if (res.content.trim()) await saveSummary(page.id, res.content);
}

/* ---------- Tulis ulang teks terpilih ---------- */

export const REWRITE_PRESETS = {
  polish: 'Perhalus bagian ini: perbaiki alur kalimat dan pilihan kata, makna tetap sama, panjang kurang lebih sama.',
  longer: 'Perpanjang bagian ini dengan detail, suasana, dan dialog yang sesuai, kira-kira dua kali lebih panjang.',
  shorter: 'Persingkat bagian ini menjadi kira-kira setengahnya tanpa menghilangkan kejadian penting.',
} as const;

const BEFORE_CHARS = 6000;
const AFTER_CHARS = 1500;

export async function rewriteSelection(o: {
  rootId: string;
  before: string;
  selected: string;
  after: string;
  instruction: string;
  onDelta?: (t: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const chat = await getMainChat(o.rootId);
  let briefText = '';
  if (chat) briefText = findBrief(await db.messages.where('chatId').equals(chat.id).sortBy('seq'))?.text ?? '';
  const words = countWords(o.selected);
  const user = [
    briefText && `[Brief cerita]\n${briefText.slice(0, 4000)}`,
    chat?.notes?.trim() && `[Catatan cerita]\n${chat.notes.trim()}`,
    o.before.trim() && `[Teks SEBELUM bagian]\n${o.before.slice(-BEFORE_CHARS)}`,
    `[Bagian yang ditulis ulang, ${words} kata]\n${o.selected}`,
    o.after.trim() && `[Teks SESUDAH bagian]\n${o.after.slice(0, AFTER_CHARS)}`,
    `[Permintaan penulis]\n${o.instruction}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  return runAssist({
    rootId: o.rootId,
    kind: 'rewrite',
    label: `Tulis ulang ${words} kata`,
    system: SYSTEM_REWRITE,
    user,
    maxTokens: Math.max(400, Math.ceil(words * 2.5 * 2.5) + 200),
    onDelta: o.onDelta,
    signal: o.signal,
  });
}

