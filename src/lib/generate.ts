import { useSyncExternalStore } from 'react';
import { db, type Attachment, type Chat, type ChatKind, type LengthPreset, type Message, type Version } from '../db';
import { buildContext, mergeSameRole, messageContent } from './context';
import { ApiError, streamChat, type ApiMessage } from './api';
import { flushEditors } from './editors';
import { cleanOutput, parseMarkdown, removeSegment, replaceSegment, segmentText, serializeBlocks } from './markdown';
import { createChapter, createStory, getStoryPages, savePageDoc, trashChapter } from './pages';
import { costUsd, isPeak } from './pricing';
import { continueInstr, DISCUSS_INSTR, maxTokensFor, openingInstr } from './prompts';
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

export function isBusy() {
  return active !== null;
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
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    wakeLock = null;
  }
}
function releaseWakeLock() {
  void wakeLock?.release().catch(() => {});
  wakeLock = null;
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

export async function sendMessage(o: SendOptions): Promise<SendResult> {
  const s = await getSettings();
  const resolved = findModel(s.providers, o.model);
  if (!resolved || !resolved.provider.apiKey.trim()) {
    throw new UserError('nokey', 'Pilih model dan isi API key penyedianya dulu di Pengaturan → Penyedia AI.');
  }
  if (active) throw new UserError('busy', 'AI masih menulis. Tunggu sampai selesai atau tekan Stop.');
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
    const isOpening = total === 0;
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
      length = 'opening';
      expectTitle = root.titleAuto;
      instr = openingInstr(s, expectTitle);
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
}

async function run({ chat, user, asst, settings: s, kind, prefixText }: RunArgs): Promise<void> {
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
    if (kind !== 'append' && Date.now() - lastSave > 2000) {
      lastSave = Date.now();
      void db.messages.update(asst.id, { text: raw });
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
    const ctx = await buildContext(chat, vision, user.seq);
    const omitted = { n: ctx.imagesOmitted };
    const messages: ApiMessage[] = mergeSameRole([
      ...ctx.messages,
      { role: 'user', content: await messageContent(user, vision, omitted) },
    ]);
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
        temperature: temperatureFor(resolved.model, s.creativity),
        maxTokens: maxTokensFor(s, user.length ?? 'normal', thinking),
        prefix: usePrefix,
      },
      onDelta,
      controller.signal,
    );
    raw = r.content;
    usage = r.usage;
    if (r.finishReason === 'length') status = 'stopped';
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
  if (c === null && (usage.out > 0 || usage.miss > 0)) void db.messages.update(asst.id, { costUnknown: true });
  try {
    await finish({ chat, user, asst, kind, raw, usage, cost, status, error, prefixText });
  } finally {
    controller = null;
    releaseWakeLock();
    setActive(null);
  }
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
  prefixText?: string;
}

