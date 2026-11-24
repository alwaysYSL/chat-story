import { db, type Character, type Chat, type LoreEntry, type Lorebook, type Message, type Persona, type RpLength } from '../../db';
import type { ApiMessage } from '../api';
import { mergeSameRole } from '../context';
import { estimateTokens } from '../providers';
import { depthPrompt, fillMacros } from './cards';
import { resolvePersona } from './data';
import { CONTINUE_INSTR, impersonateInstr, lengthInstr, loreBlock, memoryBlock, reminderBlock, styleBlock, suggestInstr, summaryBlock, systemRp } from './prompts';

/** Semua yang dibutuhkan untuk menyusun permintaan roleplay. */
export interface RpWorld {
  chat: Chat;
  character: Character;
  persona: Persona | null;
  books: Lorebook[];
  messages: Message[];
}

export async function loadWorld(chatId: string): Promise<RpWorld | null> {
  const chat = await db.chats.get(chatId);
  if (!chat || chat.kind !== 'roleplay' || !chat.characterId) return null;
  const character = await db.characters.get(chat.characterId);
  if (!character) return null;
  const persona = await resolvePersona(chat.personaId);
  const own = (await db.lorebooks.where('characterId').equals(character.id).toArray()).filter((b) => !b.deletedAt);
  const worlds = (await db.lorebooks.bulkGet(character.worldIds)).filter((b): b is Lorebook => !!b && !b.deletedAt);
  const messages = await db.messages.where('chatId').equals(chatId).sortBy('seq');
  return { chat, character, persona, books: [...own, ...worlds], messages };
}

export function names(w: Pick<RpWorld, 'character' | 'persona'>): { char: string; user: string } {
  return { char: w.character.name.trim() || 'Karakter', user: w.persona?.name.trim() || 'Pengguna' };
}

export function macro(w: Pick<RpWorld, 'character' | 'persona'>, text: string): string {
  const n = names(w);
  return fillMacros(text, n.char, n.user);
}

/** Isi pesan untuk riwayat: balasan memakai versi aktif; pesan "Lanjutkan" memakai instruksinya. */
export function messageText(m: Message): string {
  if (m.role === 'assistant') return m.text;
  return m.text.trim() || m.instr || CONTINUE_INSTR;
}

/** Riwayat yang dikirim (pesan gagal tanpa teks dilewati). */
export function historyOf(messages: Message[], beforeSeq = Infinity): Message[] {
  return messages.filter((m) => m.seq < beforeSeq && m.status !== 'canceled' && (m.role === 'user' || m.text.trim()));
}

/* ---------- Bagian tetap (system) ---------- */

export interface PromptPart {
  key: string;
  label: string;
  text: string;
}

/** Bagian tetap di system, berlabel (dipakai juga oleh "Lihat yang dikirim ke AI"). */
export function systemParts(w: RpWorld): PromptPart[] {
  const c = w.character;
  const parts: PromptPart[] = [{ key: 'instr', label: c.systemPrompt.trim() ? 'Instruksi sistem kartu' : 'Instruksi roleplay', text: c.systemPrompt.trim() || systemRp(w.chat.rpStyle) }];
  const card = [
    `[Karakter: {{char}}]`,
    c.description.trim() && `Deskripsi:\n${c.description.trim()}`,
    c.personality.trim() && `Kepribadian: ${c.personality.trim()}`,
  ]
    .filter(Boolean)
    .join('\n');
  parts.push({ key: 'card', label: 'Kartu karakter', text: card });
  if (c.scenario.trim()) parts.push({ key: 'scenario', label: 'Skenario', text: `[Skenario]\n${c.scenario.trim()}` });
  if (w.persona && (w.persona.description.trim() || w.persona.name.trim())) {
    parts.push({ key: 'persona', label: 'Persona', text: `[Persona {{user}}, tokoh yang dimainkan pengguna]\n${w.persona.description.trim() || '(tanpa deskripsi)'}` });
  }
  const ex = c.mesExample.trim().replace(/<START>/gi, '---').trim();
  if (ex) parts.push({ key: 'example', label: 'Contoh dialog', text: `[Contoh gaya bicara. Hanya contoh, bukan bagian cerita.]\n${ex}` });
  const constant = w.books.flatMap((b) => b.entries.filter((e) => e.enabled && e.constant && e.content.trim()));
  if (constant.length) parts.push({ key: 'lore-const', label: 'Lore selalu dikirim', text: loreBlock(constant.sort((a, b) => b.priority - a.priority)) });
  return parts.map((x) => ({ ...x, text: macro(w, x.text) }));
}

