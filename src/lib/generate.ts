import { useSyncExternalStore } from 'react';
import { db, type Attachment, type Chat, type ChatKind, type LengthPreset, type Message, type Version } from '../db';
import { buildContext, estimateContext, getBrief, mergeSameRole, messageContent } from './context';
import { ensureSummaries, summarizedIndexes } from './assist';
import { ApiError, streamChat, type ApiMessage } from './api';
import { flushEditors } from './editors';
import { isNative, nativeKeepAwake } from './native';
import {
  cleanOutput,
  ownedText,
  parseMarkdown,
  placeholderBlock,
  removeSegment,
  replaceSegment,
  serializeBlocks,
  trailingManualText,
  versionBody,
} from './markdown';
import { createChapter, createStory, getStoryPages, savePageDoc, trashChapter } from './pages';
import { costUsd, isPeak } from './pricing';
import {
  afterTextBlock,
  chapterStartNote,
  continueInstr,
  DISCUSS_INSTR,
  effectiveReminder,
  maxTokensFor,
  notesBlock,
  openingInstr,
  reminderBlock,
} from './prompts';
import { findModel, PROVIDER_INFO, type ModelRef } from './providers';
import { getSettings, markChanged, temperatureFor, type Settings } from './settings';
import { countWords, firstWords, uid } from './util';

/* ---------- Store status generasi (satu permintaan dalam satu waktu) ---------- */

export interface ActiveGen {
  chatId: string;
  messageId: string;
  pageId: string | null;
  mode: 'write' | 'discuss';
  /** teks yang sudah ditulis (sudah dibersihkan) */
  live: string;
  words: number;
  thinking: boolean;
  /** 'append' = teks baru menyambung segmen yang ada (Lanjutkan dari sini) */
  kind: 'new' | 'retry' | 'append';
  /** keterangan langkah persiapan, mis. "Meringkas bab lama 1/2…" */
  status?: string;
}

let active: ActiveGen | null = null;
let controller: AbortController | null = null;
const listeners = new Set<() => void>();

function setActive(next: ActiveGen | null) {
  active = next;
  listeners.forEach((l) => l());
}

export function useActiveGen(): ActiveGen | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => active,
  );
}

/**
 * Kunci operasi: dipasang SEBELUM await pertama, supaya ketukan ganda (Coba lagi dua kali, kirim lalu
 * ganti versi) tidak menjalankan dua permintaan sekaligus.
 */
let starting = false;

export function isBusy() {
  return active !== null || starting;
}

export async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (active || starting) throw new UserError('busy', 'AI masih menulis. Tunggu sampai selesai atau tekan Stop.');
  starting = true;
  try {
    return await fn();
  } finally {
    starting = false;
  }
}

export function stopGeneration() {
  controller?.abort();
}

export class UserError extends Error {
  code: 'nokey' | 'busy' | 'empty';
  constructor(code: 'nokey' | 'busy' | 'empty', message: string) {
    super(message);
    this.code = code;
  }
}

/* ---------- Wake Lock: jaga layar tetap menyala selama AI menulis ---------- */

let wakeLock: WakeLockSentinel | null = null;
async function acquireWakeLock() {
  if (isNative()) return nativeKeepAwake(true);
  if (!('wakeLock' in navigator) || wakeLock) return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    // Browser melepas kunci sendiri saat aplikasi disembunyikan; catat supaya bisa diminta lagi.
    lock.addEventListener('release', () => {
      if (wakeLock === lock) wakeLock = null;
    });
    if (!active) {
      // Permintaan AI sudah selesai sebelum kunci didapat.
      void lock.release().catch(() => {});
      return;
    }
    wakeLock = lock;
  } catch {
    wakeLock = null;
  }
}
function releaseWakeLock() {
  if (isNative()) void nativeKeepAwake(false);
  const lock = wakeLock;
  wakeLock = null;
  void lock?.release().catch(() => {});
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && active && !wakeLock) void acquireWakeLock();
});

/* ---------- Kirim pesan ---------- */

export interface PendingAttachment {
  kind: 'image' | 'text';
  name: string;
  mime: string;
  blob: Blob | null;
  text: string | null;
  previewUrl?: string;
}

export interface SendOptions {
  chatId: string | null;
  /** page cerita untuk chat baru yang dibuka dari page */
  pageId: string | null;
  kind: ChatKind;
  text: string;
  attachments: PendingAttachment[];
  write: boolean;
  target: 'last' | 'new';
  length: LengthPreset;
  model: ModelRef;
  thinking: boolean;
}