async function finish(f: FinishArgs): Promise<void> {
  const { chat, user, asst, kind, usage, cost, error } = f;
  let { status, raw } = f;
  const cur = (await db.messages.get(asst.id)) ?? asst;
  const hasText = raw.trim().length > 0;
  if (status === 'error' && hasText) status = 'interrupted';

  if (user.mode === 'discuss') {
    await db.messages.update(asst.id, {
      text: raw,
      status: hasText ? (status === 'error' ? 'interrupted' : status) : 'error',
      error: hasText && status === 'done' ? null : (error ?? (hasText ? null : 'Tidak ada jawaban.')),
      versions: [{ raw, ser: '', words: countWords(raw), usage, costUsd: cost }],
      costUsd: cur.costUsd + cost,
    });
    await db.chats.update(chat.id, { updatedAt: Date.now() });
    markChanged();
    return;
  }

  const pageId = asst.targetPageId!;
  const page = await db.pages.get(pageId);

  if (kind === 'append') {
    const prefix = f.prefixText ?? '';
    const needsSpace = prefix && raw && !/\s$/.test(prefix) && !/^[\s.,;:!?…)"”'’-]/.test(raw);
    const full = prefix + (needsSpace ? ' ' : '') + raw;
    const versions = [...cur.versions];
    const v = versions[cur.active];
    const c = cleanOutput(full, cur.expectTitle, true);
    const blocks = parseMarkdown(c.body, asst.id);
    const ser = serializeBlocks(blocks);
    if (v) {
      versions[cur.active] = {
        raw: full,
        ser,
        words: countWords(c.body),
        usage: { hit: v.usage.hit + usage.hit, miss: v.usage.miss + usage.miss, out: v.usage.out + usage.out },
        costUsd: v.costUsd + cost,
      };
    }
    if (page && hasText) await savePageDoc(pageId, replaceSegment(page.doc, asst.id, blocks), true);
    await db.messages.update(asst.id, {
      versions,
      status: status === 'error' ? cur.status : status,
      error: status === 'done' || status === 'stopped' ? null : error,
      costUsd: cur.costUsd + cost,
    });
    await db.chats.update(chat.id, { updatedAt: Date.now() });
    return;
  }

  if (!hasText) {
    // Gagal tanpa teks sama sekali.
    if (kind === 'retry' && cur.versions.length) {
      // Kembalikan versi aktif sebelumnya ke naskah.
      const v = cur.versions[cur.active];
      const c = cleanOutput(v.raw, cur.expectTitle, true);
      if (page) await savePageDoc(pageId, replaceSegment(page.doc, asst.id, parseMarkdown(c.body, asst.id)), true);
      await db.messages.update(asst.id, { status: 'done', error, costUsd: cur.costUsd + cost });
    } else {
      await db.messages.update(asst.id, {
        status: status === 'stopped' ? 'stopped' : 'error',
        error: status === 'stopped' ? 'Dihentikan sebelum ada teks.' : error,
        costUsd: cur.costUsd + cost,
      });
    }
    return;
  }

  const c = cleanOutput(raw, cur.expectTitle, true);
  const blocks = parseMarkdown(c.body, asst.id);
  const version: Version = {
    raw,
    ser: serializeBlocks(blocks),
    words: countWords(c.body),
    usage,
    costUsd: cost,
  };
  let versions = [...cur.versions];
  let activeIdx: number;
  if (kind === 'retry') {
    if (versions.length >= 3) {
      // Buang versi tertua yang tidak aktif.
      const drop = versions.findIndex((_, i) => i !== cur.active);
      versions.splice(drop, 1);
    }
    versions.push(version);
    activeIdx = versions.length - 1;
  } else {
    versions = [version];
    activeIdx = 0;
  }

  if (c.title && chat.pageId) {
    const root = await db.pages.get(chat.pageId);
    if (root?.titleAuto) await db.pages.update(root.id, { title: c.title });
  }
  const fresh = await db.pages.get(pageId);
  if (fresh) await savePageDoc(pageId, replaceSegment(fresh.doc, asst.id, blocks), true);

  await db.messages.update(asst.id, {
    text: '',
    versions,
    active: activeIdx,
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
  const cur = page ? segmentText(page.doc, asst.id) : null;
  if (cur !== null && cur !== v.ser) versions[asst.active] = { ...v, raw: cur, ser: cur, words: countWords(cur) };
  return versions;
}

export async function retryMessage(asstId: string, newText?: string): Promise<void> {
  const s = await getSettings();
  if (active) throw new UserError('busy', 'AI masih menulis. Tunggu sampai selesai atau tekan Stop.');
  await flushEditors();
  const p = await pairOf(asstId);
  if (!p) return;
  let { user } = p;
  const { chat, asst } = p;
  if (newText !== undefined) {
    const s2 = await getSettings();
    let instr = user.instr;
    if (user.mode === 'write' && user.length && user.length !== 'opening') {
      const isNewChapter = !!asst.createdPageId && asst.createdPageId !== chat.pageId;
      const ch = isNewChapter ? await db.pages.get(asst.createdPageId!) : undefined;
      instr = continueInstr(s2, user.length, { hasDirection: !!newText.trim(), newChapterTitle: ch?.title ?? null });
    }
    user = { ...user, text: newText.trim(), instr };
    await db.messages.update(user.id, { text: user.text, instr });
  }

  if (user.mode === 'write') {
    const versions = await captureEdits(asst);
    await db.messages.update(asst.id, { versions, status: 'streaming', error: null });
    if (asst.targetPageId) {
      const page = await db.pages.get(asst.targetPageId);
      if (page) await savePageDoc(page.id, removeSegment(page.doc, asst.id), true);
    }
    void run({ chat, user, asst: { ...asst, versions }, settings: s, kind: 'retry' });
  } else {
    await db.messages.update(asst.id, { status: 'streaming', error: null, text: '' });
    void run({ chat, user, asst, settings: s, kind: 'new' });
  }
}

/** Lanjutkan balasan yang terputus/dihentikan dari kalimat terakhir (Chat Prefix Completion). */
export async function continueMessage(asstId: string): Promise<void> {
  const s = await getSettings();
  if (active) throw new UserError('busy', 'AI masih menulis. Tunggu sampai selesai atau tekan Stop.');
  await flushEditors();
  const p = await pairOf(asstId);
  if (!p || p.user.mode !== 'write' || !p.asst.targetPageId) return;
  const versions = await captureEdits(p.asst);
  const v = versions[p.asst.active];
  if (!v) return;
  await db.messages.update(asstId, { versions, status: 'streaming' });
  // captureEdits sudah mengganti raw dengan isi naskah kalau pengguna mengedit segmen ini.
  const prefixText = v.raw;
  void run({ ...p, asst: { ...p.asst, versions }, settings: s, kind: 'append', prefixText });
}

export async function cancelMessage(asstId: string): Promise<void> {
  if (active?.messageId === asstId) return;
  const p = await pairOf(asstId);
  if (!p) return;
  const { asst, user } = p;
  if (asst.targetPageId) {
    const page = await db.pages.get(asst.targetPageId);
    if (page) {
      const doc = removeSegment(page.doc, asst.id);
      await savePageDoc(page.id, doc, true);
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
}

export async function selectVersion(asstId: string, idx: number): Promise<void> {
  if (active) throw new UserError('busy', 'AI masih menulis. Tunggu sampai selesai.');
  await flushEditors();
  const asst = await db.messages.get(asstId);
  if (!asst || idx < 0 || idx >= asst.versions.length || idx === asst.active || !asst.targetPageId) return;
  const versions = await captureEdits(asst);
  const v = versions[idx];
  const c = cleanOutput(v.raw, asst.expectTitle, true);
  const page = await db.pages.get(asst.targetPageId);
  if (page) await savePageDoc(page.id, replaceSegment(page.doc, asst.id, parseMarkdown(c.body, asst.id)), true);
  await db.messages.update(asst.id, { versions, active: idx });
}

/** Saat aplikasi dibuka: pesan yang masih "streaming" berarti aplikasi tertutup di tengah jalan. */
export async function recoverInterrupted(): Promise<void> {
  const stuck = await db.messages.where('status').equals('streaming').toArray();
  for (const m of stuck) {
    if (m.role !== 'assistant') continue;
    if (m.mode === 'write' && m.targetPageId) {
      const raw = m.text;
      if (raw.trim()) {
        const c = cleanOutput(raw, m.expectTitle, true);
        const blocks = parseMarkdown(c.body, m.id);
        const versions = [...m.versions];
        const v: Version = { raw, ser: serializeBlocks(blocks), words: countWords(c.body), usage: { hit: 0, miss: 0, out: 0 }, costUsd: 0 };
        versions.push(v);
        while (versions.length > 3) versions.splice(versions.findIndex((_, i) => i !== m.active), 1);
        const page = await db.pages.get(m.targetPageId);
        if (page) await savePageDoc(page.id, replaceSegment(page.doc, m.id, blocks), true);
        await db.messages.update(m.id, { status: 'interrupted', text: '', versions, active: versions.length - 1, error: 'Aplikasi tertutup saat AI menulis.' });
      } else if (m.versions.length) {
        const v = m.versions[m.active];
        const c = cleanOutput(v.raw, m.expectTitle, true);
        const page = await db.pages.get(m.targetPageId);
        if (page && segmentText(page.doc, m.id) === null) {
          await savePageDoc(page.id, replaceSegment(page.doc, m.id, parseMarkdown(c.body, m.id)), true);
        }
        await db.messages.update(m.id, { status: 'done' });
      } else {
        await db.messages.update(m.id, { status: 'error', error: 'Aplikasi tertutup sebelum AI selesai menulis.' });
      }
    } else {
      await db.messages.update(m.id, {
        status: m.text.trim() ? 'interrupted' : 'error',
        error: 'Aplikasi tertutup sebelum AI selesai menjawab.',
      });
    }
  }
}
