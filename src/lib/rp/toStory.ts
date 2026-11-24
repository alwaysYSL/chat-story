import { db, type Message } from '../../db';
import { ApiError, streamChat } from '../api';
import { beginGen, endGen, exclusive, patchGen, UserError } from '../generate';
import { appendBlocks, parseMarkdown } from '../markdown';
import { createChapter, createStory, getStoryPages, savePageDoc } from '../pages';
import { costUsd, isPeak } from '../pricing';
import { estimateTokens, findModel, type ModelRef } from '../providers';
import { getSettings, markChanged, temperatureFor } from '../settings';
import { countWords, uid } from '../util';
import { castName, historyOf, loadWorld, macro, messageText, names, transcript, type RpWorld } from './context';
import { fillMacros } from './cards';

/** Jadikan cerita: transkrip roleplay ditulis ulang per bagian menjadi prosa di modul cerita. */

export const STORY_CHUNK = 30;

export type StoryRange = { kind: 'all' } | { kind: 'from'; seq: number } | { kind: 'last'; n: number };
export type StoryTarget = { kind: 'new'; title: string } | { kind: 'chapter'; rootId: string };
export type StoryDensity = 'brief' | 'balanced' | 'full';

export const DENSITY: Record<StoryDensity, { label: string; ratio: number; hint: string }> = {
  brief: { label: 'Ringkas', ratio: 0.4, hint: '±40% dari panjang chat' },
  balanced: { label: 'Seimbang', ratio: 0.7, hint: '±70% dari panjang chat' },
  full: { label: 'Lengkap', ratio: 1, hint: 'mendekati panjang chat' },
};

export interface StoryOptions {
  range: StoryRange;
  target: StoryTarget;
  density: StoryDensity;
}

const SYSTEM_TO_STORY = `Kamu mengubah transkrip roleplay menjadi naskah cerita prosa berbahasa Indonesia.

- Narasi orang ketiga yang konsisten, paragraf yang enak dibaca.
- Pertahankan kejadian, urutan, dan dialog penting (dialog dalam tanda kutip "…"). Rapikan aksi dan narasi; boleh memadatkan bagian yang berulang.
- {{user}} adalah tokoh dalam cerita, bukan pembaca: tulis aksi dan ucapannya seperti tokoh lain.
- Jangan menambah kejadian di luar transkrip. Jangan menulis judul, komentar, atau penutup.
- Kalau diberikan akhir naskah sebelumnya, sambung mulus dari situ tanpa mengulangnya.
- Format: paragraf dipisah baris kosong; boleh *miring* dan **tebal**.
- Keluarkan HANYA naskah.`;

export function storyMessages(w: RpWorld, range: StoryRange): Message[] {
  const h = historyOf(w.messages).filter((m) => m.role === 'assistant' || m.text.trim());
  if (range.kind === 'from') return h.filter((m) => m.seq >= range.seq);
  if (range.kind === 'last') return h.slice(-Math.max(1, range.n));
  return h;
}

export function chunksOf(msgs: Message[]): Message[][] {
  const out: Message[][] = [];
  for (let i = 0; i < msgs.length; i += STORY_CHUNK) out.push(msgs.slice(i, i + STORY_CHUNK));
  return out;
}

function transcriptOf(w: RpWorld, msgs: Message[]): string {
  return transcript(w, msgs);
}

function contextBlock(w: RpWorld): string {
  const n = names(w);
  const user = n.user;
  const parts = [
    ...w.members.map((c, i) => `[${i === 0 && !w.group ? 'Tokoh utama' : 'Tokoh'}] ${c.name}: ${fillMacros(c.description.trim(), c.name, user).slice(0, w.group ? 500 : 800)}`),
    w.persona && `[Tokoh] ${user}: ${macro(w, w.persona.description.trim() || '(tanpa deskripsi)').slice(0, 500)}`,
    w.group && w.chat.groupScenario?.trim()
      ? `[Latar] ${fillMacros(w.chat.groupScenario.trim(), castName(w), user).slice(0, 500)}`
      : w.character.scenario.trim() && `[Latar] ${macro(w, w.character.scenario.trim()).slice(0, 500)}`,
  ];
  return parts.filter(Boolean).join('\n');
}