export interface SendResult {
  chatId: string;
  /** page tempat AI menulis (kalau mode tulis) */
  writePageId: string | null;
}

async function nextSeq(chatId: string): Promise<number> {
  const last = await db.messages.where('[chatId+seq]').between([chatId, -Infinity], [chatId, Infinity]).last();
  return Math.max(Date.now(), (last?.seq ?? 0) + 1);
}

function baseMessage(p: Partial<Message> & Pick<Message, 'chatId' | 'seq' | 'role'>): Message {
  return {
    id: uid(),
    text: '',
    attachText: '',
    instr: '',
    attachmentIds: [],
    mode: 'discuss',
    targetPageId: null,
    length: null,
    createdPageId: null,
    expectTitle: false,
    status: 'done',
    error: null,
    model: '',
    thinking: false,
    versions: [],
    active: 0,
    costUsd: 0,
    createdAt: Date.now(),
    ...p,
  };
}

export function sendMessage(o: SendOptions): Promise<SendResult> {
  return exclusive(() => doSend(o));
}

async function doSend(o: SendOptions): Promise<SendResult> {
  const s = await getSettings();
  const resolved = findModel(s.providers, o.model);
  if (!resolved || !resolved.provider.apiKey.trim()) {
    throw new UserError('nokey', 'Pilih model dan isi API key penyedianya dulu di Pengaturan → Penyedia AI.');
  }
  await flushEditors();

  const now = Date.now();
  let chat: Chat | undefined = o.chatId ? await db.chats.get(o.chatId) : undefined;
  if (!chat) {
    const title = o.text.trim() ? firstWords(o.text, 6) : 'Chat baru';
    chat = {
      id: uid(),
      title,
      titleAuto: true,
      kind: o.kind === 'discuss' ? 'discuss' : o.pageId ? 'main' : 'free',
      pageId: o.pageId,
      draft: '',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await db.chats.add(chat);
  }

  // Simpan lampiran
  const attIds: string[] = [];
  const textParts: string[] = [];
  for (const a of o.attachments) {
    const att: Attachment = {
      id: uid(),
      kind: a.kind,
      name: a.name,
      mime: a.mime,
      blob: a.blob,
      text: a.text,
      createdAt: now,
    };
    await db.attachments.add(att);
    attIds.push(att.id);
    if (a.kind === 'text' && a.text) textParts.push(`[Lampiran: ${a.name}]\n${a.text}`);
  }

  const write = o.write && chat.kind !== 'discuss';
  let instr = '';
  let writePageId: string | null = null;
  let createdPageId: string | null = null;
  let length: LengthPreset | null = null;
  let expectTitle = false;

  if (write) {
    if (!chat.pageId) {
      const root = await createStory('');
      createdPageId = root.id;
      chat = { ...chat, kind: 'main', pageId: root.id };
      await db.chats.update(chat.id, { kind: 'main', pageId: root.id });
    }
    const pages = await getStoryPages(chat.pageId!);
    const root = pages[0];
    const total = pages.reduce((n, p) => n + p.words, 0);
    // Pembukaan = belum pernah ada pesan tulis di chat ini (termasuk page yang sudah berisi teks manual).
    const prior = await db.messages.where('chatId').equals(chat.id).toArray();
    const isOpening = !prior.some((m) => m.role === 'user' && m.mode === 'write' && m.status !== 'canceled');
    let newChapterTitle: string | null = null;
    if (o.target === 'new' && !isOpening) {
      const ch = await createChapter(root.id);
      createdPageId = ch.id;
      writePageId = ch.id;
      newChapterTitle = ch.title;
    } else {
      writePageId = pages[pages.length - 1].id;
    }
    if (isOpening) {
      // Judul chat otomatis mengikuti brief (bukan pertanyaan diskusi sebelumnya).
      if (chat.titleAuto && prior.length && o.text.trim()) {
        chat = { ...chat, title: firstWords(o.text, 6) };
        await db.chats.update(chat.id, { title: chat.title });
      }
      length = 'opening';
      expectTitle = root.titleAuto;
      instr = openingInstr(s, expectTitle, total > 0);
    } else {
      length = o.length === 'opening' ? 'normal' : o.length;
      instr = continueInstr(s, length, { hasDirection: !!o.text.trim(), newChapterTitle });
    }
  } else if (chat.kind !== 'discuss') {
    instr = DISCUSS_INSTR;
  }

  const userSeq = await nextSeq(chat.id);
  const user = baseMessage({
    chatId: chat.id,
    seq: userSeq,
    role: 'user',
    text: o.text.trim(),
    attachText: textParts.join('\n\n'),
    instr,
    attachmentIds: attIds,
    mode: write ? 'write' : 'discuss',
    targetPageId: writePageId,
    length,
    provider: o.model.provider,
    model: o.model.model,
    thinking: o.thinking,
  });
  const asst = baseMessage({
    chatId: chat.id,
    seq: userSeq + 1,
    role: 'assistant',
    mode: user.mode,
    targetPageId: writePageId,
    length,
    createdPageId,
    expectTitle,
    status: 'streaming',
    provider: o.model.provider,
    model: o.model.model,
    thinking: o.thinking,
  });
  await db.messages.bulkAdd([user, asst]);
  await db.chats.update(chat.id, { updatedAt: Date.now(), draft: '' });
  markChanged();

  void run({ chat, user, asst, settings: s, kind: 'new' });
  return { chatId: chat.id, writePageId };
}

/* ---------- Inti: jalankan satu permintaan streaming ---------- */

interface RunArgs {
  chat: Chat;
  user: Message;
  asst: Message;
  settings: Settings;
  kind: 'new' | 'retry' | 'append';
  /** untuk 'append': teks segmen yang sudah ada (jadi awalan prefix completion) */
  prefixText?: string;
  /** status balasan sebelum ditulis ulang / disambung, untuk dikembalikan kalau gagal */
  prevStatus?: Message['status'];
}

async function run({ chat, user, asst, settings: s, kind, prefixText, prevStatus }: RunArgs): Promise<void> {
  const resolved = findModel(s.providers, { provider: user.provider ?? 'deepseek', model: user.model });
  const usePrefix = kind === 'append' && !!resolved && PROVIDER_INFO[resolved.provider.kind].prefix;
  const thinking = kind === 'append' ? false : user.thinking;
  const peak = isPeak();
  const write = user.mode === 'write';

  controller = new AbortController();
  setActive({
    chatId: chat.id,
    messageId: asst.id,
    pageId: write ? asst.targetPageId : null,
    mode: user.mode,
    live: '',
    words: 0,
    thinking,
    kind,
  });
  void acquireWakeLock();

  let raw = '';
  let lastSave = Date.now();
  let titleSet = false;
  const appendBase = kind === 'append' && asst.versions[asst.active] ? versionBody(asst.versions[asst.active], asst.expectTitle) : '';

  const onDelta = (d: string, k: 'content' | 'reasoning') => {
    if (!active) return;
    if (k === 'reasoning') {
      if (!active.thinking) setActive({ ...active, thinking: true });
      return;
    }
    raw += d;
    const c =
      write && kind !== 'append'
        ? cleanOutput(raw, asst.expectTitle, false)
        : { title: null, body: raw, pending: false };
    if (c.title && !titleSet && chat.pageId) {
      titleSet = true;
      void db.pages.get(chat.pageId).then((p) => {
        if (p?.titleAuto) void db.pages.update(p.id, { title: c.title! });
      });
    }
    setActive({ ...active, live: c.body, words: countWords(c.body), thinking: false });
    if (Date.now() - lastSave > 2000) {
      lastSave = Date.now();
      // Disimpan berkala supaya tulisan tidak hilang kalau aplikasi tertutup (lihat recoverInterrupted).
      void db.messages.update(asst.id, { text: kind === 'append' ? joinAppend(appendBase, raw, usePrefix) : raw });
    }
  };

  let usage = { hit: 0, miss: 0, out: 0 };
  let status: Message['status'] = 'done';
  let error: string | null = null;
  try {
    if (!resolved) {
      throw new ApiError('notfound', `Model "${user.model}" tidak ada lagi di Pengaturan → Penyedia AI. Tambahkan lagi atau kirim ulang dengan model lain.`);
    }
    if (!resolved.provider.apiKey.trim()) {
      throw new ApiError('auth', `API key ${resolved.provider.name} kosong. Isi di Pengaturan → Penyedia AI.`);
    }
    const vision = resolved.model.vision;
    const summarized = await prepareSummaries(chat, resolved.model.context);
    const ctx = await buildContext(chat, vision, user.seq, { summarized });
    const omitted = { n: ctx.imagesOmitted };
    const extras = write ? await requestExtras(chat, user, asst, kind) : [];
    let current = await messageContent(user, vision, omitted);
    if (extras.length) {
      const add = extras.join('\n\n');
      current = typeof current === 'string' ? `${current}\n\n${add}` : [...current, { type: 'text', text: add }];
    }
    const messages: ApiMessage[] = mergeSameRole([...ctx.messages, { role: 'user', content: current }]);
    if (kind === 'append' && prefixText) {
      if (usePrefix) messages.push({ role: 'assistant', content: prefixText, prefix: true });
      else {
        // Penyedia tanpa prefix completion: kirim teks terpotong sebagai jawaban, lalu minta disambung.
        messages.push({ role: 'assistant', content: prefixText });
        messages.push({
          role: 'user',
          content:
            '[Instruksi aplikasi: MENULIS] Tulisanmu di atas terpotong. Sambung tepat dari kata terakhir tanpa mengulang teks yang sudah ada, tanpa komentar.',
        });
      }
    }
    const r = await streamChat(
      {
        provider: resolved.provider,
        model: resolved.model,
        messages,
        thinking,
        temperature: temperatureFor(resolved.provider, resolved.model, s.creativity),
        maxTokens: maxTokensFor(s, user.length ?? 'normal', thinking),
        prefix: usePrefix,
      },
      onDelta,
      controller.signal,
    );
    raw = r.content;
    usage = r.usage;
    if (r.finishReason === 'length') {
      status = 'stopped';
      if (!raw.trim()) error = 'Batas token habis sebelum ada teks (kemungkinan terpakai untuk berpikir). Coba lagi dengan mode berpikir mati.';
    }
  } catch (e) {
    const err = e as ApiError & { partial?: string; usage?: typeof usage };
    if (err.partial !== undefined && err.partial.length >= raw.length) raw = err.partial;
    if (err.usage) usage = err.usage;
    if (err instanceof ApiError && err.kind === 'aborted') status = 'stopped';
    else if (err instanceof ApiError && (err.kind === 'interrupted' || err.kind === 'offline') && raw.trim()) {
      status = 'interrupted';
      error = err.message;
    } else {
      status = 'error';
      error = err instanceof ApiError ? err.message : 'Terjadi kesalahan tak terduga: ' + String(e);
    }
  }

  const c = resolved ? costUsd(resolved.provider, resolved.model, usage, peak, s.usdToIdr) : 0;
  const cost = c ?? 0;
  const noUsage = usage.out === 0 && usage.miss === 0 && usage.hit === 0;
  // Harga model tidak diketahui, atau permintaan berhenti sebelum penyedia mengirim jumlah token.
  const unknown = (c === null && !noUsage) || (noUsage && status !== 'done' && (raw.trim().length > 0 || status === 'stopped'));
  if (unknown) void db.messages.update(asst.id, { costUnknown: true });
  try {
    await finish({ chat, user, asst, kind, raw, usage, cost, status, error, usePrefix, appendBase, prevStatus });
  } finally {
    controller = null;
    releaseWakeLock();
    setActive(null);
  }
}

/**
 * Tambahan sementara untuk permintaan menulis yang sedang dikirim (tidak disimpan ke riwayat,
 * jadi tidak menggeser awalan percakapan yang sudah ter-cache):
 * - pengingat aturan penulis (author's note), kecuali untuk pembukaan;
 * - catatan "awal bab" kalau AI menulis di bab yang masih kosong.
 */
async function requestExtras(chat: Chat, user: Message, asst: Message, kind: RunArgs['kind']): Promise<string[]> {
  const out: string[] = [];
  const page = asst.targetPageId ? await db.pages.get(asst.targetPageId) : undefined;
  if (page?.parentId && !page.text.trim() && !/bab baru/i.test(user.instr)) out.push(chapterStartNote(page.title || 'Tanpa judul'));
  // Catatan cerita: ditaruh di akhir (bukan di awal) supaya perubahan catatan tidak mereset cache seluruh cerita.
  const main = chat.kind === 'main' ? ((await db.chats.get(chat.id)) ?? chat) : null;
  if (main?.notes?.trim()) out.push(notesBlock(main.notes.trim()));
  if (user.length !== 'opening') {
    const fresh = (await db.chats.get(chat.id)) ?? chat;
    const brief = await getBrief(chat.id);
    const r = effectiveReminder(fresh.reminder, brief?.text);
    if (r.text) out.push(reminderBlock(r.text));
  }
  // Menulis ulang / menyambung: paragraf penulis di bawah balasan ini ikut dibaca supaya nyambung.
  if (page && kind !== 'new') {
    const after = trailingManualText(page.doc, asst.id);
    if (after.trim()) out.push(afterTextBlock(after));
  }
  return out;
}

/**
 * Ringkasan bab lama: tentukan bab mana yang dikirim sebagai ringkasan, dan buat ringkasan yang belum ada / usang.
 * Kalau pembuatan ringkasan gagal, bab itu dikirim utuh seperti biasa.
 */
async function prepareSummaries(chat: Chat, contextLimit: number | undefined): Promise<Set<number>> {
  if (!chat.pageId || chat.kind === 'free') return new Set();
  const main = chat.kind === 'main' ? chat : await db.chats.where('pageId').equals(chat.pageId).filter((c) => c.kind === 'main' && !c.deletedAt).first();
  const mode = main?.summaryMode ?? 'auto';
  const pages = await getStoryPages(chat.pageId);
  const msgs = await db.messages.where('chatId').equals(chat.id).toArray();
  const idx = summarizedIndexes(pages, mode, contextLimit, estimateContext(pages, msgs));
  if (!idx.length) return new Set();
  try {
    await ensureSummaries(chat.pageId, idx, (done, total) => {
      if (active) setActive({ ...active, status: `Meringkas bab lama ${done + 1}/${total}…` });
    }, controller?.signal);
  } catch {
    /* tetap kirim bab utuh */
  }
  if (active?.status) setActive({ ...active, status: undefined });
  return new Set(idx);
}

/** Gabungkan teks yang sudah ada dengan sambungannya. Prefix completion menyambung persis dari karakter terakhir. */
function joinAppend(base: string, cont: string, usePrefix: boolean): string {
  if (usePrefix || !base || !cont) return base + cont;
  const needsSpace = !/\s$/.test(base) && !/^[\s.,;:!?…)"”'’-]/.test(cont);
  return base + (needsSpace ? ' ' : '') + cont;
}

interface FinishArgs {
  chat: Chat;
  user: Message;
  asst: Message;
  kind: 'new' | 'retry' | 'append';
  raw: string;
  usage: { hit: number; miss: number; out: number };
  cost: number;
  status: Message['status'];
  error: string | null;
  usePrefix: boolean;
  appendBase: string;
  prevStatus?: Message['status'];
}

function keepVersions(list: Version[], active: number): Version[] {
  const versions = [...list];
  while (versions.length >= 3) versions.splice(versions.findIndex((_, i) => i !== active), 1);
  return versions;
}

async function finish(f: FinishArgs): Promise<void> {
  const { chat, user, asst, kind, usage, cost, error } = f;
  let { status } = f;
  const raw = f.raw;
  const cur = (await db.messages.get(asst.id)) ?? asst;
  const hasText = raw.trim().length > 0;
  if (status === 'error' && hasText) status = 'interrupted';
  const restored = f.prevStatus && f.prevStatus !== 'streaming' ? f.prevStatus : 'done';

  /* ----- Diskusi ----- */
  if (user.mode === 'discuss') {
    if (!hasText) {
      if (kind === 'retry' && cur.versions.length) {
        // Jawaban lama tetap dipakai.
        await db.messages.update(asst.id, {
          text: cur.versions[cur.active].raw,
          status: restored,
          error: error ?? 'Tidak ada jawaban.',
          costUsd: cur.costUsd + cost,
        });
      } else {
        await db.messages.update(asst.id, {
          text: '',
          status: status === 'stopped' ? 'stopped' : 'error',
          error: error ?? (status === 'stopped' ? 'Dihentikan sebelum ada jawaban.' : 'Tidak ada jawaban.'),
          costUsd: cur.costUsd + cost,
        });
      }
    } else {
      const version: Version = { raw, ser: '', words: countWords(raw), usage, costUsd: cost };
      const versions = kind === 'retry' ? [...keepVersions(cur.versions, cur.active), version] : [version];
      await db.messages.update(asst.id, {
        text: raw,
        versions,
        active: versions.length - 1,
        status,
        error: status === 'done' || status === 'stopped' ? null : error,
        costUsd: cur.costUsd + cost,
      });
    }
    await db.chats.update(chat.id, { updatedAt: Date.now() });
    markChanged();
    return;
  }

  const pageId = asst.targetPageId!;

  /* ----- Lanjutkan dari sini ----- */
  if (kind === 'append') {
    const versions = [...cur.versions];
    const v = versions[cur.active];
    if (hasText && v) {
      const cont = f.usePrefix ? raw : cleanOutput(raw, false, true).body;
      const body = joinAppend(f.appendBase, cont, f.usePrefix);
      const blocks = parseMarkdown(body, asst.id);
      versions[cur.active] = {
        raw: body,
        ser: serializeBlocks(blocks),
        words: countWords(body),
        clean: true,
        usage: { hit: v.usage.hit + usage.hit, miss: v.usage.miss + usage.miss, out: v.usage.out + usage.out },
        costUsd: v.costUsd + cost,
      };
      const page = await db.pages.get(pageId);
      if (page) await savePageDoc(pageId, replaceSegment(page.doc, asst.id, blocks), true);
    }
    await db.messages.update(asst.id, {
      text: '',
      versions,
      status: hasText ? status : restored,
      error: hasText ? (status === 'done' || status === 'stopped' ? null : error) : (error ?? 'Dihentikan sebelum ada teks.'),
      costUsd: cur.costUsd + cost,
    });
    await db.chats.update(chat.id, { updatedAt: Date.now() });
    markChanged();
    return;
  }

  /* ----- Gagal tanpa teks sama sekali ----- */
  if (!hasText) {
    const page = await db.pages.get(pageId);
    if (kind === 'retry' && cur.versions.length) {
      // Kembalikan versi aktif sebelumnya ke naskah (ke posisi placeholder).
      const v = cur.versions[cur.active];
      if (page) await savePageDoc(pageId, replaceSegment(page.doc, asst.id, parseMarkdown(versionBody(v, cur.expectTitle), asst.id)), true);
      await db.messages.update(asst.id, { text: '', status: restored, error: error ?? 'Dihentikan sebelum ada teks.', costUsd: cur.costUsd + cost });
    } else {
      if (page) await savePageDoc(pageId, removeSegment(page.doc, asst.id), true);
      await db.messages.update(asst.id, {
        text: '',
        status: status === 'stopped' ? 'stopped' : 'error',
        error: error ?? (status === 'stopped' ? 'Dihentikan sebelum ada teks.' : 'Tidak ada teks.'),
        costUsd: cur.costUsd + cost,
      });
    }
    return;
  }

  /* ----- Berhasil ----- */
  const c = cleanOutput(raw, cur.expectTitle, true);
  const blocks = parseMarkdown(c.body, asst.id);
  const version: Version = {
    raw,
    ser: serializeBlocks(blocks),
    words: countWords(c.body),
    usage,
    costUsd: cost,
  };
  const versions = kind === 'retry' ? [...keepVersions(cur.versions, cur.active), version] : [version];

  if (c.title && chat.pageId) {
    const root = await db.pages.get(chat.pageId);
    if (root?.titleAuto) await db.pages.update(root.id, { title: c.title });
  }
  const fresh = await db.pages.get(pageId);
  if (fresh) await savePageDoc(pageId, replaceSegment(fresh.doc, asst.id, blocks), true);

  await db.messages.update(asst.id, {
    text: '',
    versions,
    active: versions.length - 1,
    status,
    error: status === 'done' || status === 'stopped' ? null : error,
    costUsd: cur.costUsd + cost,
  });
  await db.chats.update(chat.id, { updatedAt: Date.now() });
  markChanged();
}

/* ---------- Coba lagi, edit arahan, lanjutkan, batalkan, versi ---------- */

async function pairOf(asstId: string): Promise<{ chat: Chat; user: Message; asst: Message } | null> {
  const asst = await db.messages.get(asstId);
  if (!asst) return null;
  const chat = await db.chats.get(asst.chatId);
  if (!chat) return null;
  const list = await db.messages.where('chatId').equals(chat.id).sortBy('seq');
  const i = list.findIndex((m) => m.id === asstId);
  const user = list[i - 1];
  if (!user || user.role !== 'user') return null;
  return { chat, user, asst };
}

/** Simpan editan pengguna pada segmen ke versi aktif, supaya tidak hilang saat berganti versi. */
async function captureEdits(asst: Message): Promise<Version[]> {
  const versions = [...asst.versions];
  const v = versions[asst.active];
  if (!v || !asst.targetPageId) return versions;
  const page = await db.pages.get(asst.targetPageId);
  const cur = page ? ownedText(page.doc, asst.id) : null;
  if (cur !== null && cur !== v.ser) versions[asst.active] = { ...v, raw: cur, ser: cur, words: countWords(cur), clean: true };
  return versions;
}

export interface RetryOptions {
  /** model yang sedang dipilih di chat; kosong = model pesan aslinya */
  model?: ModelRef | null;
  thinking?: boolean;
}

/** Pakai model yang sedang dipilih untuk menulis ulang / melanjutkan. */
async function applyModel(s: Settings, user: Message, asst: Message, o: RetryOptions): Promise<[Message, Message]> {
  if (!o.model) return [user, asst];
  const r = findModel(s.providers, o.model);
  if (!r || !r.provider.apiKey.trim()) {
    throw new UserError('nokey', 'Pilih model dan isi API key penyedianya dulu di Pengaturan → Penyedia AI.');
  }
  const patch = { provider: o.model.provider, model: o.model.model, thinking: o.thinking ?? user.thinking };
  await db.messages.update(user.id, patch);
  await db.messages.update(asst.id, patch);
  return [{ ...user, ...patch }, { ...asst, ...patch }];
}

export function retryMessage(asstId: string, newText?: string, opts: RetryOptions = {}): Promise<void> {
  return exclusive(async () => {
    const s = await getSettings();
    await flushEditors();
    const p = await pairOf(asstId);
    if (!p) return;
    const chat = p.chat;
    const [u0, asst] = await applyModel(s, p.user, p.asst, opts);
    let user = u0;
    if (newText !== undefined) {
      let instr = user.instr;
      if (user.mode === 'write' && user.length && user.length !== 'opening') {
        const isNewChapter = !!asst.createdPageId && asst.createdPageId !== chat.pageId;
        const ch = isNewChapter ? await db.pages.get(asst.createdPageId!) : undefined;
        instr = continueInstr(s, user.length, { hasDirection: !!newText.trim(), newChapterTitle: ch?.title ?? null });
      }
      user = { ...user, text: newText.trim(), instr };
      await db.messages.update(user.id, { text: user.text, instr });
    }
    const prevStatus = asst.status;

    if (user.mode === 'write') {
      const versions = await captureEdits(asst);
      await db.messages.update(asst.id, { versions, status: 'streaming', error: null, text: '' });
      if (asst.targetPageId) {
        // Tulisan AI diganti penanda posisi; paragraf penulis di bawahnya tetap di tempat.
        const page = await db.pages.get(asst.targetPageId);
        if (page) await savePageDoc(page.id, replaceSegment(page.doc, asst.id, [placeholderBlock(asst.id)]), true);
      }
      void run({ chat, user, asst: { ...asst, versions }, settings: s, kind: 'retry', prevStatus });
    } else {
      // Jawaban lama disimpan sebagai versi, supaya tidak hilang kalau percobaan baru gagal.
      const versions = asst.versions.length
        ? asst.versions
        : asst.text.trim()
          ? [{ raw: asst.text, ser: '', words: countWords(asst.text), usage: { hit: 0, miss: 0, out: 0 }, costUsd: 0 }]
          : [];
      await db.messages.update(asst.id, { versions, active: Math.max(0, versions.length - 1), status: 'streaming', error: null });
      void run({ chat, user, asst: { ...asst, versions, active: Math.max(0, versions.length - 1) }, settings: s, kind: 'retry', prevStatus });
    }
  });
}

/** Lanjutkan balasan yang terputus/dihentikan dari kalimat terakhir. */
export function continueMessage(asstId: string, opts: RetryOptions = {}): Promise<void> {
  return exclusive(async () => {
    const s = await getSettings();
    await flushEditors();
    const found = await pairOf(asstId);
    if (!found || found.user.mode !== 'write' || !found.asst.targetPageId) return;
    const [u2, a2] = await applyModel(s, found.user, found.asst, opts);
    const versions = await captureEdits(a2);
    const v = versions[a2.active];
    if (!v) return;
    const prevStatus = a2.status;
    await db.messages.update(asstId, { versions, status: 'streaming' });
    // captureEdits sudah mengganti raw dengan isi naskah kalau pengguna mengedit segmen ini.
    void run({ chat: found.chat, user: u2, asst: { ...a2, versions }, settings: s, kind: 'append', prefixText: v.raw, prevStatus });
  });
}

export function cancelMessage(asstId: string): Promise<void> {
  return exclusive(async () => {
    await flushEditors();
    const p = await pairOf(asstId);
    if (!p) return;
    const { asst, user } = p;
    if (asst.targetPageId) {
      const page = await db.pages.get(asst.targetPageId);
      if (page) {
        // Hanya tulisan AI yang dihapus; paragraf penulis tetap ada.
        await savePageDoc(page.id, removeSegment(page.doc, asst.id), true);
        // Bab baru yang dibuat oleh balasan ini dan sekarang kosong ikut dibuang ke Sampah.
        if (asst.createdPageId === page.id && page.parentId) {
          const after = await db.pages.get(page.id);
          if (after && !after.text.trim()) await trashChapter(page.id);
        }
      }
    }
    await db.messages.update(asst.id, { status: 'canceled' });
    await db.messages.update(user.id, { status: 'canceled' });
    markChanged();
  });
}

export function selectVersion(asstId: string, idx: number): Promise<void> {
  return exclusive(async () => {
    await flushEditors();
    const asst = await db.messages.get(asstId);
    if (!asst || idx < 0 || idx >= asst.versions.length || idx === asst.active) return;
    if (asst.mode === 'discuss') {
      await db.messages.update(asst.id, { active: idx, text: asst.versions[idx].raw });
      return;
    }
    if (!asst.targetPageId) return;
    const versions = await captureEdits(asst);
    const v = versions[idx];
    const page = await db.pages.get(asst.targetPageId);
    if (page) await savePageDoc(page.id, replaceSegment(page.doc, asst.id, parseMarkdown(versionBody(v, asst.expectTitle), asst.id)), true);
    await db.messages.update(asst.id, { versions, active: idx });
    markChanged();
  });
}

/** Saat aplikasi dibuka: pesan yang masih "streaming" berarti aplikasi tertutup di tengah jalan. */
export async function recoverInterrupted(): Promise<void> {
  const stuck = await db.messages.where('status').equals('streaming').toArray();
  for (const m of stuck) {
    if (m.role !== 'assistant') continue;
    if (m.mode === 'write' && m.targetPageId) {
      const page = await db.pages.get(m.targetPageId);
      const raw = m.text;
      const activeV = m.versions[m.active];
      if (raw.trim()) {
        let versions: Version[];
        let active: number;
        let body: string;
        if (activeV && raw.startsWith(versionBody(activeV, m.expectTitle))) {
          // Aplikasi tertutup saat "Lanjutkan dari sini": teks tersimpan = versi lama + sambungan.
          body = raw;
          versions = [...m.versions];
          active = m.active;
          const blocks = parseMarkdown(body, m.id);
          versions[active] = { ...activeV, raw: body, ser: serializeBlocks(blocks), words: countWords(body), clean: true };
        } else {
          body = cleanOutput(raw, m.expectTitle, true).body;
          const blocks = parseMarkdown(body, m.id);
          versions = [
            ...keepVersions(m.versions, m.active),
            { raw, ser: serializeBlocks(blocks), words: countWords(body), usage: { hit: 0, miss: 0, out: 0 }, costUsd: 0 },
          ];
          active = versions.length - 1;
        }
        if (page) await savePageDoc(page.id, replaceSegment(page.doc, m.id, parseMarkdown(body, m.id)), true);
        await db.messages.update(m.id, {
          status: 'interrupted',
          text: '',
          versions,
          active,
          costUnknown: true,
          error: 'Aplikasi tertutup saat AI menulis.',
        });
      } else if (activeV) {
        if (page && ownedText(page.doc, m.id) === null) {
          await savePageDoc(page.id, replaceSegment(page.doc, m.id, parseMarkdown(versionBody(activeV, m.expectTitle), m.id)), true);
        }
        await db.messages.update(m.id, { status: 'done' });
      } else {
        if (page) await savePageDoc(page.id, removeSegment(page.doc, m.id), true);
        await db.messages.update(m.id, { status: 'error', error: 'Aplikasi tertutup sebelum AI selesai menulis.' });
      }
    } else if (!m.text.trim() && m.versions.length) {
      await db.messages.update(m.id, { status: 'done', text: m.versions[m.active]?.raw ?? '' });
    } else {
      await db.messages.update(m.id, {
        status: m.text.trim() ? 'interrupted' : 'error',
        error: 'Aplikasi tertutup sebelum AI selesai menjawab.',
      });
    }
  }
}
