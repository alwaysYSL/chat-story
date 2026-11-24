import { db, type Chat, type Message, type RpLength, type UsageLog, type Version } from '../../db';
import { ApiError, streamChat, type ApiMessage } from '../api';
import { beginGen, currentGen, endGen, exclusive, patchGen, stopGeneration, UserError } from '../generate';
import { costUsd, isPeak } from '../pricing';
import { findModel, PROVIDER_INFO, usableModels, type ModelRef } from '../providers';
import { getSettings, markChanged, temperatureFor, type Settings } from '../settings';
import { countWords, uid } from '../util';
import {
  buildRp,
  estimateRp,
  guardReply,
  names,
  loadWorld,
  macro,
  messageText,
  historyOf,
  rpAutoThreshold,
  summaryBlocks,
  transcript,
  type RpWorld,
} from './context';
import { resolvePersona } from './data';
import { CONTINUE_INSTR, rpMaxTokens, SYSTEM_RP_MEMORY, SYSTEM_RP_SUMMARY } from './prompts';

export const RP_MAX_VERSIONS = 10;
/** tawaran "Perbarui memori" muncul setiap sekian pesan */
export const MEMORY_EVERY = 30;

/* ---------- Model ---------- */

/** Model untuk chat roleplay: pilihan barusan → model terakhir di chat → model default → yang pertama punya API key. */
export async function rpModel(chatId: string | null, pick?: ModelRef | null): Promise<ModelRef> {
  const s = await getSettings();
  const usable = usableModels(s.providers);
  const ok = (r: ModelRef | null | undefined) => (r && usable.some((u) => u.provider.id === r.provider && u.model.id === r.model) ? r : null);
  let last: ModelRef | null = null;
  if (chatId) {
    const msgs = await db.messages.where('chatId').equals(chatId).sortBy('seq');
    const m = [...msgs].reverse().find((x) => x.role === 'user' && x.model);
    if (m) last = { provider: m.provider ?? 'deepseek', model: m.model };
  }
  const r = ok(pick) ?? ok(last) ?? ok(s.defaultModel) ?? (usable[0] ? { provider: usable[0].provider.id, model: usable[0].model.id } : null);
  if (!r) throw new UserError('nokey', 'Belum ada penyedia AI dengan API key. Atur di Pengaturan → Penyedia AI.');
  return r;
}

/* ---------- Mulai chat ---------- */