export function systemText(w: RpWorld): string {
  return systemParts(w)
    .map((p) => p.text)
    .join('\n\n');
}

/* ---------- Lorebook ---------- */

function keyRegex(key: string, caseSensitive = false): RegExp | null {
  const k = key.trim();
  if (!k) return null;
  const m = k.match(/^\/(.+)\/([a-z]*)$/i);
  if (m) {
    try {
      return new RegExp(m[1], caseSensitive || m[2].includes('i') ? m[2] : m[2] + 'i');
    } catch {
      return null;
    }
  }
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])`, caseSensitive ? 'u' : 'iu');
}

/** Kata kunci utama cocok, lalu syarat kata kunci kedua (kalau ada). */
export function entryMatches(e: LoreEntry, scan: string): boolean {
  const test = (k: string) => !!keyRegex(k, e.caseSensitive)?.test(scan);
  if (!e.keys.some(test)) return false;
  const sec = (e.secondaryKeys ?? []).filter((k) => k.trim());
  if (!sec.length) return true;
  const hits = sec.map(test);
  switch (e.logic ?? 'and_any') {
    case 'and_all':
      return hits.every(Boolean);
    case 'not_any':
      return !hits.some(Boolean);
    case 'not_all':
      return !hits.every(Boolean);
    default:
      return hits.some(Boolean);
  }
}

export interface LoreHits {
  hits: LoreEntry[];
  /** entri cocok yang dilewati karena batas token */
  skipped: number;
}

/** Entri yang kata kuncinya muncul di pesan terakhir (jangkauan per lorebook), dibatasi token per lorebook. */
export function matchLore(books: Lorebook[], history: Message[], pending: string, w: Pick<RpWorld, 'character' | 'persona'>): LoreHits {
  const hits: LoreEntry[] = [];
  let skipped = 0;
  for (const b of books) {
    const scan = [...history.slice(-Math.max(1, b.scanDepth)).map(messageText), pending].map((t) => macro(w, t)).join('\n');
    const found = b.entries
      .filter((e) => e.enabled && !e.constant && e.content.trim())
      .filter((e) => entryMatches(e, scan))
      .sort((a, c) => c.priority - a.priority);
    let used = 0;
    for (const e of found) {
      const t = estimateTokens(e.content.length);
      if (used + t > b.tokenBudget) {
        skipped++;
        continue;
      }
      used += t;
      hits.push(e);
    }
  }
  return { hits, skipped };
}

/* ---------- Ringkasan pesan lama ---------- */

export const RP_KEEP_FULL = 30;
export const RP_BLOCK = 30;
export const RP_AUTO_RATIO = 0.6;
/** Batas konteks bawaan untuk roleplay. Model besar (±1 juta token) membuat ambang 60% praktis tidak pernah tercapai. */
export const RP_DEFAULT_CONTEXT = 32_000;
export const RP_CONTEXT_OPTIONS = [16_000, 32_000, 64_000, 128_000, 0];

/** Ukuran konteks (token) yang memicu ringkasan Otomatis. */
export function rpAutoThreshold(chat: Pick<Chat, 'rpContext'>, modelLimit: number | undefined): number {
  const budget = chat.rpContext ?? RP_DEFAULT_CONTEXT;
  const byModel = modelLimit ? modelLimit * RP_AUTO_RATIO : Infinity;
  return budget > 0 ? Math.min(budget, byModel) : byModel;
}

export interface SummaryBlockRef {
  fromSeq: number;
  toSeq: number;
  msgs: Message[];
  hash: string;
}

/** Sidik isi blok (FNV-1a), berubah kalau pesan di blok diedit, dihapus, atau versinya diganti. */
export function blockHash(msgs: Message[]): string {
  let h = 0x811c9dc5;
  const s = msgs.map((m) => `${m.id}:${m.role}:${messageText(m)}`).join('\u0001');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + ':' + s.length;
}

/**
 * Blok yang boleh diringkas: pesan pembuka dan 30 pesan terakhir selalu utuh.
 * Batas blok mengikuti ringkasan yang sudah tersimpan (`anchors`), supaya menghapus satu pesan lama hanya
 * membuat blok pesan itu usang, tidak menggeser semua blok sesudahnya. Pesan di luar blok tersimpan
 * dikelompokkan per 30; sisa yang belum genap 30 dikirim utuh.
 */
export function summaryBlocks(history: Message[], anchors: { fromSeq: number; toSeq: number }[] = []): SummaryBlockRef[] {
  const body = history.filter((m) => !m.greeting);
  const eligible = body.slice(0, Math.max(0, body.length - RP_KEEP_FULL));
  const lastSeq = eligible.length ? eligible[eligible.length - 1].seq : -Infinity;
  const ranges = [...anchors].sort((a, b) => a.fromSeq - b.fromSeq);
  const rangeOf = (seq: number) => ranges.find((r) => seq >= r.fromSeq && seq <= r.toSeq);
  const out: SummaryBlockRef[] = [];
  let i = 0;
  while (i < eligible.length) {
    const r = rangeOf(eligible[i].seq);
    if (r) {
      const msgs: Message[] = [];
      while (i < eligible.length && eligible[i].seq <= r.toSeq) msgs.push(eligible[i++]);
      // Blok tersimpan yang sebagian sudah masuk 30 pesan terakhir (karena ada pesan dihapus): kirim utuh.
      if (r.toSeq <= lastSeq || msgs[msgs.length - 1]?.seq === r.toSeq) out.push({ fromSeq: r.fromSeq, toSeq: r.toSeq, msgs, hash: blockHash(msgs) });
      continue;
    }
    const msgs: Message[] = [];
    while (i < eligible.length && msgs.length < RP_BLOCK && !rangeOf(eligible[i].seq)) msgs.push(eligible[i++]);
    if (msgs.length === RP_BLOCK) out.push({ fromSeq: msgs[0].seq, toSeq: msgs[msgs.length - 1].seq, msgs, hash: blockHash(msgs) });
  }
  return out;
}

export function transcript(w: Pick<RpWorld, 'character' | 'persona'>, msgs: Message[]): string {
  const n = names(w);
  return msgs.map((m) => `${m.role === 'user' ? n.user : n.char}: ${macro(w, messageText(m))}`).join('\n\n');
}

/* ---------- Susun permintaan ---------- */

export interface BuildOptions {
  /** hanya pesan sebelum seq ini (untuk Coba lagi: balasan yang ditulis ulang dan sesudahnya tidak ikut) */
  beforeSeq?: number;
  /** reply = balasan karakter; impersonate = Bantu persona; suggest = saran balasan */
  mode: 'reply' | 'impersonate' | 'suggest';
  /** arahan Bantu persona */
  hint?: string;
  length: RpLength;
  /** ringkasan yang dipakai: fromSeq → teks dan akhir bloknya */
  summaries?: Map<number, { text: string; toSeq: number }>;
}

export interface BuiltRp {
  messages: ApiMessage[];
  lore: string[];
  loreSkipped: number;
  /** bagian-bagian permintaan untuk pratinjau */
  parts: PromptPart[];
  /** jumlah pesan riwayat yang dikirim utuh / blok ringkasan */
  historyCount: number;
  summaryCount: number;
}

export const PINNED_BUDGET = 1500;

export function buildRp(w: RpWorld, o: BuildOptions): BuiltRp {
  const history = historyOf(w.messages, o.beforeSeq);
  const sys = systemParts(w);
  const out: ApiMessage[] = [{ role: 'system', content: sys.map((p) => p.text).join('\n\n') }];
  const anchors = [...(o.summaries ?? new Map())].map(([fromSeq, v]) => ({ fromSeq, toSeq: v.toSeq }));
  const blocks = o.summaries?.size ? summaryBlocks(history, anchors).filter((b) => o.summaries!.has(b.fromSeq)) : [];
  const inBlock = new Map<string, SummaryBlockRef>();
  for (const b of blocks) for (const m of b.msgs) inBlock.set(m.id, b);
  const done = new Set<number>();
  const sumTexts: string[] = [];
  const histTexts: string[] = [];
  for (const m of history) {
    const b = inBlock.get(m.id);
    if (b) {
      if (!done.has(b.fromSeq)) {
        done.add(b.fromSeq);
        const t = summaryBlock(o.summaries!.get(b.fromSeq)!.text);
        sumTexts.push(t);
        out.push({ role: 'user', content: t });
      }
      continue;
    }
    const t = macro(w, messageText(m));
    histTexts.push(t);
    out.push({ role: m.role, content: t });
  }

  const pending = o.mode !== 'reply' ? (o.hint ?? '') : '';
  const lore = matchLore(w.books, history, pending, w);
  const extras: PromptPart[] = [];
  if (lore.hits.length) extras.push({ key: 'lore', label: `Lore yang cocok (${lore.hits.length})`, text: macro(w, loreBlock(lore.hits)) });
  if (w.chat.memory?.trim()) extras.push({ key: 'memory', label: 'Memori chat', text: macro(w, memoryBlock(w.chat.memory.trim())) });
  // Pesan tersemat yang sudah masuk ringkasan dikirim apa adanya (yang terbaru didahulukan, dibatasi token).
  const pinned = history.filter((m) => m.pinned && inBlock.has(m.id)).reverse();
  const moments: string[] = [];
  let used = 0;
  const n = names(w);
  for (const m of pinned) {
    const t = `${m.role === 'user' ? n.user : n.char}: ${macro(w, messageText(m))}`;
    const tk = estimateTokens(t.length);
    if (used + tk > PINNED_BUDGET) break;
    used += tk;
    moments.unshift(t);
  }
  if (moments.length) extras.push({ key: 'pinned', label: `Momen tersemat (${moments.length})`, text: `[Momen penting yang disematkan pengguna]\n${moments.join('\n\n')}` });
  const style = styleBlock(w.chat.rpStyle);
  if (o.mode === 'impersonate' || o.mode === 'suggest') {
    if (style) extras.push({ key: 'style', label: 'Gaya', text: macro(w, style) });
    extras.push({ key: 'instr-end', label: o.mode === 'suggest' ? 'Instruksi saran balasan' : 'Instruksi Bantu persona', text: macro(w, o.mode === 'suggest' ? suggestInstr() : impersonateInstr(o.hint ?? '')) });
    out.push({ role: 'user', content: extras.map((e) => e.text).join('\n\n') });
  } else {
    // depth_prompt dari kartu SillyTavern ikut di akhir (bukan di kedalaman tertentu), supaya riwayat tetap kena cache.
    const reminders = [w.character.postHistory.trim(), depthPrompt(w.character).trim(), w.chat.reminder?.trim() ?? ''].filter(Boolean);
    if (reminders.length) extras.push({ key: 'reminder', label: 'Pengingat aturan', text: macro(w, reminderBlock(reminders.join('\n'))) });
    if (style) extras.push({ key: 'style', label: 'Gaya', text: macro(w, style) });
    extras.push({ key: 'length', label: 'Target panjang', text: macro(w, lengthInstr(o.length)) });
    const joined = extras.map((e) => e.text).join('\n\n');
    const last = out[out.length - 1];
    // Ditempel ke giliran terakhir pengguna; tidak disimpan ke riwayat (cache tetap kena).
    if (last.role === 'user' && typeof last.content === 'string') last.content = `${last.content}\n\n${joined}`;
    else out.push({ role: 'user', content: joined });
  }
  const parts: PromptPart[] = [
    ...sys,
    ...(sumTexts.length ? [{ key: 'summaries', label: `Ringkasan (${sumTexts.length} blok)`, text: sumTexts.join('\n\n') }] : []),
    { key: 'history', label: `Riwayat (${histTexts.length} pesan)`, text: histTexts.join('\n\n') },
    ...extras,
  ];
  return { messages: mergeSameRole(out), lore: lore.hits.map((e) => e.title), loreSkipped: lore.skipped, parts, historyCount: histTexts.length, summaryCount: sumTexts.length };
}

/** Perkiraan token seluruh konteks chat (tanpa ringkasan). */
export function estimateRp(w: RpWorld): number {
  const chars = systemText(w).length + historyOf(w.messages).reduce((n, m) => n + messageText(m).length, 0);
  return estimateTokens(chars);
}

/* ---------- Pengaman balasan ---------- */

const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Rapikan balasan model:
 * - buang label nama di awal ("Rika: …", "**Rika:** …");
 * - potong mulai baris yang diawali nama pihak lain ("Dimas: …"), karena itu berarti model mulai menulis giliran
 *   pihak lain. `cut` = true kalau ada yang dipotong.
 */
export function guardReply(text: string, self: string, other: string): { text: string; cut: boolean } {
  const label = (name: string) => `(?:\\*\\*)?(?:${esc(name)})(?:\\*\\*)?\\s*:(?:\\*\\*)?`;
  let t = text.replace(new RegExp(`^\\s*${label(self)}\\s*`, 'i'), '');
  const m = t.match(new RegExp(`(^|\\n)[ \\t]*${label(other)}`, 'i'));
  if (m && m.index !== undefined) {
    t = t.slice(0, m.index).replace(/\s+$/, '');
    return { text: t, cut: true };
  }
  return { text: t, cut: false };
}