export interface StoryEstimate {
  parts: number;
  messages: number;
  words: number;
  targetWords: number;
  costUsd: number | null;
}

export async function estimateStory(chatId: string, o: Pick<StoryOptions, 'range' | 'density'>, model: ModelRef | null): Promise<StoryEstimate | null> {
  const w = await loadWorld(chatId);
  if (!w) return null;
  const msgs = storyMessages(w, o.range);
  const chunks = chunksOf(msgs);
  const words = msgs.reduce((n, m) => n + countWords(messageText(m)), 0);
  const targetWords = Math.round(words * DENSITY[o.density].ratio);
  const s = await getSettings();
  const r = model ? findModel(s.providers, model) : null;
  const inTok = estimateTokens(msgs.reduce((n, m) => n + messageText(m).length, 0) + chunks.length * (contextBlock(w).length + SYSTEM_TO_STORY.length + 1500));
  const outTok = Math.round(targetWords * 1.6);
  const cost = r ? costUsd(r.provider, r.model, { hit: 0, miss: inTok, out: outTok }, isPeak(), s.usdToIdr) : null;
  return { parts: chunks.length, messages: msgs.length, words, targetWords, costUsd: cost };
}

/** Brief cerita baru dari kartu, persona, skenario, dan memori chat. */
export function briefFrom(w: RpWorld): string {
  const n = names(w);
  const chars = w.members.map((c) => `- ${c.name}: ${fillMacros(c.description.trim(), c.name, n.user) || '(lihat naskah)'}`).join('\n');
  return [
    `Gambaran besar: cerita dari roleplay bersama ${w.group ? castName(w) : n.char}.`,
    `Karakter:\n${chars}${w.persona ? `\n- ${n.user}: ${macro(w, w.persona.description.trim()) || '(lihat naskah)'}` : ''}`,
    w.character.scenario.trim() && `Latar: ${macro(w, w.character.scenario.trim())}`,
    w.chat.memory?.trim() && `Keadaan terakhir:\n${macro(w, w.chat.memory.trim())}`,
    'Aturan lanjutan: narasi orang ketiga, bahasa Indonesia, dialog dalam tanda kutip, lanjutkan langsung dari akhir naskah.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function createMainChat(rootId: string, title: string, brief: string) {
  const now = Date.now();
  const chatId = uid();
  await db.chats.add({ id: chatId, title, titleAuto: false, kind: 'main', pageId: rootId, draft: '', createdAt: now, updatedAt: now, deletedAt: null });
  // Brief = pesan tulis pertama; belum ada balasan karena naskah sudah berisi tulisan hasil konversi.
  await db.messages.add({
    id: uid(),
    chatId,
    seq: now,
    role: 'user',
    text: brief,
    attachText: '',
    instr: '',
    attachmentIds: [],
    mode: 'write',
    targetPageId: rootId,
    length: 'opening',
    createdPageId: null,
    expectTitle: false,
    status: 'done',
    error: null,
    model: '',
    thinking: false,
    versions: [],
    active: 0,
    costUsd: 0,
    createdAt: now,
  });
}

export interface StoryResult {
  rootId: string;
  firstPageId: string;
  parts: number;
  stopped: boolean;
}

export function convertToStory(chatId: string, o: StoryOptions, model: ModelRef): Promise<StoryResult> {
  return exclusive(async () => {
    const s = await getSettings();
    const r = findModel(s.providers, model);
    if (!r || !r.provider.apiKey.trim()) throw new UserError('nokey', 'Pilih model dan isi API key penyedianya dulu di Pengaturan → Penyedia AI.');
    const w = await loadWorld(chatId);
    if (!w) throw new Error('Chat tidak ditemukan.');
    const chunks = chunksOf(storyMessages(w, o.range));
    if (!chunks.length) throw new Error('Tidak ada pesan untuk dijadikan cerita.');

    let rootId: string;
    let pageId: string;
    if (o.target.kind === 'new') {
      const root = await createStory(o.target.title.trim() || w.chat.title);
      rootId = root.id;
      pageId = root.id;
      await createMainChat(rootId, o.target.title.trim() || w.chat.title, briefFrom(w));
    } else {
      rootId = o.target.rootId;
      pageId = (await createChapter(rootId)).id;
    }
    const firstPageId = pageId;
    const signal = beginGen({ chatId, messageId: '', pageId, mode: 'convert', live: '', words: 0, thinking: false, kind: 'new', status: `Bagian 1/${chunks.length}…` });
    let tail = '';
    if (o.target.kind === 'chapter') {
      const pages = await getStoryPages(rootId);
      const prev = pages[pages.length - 2];
      tail = prev?.text.slice(-1500) ?? '';
    }
    let done = 0;
    let stopped = false;
    try {
      for (let i = 0; i < chunks.length; i++) {
        if (signal.aborted) {
          stopped = true;
          break;
        }
        const msgs = chunks[i];
        const target = Math.max(150, Math.round(msgs.reduce((n, m) => n + countWords(messageText(m)), 0) * DENSITY[o.density].ratio));
        const user = [
          contextBlock(w),
          tail && `[Akhir naskah sebelumnya, jangan diulang]\n${tail}`,
          `[Transkrip bagian ${i + 1} dari ${chunks.length}]\n${transcriptOf(w, msgs)}`,
          `Tulis bagian ini sebagai prosa, sekitar ${target} kata.`,
        ]
          .filter(Boolean)
          .join('\n\n');
        patchGen({ status: `Bagian ${i + 1}/${chunks.length}…`, live: '', pageId });
        let text = '';
        let usage = { hit: 0, miss: 0, out: 0 };
        try {
          const res = await streamChat(
            {
              provider: r.provider,
              model: r.model,
              messages: [
                { role: 'system', content: macro(w, SYSTEM_TO_STORY) },
                { role: 'user', content: user },
              ],
              thinking: false,
              temperature: temperatureFor(r.provider, r.model, 'stable'),
              maxTokens: Math.ceil(target * 2.6) + 400,
            },
            (d, k) => {
              if (k !== 'content') return;
              text += d;
              patchGen({ live: text, words: countWords(text) });
            },
            signal,
          );
          text = res.content;
          usage = res.usage;
        } catch (e) {
          const err = e as ApiError & { partial?: string; usage?: typeof usage };
          if (err.partial && err.partial.length > text.length) text = err.partial;
          if (err.usage) usage = err.usage;
          if (!(err instanceof ApiError && err.kind === 'aborted')) {
            await log(rootId, i, r, usage);
            throw e;
          }
          stopped = true;
        }
        await log(rootId, i, r, usage);
        if (text.trim()) {
          // Hasil konversi = tulisan penulis (tanpa penanda balasan AI), jadi tidak diganti saat Coba lagi.
          const page = await db.pages.get(pageId);
          if (page) await savePageDoc(pageId, appendBlocks(page.doc, parseMarkdown(text, null)), true);
          tail = text.slice(-1500);
          done++;
        }
        if (stopped) break;
        // Bab terlalu panjang: lanjut di bab baru.
        const after = await db.pages.get(pageId);
        if (i < chunks.length - 1 && after && after.words >= s.chapterThreshold) pageId = (await createChapter(rootId)).id;
      }
    } finally {
      endGen();
    }
    markChanged();
    return { rootId, firstPageId, parts: done, stopped };
  });
}

async function log(rootId: string, i: number, r: NonNullable<ReturnType<typeof findModel>>, u: { hit: number; miss: number; out: number }) {
  const s = await getSettings();
  const c = costUsd(r.provider, r.model, u, isPeak(), s.usdToIdr);
  await db.usage.add({ id: uid(), rootId, kind: 'rp-story', label: `Jadikan cerita: bagian ${i + 1}`, costUsd: c ?? 0, costUnknown: c === null || u.hit + u.miss + u.out === 0, model: r.model.id, at: Date.now() });
}