export async function startRpChat(characterId: string, opts: { personaId?: string | null; greeting?: number } = {}): Promise<string> {
  const c = await db.characters.get(characterId);
  if (!c) throw new Error('Karakter tidak ditemukan.');
  // Persona yang diikat tapi sudah dihapus → persona bawaan.
  const persona = await resolvePersona(opts.personaId ?? c.personaId);
  const now = Date.now();
  const count = (await db.chats.where('characterId').equals(characterId).toArray()).filter((x) => !x.deletedAt).length;
  const chat: Chat = {
    id: uid(),
    title: count ? `${c.name} #${count + 1}` : c.name,
    titleAuto: true,
    kind: 'roleplay',
    pageId: null,
    draft: '',
    characterId,
    personaId: persona?.id ?? null,
    memory: '',
    memoryAtCount: 0,
    rpLength: 'normal',
    summaryMode: 'auto',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  const greetings = [c.firstMes, ...c.altGreetings].filter((g) => g.trim());
  await db.transaction('rw', db.chats, db.messages, db.characters, async () => {
    await db.chats.add(chat);
    if (greetings.length) {
      const active = Math.min(Math.max(0, opts.greeting ?? 0), greetings.length - 1);
      await db.messages.add(
        baseMsg({
          chatId: chat.id,
          seq: now,
          role: 'assistant',
          greeting: true,
          text: greetings[active],
          versions: greetings.map((g) => ({ raw: g, ser: '', words: countWords(g), usage: { hit: 0, miss: 0, out: 0 }, costUsd: 0 })),
          active,
        }),
      );
    }
    await db.characters.update(characterId, { usedAt: now });
  });
  markChanged();
  return chat.id;
}

function baseMsg(p: Partial<Message> & Pick<Message, 'chatId' | 'seq' | 'role'>): Message {
  return {
    id: uid(),
    text: '',
    attachText: '',
    instr: '',
    attachmentIds: [],
    mode: 'roleplay',
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

async function nextSeq(chatId: string): Promise<number> {
  const last = await db.messages.where('[chatId+seq]').between([chatId, -Infinity], [chatId, Infinity]).last();
  return Math.max(Date.now(), (last?.seq ?? 0) + 1);
}

/* ---------- Kirim, Coba lagi, Lanjutkan ---------- */

export interface RpSendOptions {
  chatId: string;
  /** kosong = karakter melanjutkan adegan tanpa giliran pengguna */
  text: string;
  model: ModelRef;
  thinking: boolean;
}

export function sendRp(o: RpSendOptions): Promise<void> {
  return exclusive(async () => {
    const chat = await db.chats.get(o.chatId);
    if (!chat) return;
    await requireKey(o.model);
    const seq = await nextSeq(chat.id);
    const user = baseMsg({
      chatId: chat.id,
      seq,
      role: 'user',
      text: o.text.trim(),
      instr: o.text.trim() ? '' : CONTINUE_INSTR,
      provider: o.model.provider,
      model: o.model.model,
      thinking: o.thinking,
    });
    const asst = baseMsg({ chatId: chat.id, seq: seq + 1, role: 'assistant', status: 'streaming', provider: o.model.provider, model: o.model.model, thinking: o.thinking });
    await db.messages.bulkAdd([user, asst]);
    await db.chats.update(chat.id, { updatedAt: Date.now(), draft: '' });
    markChanged();
    void run({ chatId: chat.id, asst, kind: 'new', settings: await getSettings() });
  });
}

async function requireKey(m: ModelRef) {
  const s = await getSettings();
  const r = findModel(s.providers, m);
  if (!r || !r.provider.apiKey.trim()) throw new UserError('nokey', 'Pilih model dan isi API key penyedianya dulu di Pengaturan → Penyedia AI.');
}

export function retryRp(asstId: string, model: ModelRef, thinking: boolean): Promise<void> {
  return exclusive(async () => {
    const asst = await db.messages.get(asstId);
    if (!asst || asst.role !== 'assistant' || asst.greeting) return;
    await requireKey(model);
    const versions = asst.versions.length || !asst.text.trim() ? asst.versions : [plainVersion(asst.text)];
    const patch = { versions, active: Math.max(0, versions.length - 1), status: 'streaming' as const, error: null, provider: model.provider, model: model.model, thinking };
    await db.messages.update(asstId, patch);
    // Model pilihan juga dicatat di pesan pengguna sebelumnya (dipakai sebagai "model terakhir").
    const prev = (await db.messages.where('chatId').equals(asst.chatId).sortBy('seq')).filter((m) => m.seq < asst.seq && m.role === 'user').pop();
    if (prev) await db.messages.update(prev.id, { provider: model.provider, model: model.model, thinking });
    void run({ chatId: asst.chatId, asst: { ...asst, ...patch }, kind: 'retry', prevStatus: asst.status, settings: await getSettings() });
  });
}

export function continueRp(asstId: string, model: ModelRef): Promise<void> {
  return exclusive(async () => {
    const asst = await db.messages.get(asstId);
    if (!asst || !asst.text.trim()) return;
    await requireKey(model);
    await db.messages.update(asstId, { status: 'streaming' });
    void run({ chatId: asst.chatId, asst: { ...asst, provider: model.provider, model: model.model, thinking: false }, kind: 'append', prevStatus: asst.status, settings: await getSettings() });
  });
}

function plainVersion(raw: string, usage = { hit: 0, miss: 0, out: 0 }, cost = 0): Version {
  return { raw, ser: '', words: countWords(raw), usage, costUsd: cost };
}

interface RunArgs {
  chatId: string;
  asst: Message;
  kind: 'new' | 'retry' | 'append';
  prevStatus?: Message['status'];
  settings: Settings;
}

/** Tanpa await sebelum beginGen: kunci "sedang menulis" harus langsung terpasang. */
async function run({ chatId, asst, kind, prevStatus, settings: s }: RunArgs): Promise<void> {
  const resolved = findModel(s.providers, { provider: asst.provider ?? 'deepseek', model: asst.model });
  const thinking = kind === 'append' ? false : asst.thinking;
  const signal = beginGen({ chatId, messageId: asst.id, pageId: null, mode: 'roleplay', live: '', words: 0, thinking, kind });
  const base = kind === 'append' ? asst.text : '';
  let raw = '';
  let lastSave = Date.now();
  let usage = { hit: 0, miss: 0, out: 0 };
  let status: Message['status'] = 'done';
  let error: string | null = null;
  let lore: string[] = [];
  let guard = (t: string) => ({ text: t, cut: false });
  let guardCut = false;
  const peak = isPeak();
  const usePrefix = kind === 'append' && !!resolved && PROVIDER_INFO[resolved.provider.kind].prefix;
  try {
    if (!resolved) throw new ApiError('notfound', `Model "${asst.model}" tidak ada lagi di Pengaturan → Penyedia AI.`);
    const w = await loadWorld(chatId);
    if (!w) throw new ApiError('invalid', 'Chat atau karakter tidak ditemukan.');
    const length: RpLength = w.chat.rpLength ?? 'normal';
    const nm = names(w);
    guard = (t) => guardReply(t, nm.char, nm.user);
    const summaries = await prepareSummaries(w, resolved.model.context, signal);
    const built = buildRp(w, { beforeSeq: asst.seq, mode: 'reply', length, summaries });
    lore = built.lore;
    const messages: ApiMessage[] = built.messages;
    if (kind === 'append') {
      const prefix = macro(w, base);
      if (usePrefix) messages.push({ role: 'assistant', content: prefix, prefix: true });
      else {
        messages.push({ role: 'assistant', content: prefix });
        messages.push({ role: 'user', content: '[Instruksi aplikasi] Balasanmu di atas terpotong. Sambung tepat dari kata terakhir tanpa mengulang, tanpa komentar.' });
      }
    }
    const r = await streamChat(
      {
        provider: resolved.provider,
        model: resolved.model,
        messages,
        thinking,
        temperature: temperatureFor(resolved.provider, resolved.model, s.creativity),
        maxTokens: rpMaxTokens(length, thinking),
        prefix: usePrefix,
      },
      (d, k) => {
        const cur = currentGen();
        if (!cur) return;
        if (k === 'reasoning') {
          if (!cur.thinking) patchGen({ thinking: true });
          return;
        }
        raw += d;
        const g = guard(raw);
        const live = joinText(base, g.text, usePrefix);
        patchGen({ live, words: countWords(live), thinking: false });
        // AI mulai menulis giliran pengguna: hentikan permintaan (hemat token), simpan sampai sebelum baris itu.
        if (g.cut && !guardCut) {
          guardCut = true;
          stopGeneration();
        }
        if (Date.now() - lastSave > 2000) {
          lastSave = Date.now();
          void db.messages.update(asst.id, { text: live });
        }
      },
      signal,
    );
    raw = r.content;
    usage = r.usage;
    if (r.finishReason === 'length') status = 'stopped';
  } catch (e) {
    const err = e as ApiError & { partial?: string; usage?: typeof usage };
    if (err.partial !== undefined && err.partial.length >= raw.length) raw = err.partial;
    if (err.usage) usage = err.usage;
    if (err instanceof ApiError && err.kind === 'aborted') status = guardCut ? 'done' : 'stopped';
    else if (err instanceof ApiError && (err.kind === 'interrupted' || err.kind === 'offline') && raw.trim()) {
      status = 'interrupted';
      error = err.message;
    } else {
      status = 'error';
      error = err instanceof ApiError ? err.message : 'Terjadi kesalahan tak terduga: ' + String(e);
    }
  }
  const g = guard(cleanReply(raw));
  if (g.cut) guardCut = true;
  const c = resolved ? costUsd(resolved.provider, resolved.model, usage, peak, s.usdToIdr) : 0;
  const cost = c ?? 0;
  const noUsage = usage.out === 0 && usage.miss === 0 && usage.hit === 0;
  const unknown = (c === null && !noUsage) || (noUsage && status !== 'done' && raw.trim().length > 0);
  try {
    const cur = (await db.messages.get(asst.id)) ?? asst;
    const text = g.text;
    const has = text.trim().length > 0;
    if (!has && guardCut && status !== 'error') error = 'AI langsung menulis giliran Anda, jadi balasannya dibuang. Coba lagi.';
    if (status === 'error' && has) status = 'interrupted';
    const restored = prevStatus && prevStatus !== 'streaming' ? prevStatus : 'done';
    const patch: Partial<Message> = { costUsd: cur.costUsd + cost, ...(unknown ? { costUnknown: true } : {}) };
    if (kind === 'append') {
      const versions = [...cur.versions];
      const full = joinText(base, text, usePrefix);
      if (has) {
        const v = versions[cur.active] ?? plainVersion(base);
        versions[cur.active] = { ...v, raw: full, words: countWords(full), costUsd: v.costUsd + cost };
      }
      Object.assign(patch, { text: has ? full : base, versions, status: has ? status : restored, error: has ? errOrNull(status, error) : (error ?? 'Dihentikan sebelum ada teks.') });
    } else if (!has) {
      if (kind === 'retry' && cur.versions.length) {
        Object.assign(patch, { text: cur.versions[cur.active].raw, status: restored, error: error ?? 'Tidak ada balasan.' });
      } else {
        Object.assign(patch, { text: '', status: status === 'stopped' ? 'stopped' : 'error', error: error ?? (status === 'stopped' ? 'Dihentikan sebelum ada balasan.' : 'Tidak ada balasan.') });
      }
    } else {
      let versions = [...(kind === 'retry' ? cur.versions : []), plainVersion(text, usage, cost)];
      if (versions.length > RP_MAX_VERSIONS) versions = versions.slice(-RP_MAX_VERSIONS);
      Object.assign(patch, { text, versions, active: versions.length - 1, status, error: errOrNull(status, error), lore, guardCut });
    }
    await db.messages.update(asst.id, patch);
    await db.chats.update(chatId, { updatedAt: Date.now() });
    const chat = await db.chats.get(chatId);
    if (chat?.characterId) await db.characters.update(chat.characterId, { usedAt: Date.now() });
    markChanged();
  } finally {
    endGen();
  }
}

function errOrNull(status: Message['status'], error: string | null) {
  return status === 'done' || status === 'stopped' ? null : error;
}

function joinText(base: string, cont: string, usePrefix: boolean): string {
  if (!base) return cont;
  if (usePrefix || !cont) return base + cont;
  const needsSpace = !/\s$/.test(base) && !/^[\s.,;:!?…)"”'’-]/.test(cont);
  return base + (needsSpace ? ' ' : '') + cont;
}

function cleanReply(raw: string): string {
  return raw.replace(/^\s+/, '').replace(/\s+$/, '');
}

/* ---------- Versi, edit, hapus ---------- */

export async function selectRpVersion(msgId: string, idx: number): Promise<void> {
  const m = await db.messages.get(msgId);
  if (!m || idx < 0 || idx >= m.versions.length) return;
  await db.messages.update(msgId, { active: idx, text: m.versions[idx].raw });
  markChanged();
}

export async function editRpMessage(msgId: string, text: string): Promise<void> {
  const m = await db.messages.get(msgId);
  if (!m) return;
  if (m.role === 'assistant') {
    const versions = [...m.versions];
    if (versions[m.active]) versions[m.active] = { ...versions[m.active], raw: text, words: countWords(text) };
    else versions.push(plainVersion(text));
    await db.messages.update(msgId, { text, versions, active: Math.min(m.active, versions.length - 1) });
  } else {
    await db.messages.update(msgId, { text: text.trim(), instr: text.trim() ? '' : CONTINUE_INSTR });
  }
  markChanged();
}

export async function deleteRpMessages(msgId: string, fromHere: boolean): Promise<number> {
  const m = await db.messages.get(msgId);
  if (!m) return 0;
  const ids = fromHere ? (await db.messages.where('chatId').equals(m.chatId).toArray()).filter((x) => x.seq >= m.seq).map((x) => x.id) : [msgId];
  await db.messages.bulkDelete(ids);
  await db.chats.update(m.chatId, { updatedAt: Date.now() });
  markChanged();
  return ids.length;
}

/* ---------- Bantu persona (impersonate) ---------- */

/** AI menulis giliran pengguna. Hasilnya untuk kolom ketik (tidak disimpan ke riwayat). */
export function impersonate(chatId: string, hint: string, model: ModelRef, onLive: (t: string) => void): Promise<string> {
  return exclusive(async () => {
    const s = await getSettings();
    const r = findModel(s.providers, model);
    if (!r || !r.provider.apiKey.trim()) throw new UserError('nokey', 'Pilih model dan isi API key penyedianya dulu di Pengaturan → Penyedia AI.');
    const w = await loadWorld(chatId);
    if (!w) throw new Error('Chat tidak ditemukan.');
    const signal = beginGen({ chatId, messageId: '', pageId: null, mode: 'impersonate', live: '', words: 0, thinking: false, kind: 'new' });
    let text = '';
    let usage = { hit: 0, miss: 0, out: 0 };
    const nm = names(w);
    let cut = false;
    try {
      const summaries = await prepareSummaries(w, r.model.context, signal);
      const built = buildRp(w, { mode: 'impersonate', hint, length: w.chat.rpLength ?? 'normal', summaries });
      const res = await streamChat(
        { provider: r.provider, model: r.model, messages: built.messages, thinking: false, temperature: temperatureFor(r.provider, r.model, s.creativity), maxTokens: 900 },
        (d, k) => {
          if (k !== 'content') return;
          text += d;
          // Kebalikan balasan karakter: buang label nama persona, potong kalau mulai menulis giliran karakter.
          const g = guardReply(text, nm.user, nm.char);
          onLive(g.text);
          patchGen({ live: g.text, words: countWords(g.text) });
          if (g.cut && !cut) {
            cut = true;
            stopGeneration();
          }
        },
        signal,
      );
      text = res.content;
      usage = res.usage;
    } catch (e) {
      const err = e as ApiError & { usage?: typeof usage };
      if (err.usage) usage = err.usage;
      if (!(err instanceof ApiError && err.kind === 'aborted')) {
        await logUsage(chatId, 'rp-persona', 'Bantu persona', r, usage);
        throw e;
      }
    } finally {
      endGen();
    }
    await logUsage(chatId, 'rp-persona', 'Bantu persona', r, usage);
    return guardReply(text, nm.user, nm.char).text.trim();
  });
}

async function logUsage(rootId: string, kind: UsageLog['kind'], label: string, r: NonNullable<ReturnType<typeof findModel>>, u: { hit: number; miss: number; out: number }) {
  const s = await getSettings();
  const c = costUsd(r.provider, r.model, u, isPeak(), s.usdToIdr);
  await db.usage.add({ id: uid(), rootId, kind, label, costUsd: c ?? 0, costUnknown: c === null || u.hit + u.miss + u.out === 0, model: r.model.id, at: Date.now() });
}

/* ---------- Permintaan bantu satu kali (memori, ringkasan, kartu, terjemahan, perhalus) ---------- */

export interface RpAssist {
  rootId: string;
  chatId?: string | null;
  kind: UsageLog['kind'];
  label: string;
  system: string;
  user: string;
  maxTokens: number;
  onDelta?: (t: string) => void;
  signal?: AbortSignal;
  /** sudah memegang kunci (dipanggil dari dalam permintaan menulis) */
  locked?: boolean;
}

export function rpAssist(a: RpAssist): Promise<string> {
  const go = async () => {
    const s = await getSettings();
    const ref = await rpModel(a.chatId ?? null);
    const r = findModel(s.providers, ref)!;
    let text = '';
    let usage = { hit: 0, miss: 0, out: 0 };
    try {
      const res = await streamChat(
        {
          provider: r.provider,
          model: r.model,
          messages: [
            { role: 'system', content: a.system },
            { role: 'user', content: a.user },
          ],
          thinking: false,
          temperature: temperatureFor(r.provider, r.model, 'stable'),
          maxTokens: a.maxTokens,
        },
        (d, k) => {
          if (k !== 'content') return;
          text += d;
          a.onDelta?.(text);
        },
        a.signal ?? new AbortController().signal,
      );
      text = res.content;
      usage = res.usage;
    } catch (e) {
      const err = e as ApiError & { usage?: typeof usage };
      await logUsage(a.rootId, a.kind, a.label, r, err.usage ?? usage);
      throw e;
    }
    await logUsage(a.rootId, a.kind, a.label, r, usage);
    return text.trim();
  };
  return a.locked ? go() : exclusive(go);
}

/* ---------- Memori chat ---------- */

export async function proposeMemory(chatId: string, onDelta?: (t: string) => void, signal?: AbortSignal): Promise<string> {
  const w = await loadWorld(chatId);
  if (!w) throw new Error('Chat tidak ditemukan.');
  const recent = historyOf(w.messages).slice(-40);
  const user = [
    `[Karakter] ${w.character.name}`,
    `[Memori saat ini]\n${w.chat.memory?.trim() || '(masih kosong)'}`,
    `[Pesan-pesan terbaru]\n${transcript(w, recent)}`,
    'Perbarui memori chat berdasarkan pesan-pesan di atas.',
  ].join('\n\n');
  return rpAssist({ rootId: chatId, chatId, kind: 'rp-memory', label: 'Perbarui memori', system: macro(w, SYSTEM_RP_MEMORY), user, maxTokens: 1200, onDelta, signal });
}

export async function saveMemory(chatId: string, text: string): Promise<void> {
  const n = (await db.messages.where('chatId').equals(chatId).count()) || 0;
  await db.chats.update(chatId, { memory: text.trim(), memoryAtCount: n, updatedAt: Date.now() });
  markChanged();
}

export async function dismissMemoryOffer(chatId: string): Promise<void> {
  const n = await db.messages.where('chatId').equals(chatId).count();
  await db.chats.update(chatId, { memoryAtCount: n });
}

/* ---------- Ringkasan pesan lama ---------- */

/** Ringkasan yang dipakai untuk permintaan ini (dibuat dulu kalau belum ada / usang). Gagal = pesan dikirim utuh. */
async function prepareSummaries(w: RpWorld, contextLimit: number | undefined, signal: AbortSignal): Promise<Map<number, string>> {
  const mode = w.chat.summaryMode ?? 'auto';
  const out = new Map<number, string>();
  if (mode === 'off') return out;
  if (mode === 'auto' && !(estimateRp(w) > rpAutoThreshold(w.chat, contextLimit))) return out;
  const rows = await db.rpSummaries.where('chatId').equals(w.chat.id).toArray();
  const history = historyOf(w.messages);
  const blocks = summaryBlocks(history, rows);
  await dropOrphanSummaries(rows, history);
  if (!blocks.length) return out;
  const stored = new Map(rows.map((s) => [s.fromSeq, s]));
  const todo = blocks.filter((b) => stored.get(b.fromSeq)?.hash !== b.hash);
  let done = 0;
  for (const b of todo) {
    if (signal.aborted) break;
    patchGen({ status: `Meringkas pesan lama ${done + 1}/${todo.length}…` });
    try {
      const text = await summarizeBlock(w, b.msgs, true, signal);
      if (text) {
        const prev = stored.get(b.fromSeq);
        const row = { id: prev?.id ?? uid(), chatId: w.chat.id, fromSeq: b.fromSeq, toSeq: b.toSeq, hash: b.hash, text, at: Date.now() };
        await db.rpSummaries.put(row);
        stored.set(b.fromSeq, row);
      }
    } catch {
      /* blok ini dikirim utuh */
    }
    done++;
  }
  patchGen({ status: undefined });
  for (const b of blocks) {
    const s = stored.get(b.fromSeq);
    if (s && s.hash === b.hash) out.set(b.fromSeq, s.text);
  }
  return out;
}

async function summarizeBlock(w: RpWorld, msgs: Message[], locked: boolean, signal?: AbortSignal): Promise<string> {
  return rpAssist({
    rootId: w.chat.id,
    chatId: w.chat.id,
    kind: 'rp-summary',
    label: 'Ringkasan pesan lama',
    system: SYSTEM_RP_SUMMARY,
    user: `[Bagian roleplay dengan ${w.character.name}]\n${transcript(w, msgs)}\n\nRingkas bagian di atas.`,
    maxTokens: 900,
    signal,
    locked,
  });
}

/** Ringkasan yang semua pesannya sudah dihapus tidak dipakai lagi: buang. */
async function dropOrphanSummaries(rows: { id: string; fromSeq: number; toSeq: number }[], history: Message[]) {
  const dead = rows.filter((r) => !history.some((m) => m.seq >= r.fromSeq && m.seq <= r.toSeq));
  if (dead.length) await db.rpSummaries.bulkDelete(dead.map((r) => r.id));
}

/** Untuk sheet Ringkasan: buat/perbarui satu blok sekarang. */
export async function summarizeNow(chatId: string, fromSeq: number): Promise<void> {
  const w = await loadWorld(chatId);
  if (!w) return;
  const rows = await db.rpSummaries.where('chatId').equals(chatId).toArray();
  const b = summaryBlocks(historyOf(w.messages), rows).find((x) => x.fromSeq === fromSeq);
  if (!b) return;
  const text = await summarizeBlock(w, b.msgs, false);
  if (!text) return;
  const prev = (await db.rpSummaries.where('chatId').equals(chatId).toArray()).find((s) => s.fromSeq === fromSeq);
  await db.rpSummaries.put({ id: prev?.id ?? uid(), chatId, fromSeq, toSeq: b.toSeq, hash: b.hash, text, at: Date.now() });
  markChanged();
}

export { messageText };
