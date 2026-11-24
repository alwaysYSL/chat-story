import { db, type Character, type Chat, type LoreEntry, type Lorebook, type Message, type Persona, type RpLength } from '../../db';
import type { ApiMessage } from '../api';
import { mergeSameRole } from '../context';
import { estimateTokens } from '../providers';
import { fillMacros } from './cards';
import { CONTINUE_INSTR, impersonateInstr, lengthInstr, loreBlock, memoryBlock, reminderBlock, summaryBlock, SYSTEM_RP } from './prompts';

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
  const persona = chat.personaId ? ((await db.personas.get(chat.personaId)) ?? null) : null;
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

export function systemText(w: RpWorld): string {
  const c = w.character;
  const parts = [c.systemPrompt.trim() || SYSTEM_RP];
  const card = [
    `[Karakter: {{char}}]`,
    c.description.trim() && `Deskripsi:\n${c.description.trim()}`,
    c.personality.trim() && `Kepribadian: ${c.personality.trim()}`,
  ]
    .filter(Boolean)
    .join('\n');
  parts.push(card);
  if (c.scenario.trim()) parts.push(`[Skenario]\n${c.scenario.trim()}`);
  if (w.persona && (w.persona.description.trim() || w.persona.name.trim())) {
    parts.push(`[Persona {{user}}, tokoh yang dimainkan pengguna]\n${w.persona.description.trim() || '(tanpa deskripsi)'}`);
  }
  const ex = c.mesExample.trim().replace(/<START>/gi, '---').trim();
  if (ex) parts.push(`[Contoh gaya bicara. Hanya contoh, bukan bagian cerita.]\n${ex}`);
  const constant = w.books.flatMap((b) => b.entries.filter((e) => e.enabled && e.constant && e.content.trim()));
  if (constant.length) parts.push(loreBlock(constant.sort((a, b) => b.priority - a.priority)));
  return macro(w, parts.join('\n\n'));
}

/* ---------- Lorebook ---------- */

function keyRegex(key: string): RegExp | null {
  const k = key.trim();
  if (!k) return null;
  const m = k.match(/^\/(.+)\/([a-z]*)$/i);
  if (m) {
    try {
      return new RegExp(m[1], m[2].includes('i') ? m[2] : m[2] + 'i');
    } catch {
      return null;
    }
  }
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])`, 'iu');
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
      .filter((e) => e.keys.some((k) => keyRegex(k)?.test(scan)))
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

/** Blok penuh yang boleh diringkas: pesan pembuka dan 30 pesan terakhir selalu utuh. */
export function summaryBlocks(history: Message[]): SummaryBlockRef[] {
  const body = history.filter((m) => !m.greeting);
  const eligible = body.length - RP_KEEP_FULL;
  const out: SummaryBlockRef[] = [];
  for (let i = 0; i + RP_BLOCK <= eligible; i += RP_BLOCK) {
    const msgs = body.slice(i, i + RP_BLOCK);
    out.push({ fromSeq: msgs[0].seq, toSeq: msgs[msgs.length - 1].seq, msgs, hash: blockHash(msgs) });
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
  mode: 'reply' | 'impersonate';
  /** arahan Bantu persona */
  hint?: string;
  length: RpLength;
  /** ringkasan yang dipakai: fromSeq → teks */
  summaries?: Map<number, string>;
}

export interface BuiltRp {
  messages: ApiMessage[];
  lore: string[];
  loreSkipped: number;
}

export function buildRp(w: RpWorld, o: BuildOptions): BuiltRp {
  const history = historyOf(w.messages, o.beforeSeq);
  const out: ApiMessage[] = [{ role: 'system', content: systemText(w) }];
  const blocks = o.summaries?.size ? summaryBlocks(history).filter((b) => o.summaries!.has(b.fromSeq)) : [];
  const inBlock = new Map<string, SummaryBlockRef>();
  for (const b of blocks) for (const m of b.msgs) inBlock.set(m.id, b);
  const done = new Set<number>();
  for (const m of history) {
    const b = inBlock.get(m.id);
    if (b) {
      if (!done.has(b.fromSeq)) {
        done.add(b.fromSeq);
        out.push({ role: 'user', content: summaryBlock(o.summaries!.get(b.fromSeq)!) });
      }
      continue;
    }
    out.push({ role: m.role, content: macro(w, messageText(m)) });
  }

  const pending = o.mode === 'impersonate' ? (o.hint ?? '') : '';
  const lore = matchLore(w.books, history, pending, w);
  const extras: string[] = [];
  if (lore.hits.length) extras.push(macro(w, loreBlock(lore.hits)));
  if (w.chat.memory?.trim()) extras.push(macro(w, memoryBlock(w.chat.memory.trim())));
  if (o.mode === 'impersonate') {
    extras.push(macro(w, impersonateInstr(o.hint ?? '')));
    out.push({ role: 'user', content: extras.join('\n\n') });
  } else {
    const reminders = [w.character.postHistory.trim(), w.chat.reminder?.trim() ?? ''].filter(Boolean);
    if (reminders.length) extras.push(macro(w, reminderBlock(reminders.join('\n'))));
    extras.push(macro(w, lengthInstr(o.length)));
    const last = out[out.length - 1];
    // Ditempel ke giliran terakhir pengguna; tidak disimpan ke riwayat (cache tetap kena).
    if (last.role === 'user' && typeof last.content === 'string') last.content = `${last.content}\n\n${extras.join('\n\n')}`;
    else out.push({ role: 'user', content: extras.join('\n\n') });
  }
  return { messages: mergeSameRole(out), lore: lore.hits.map((e) => e.title), loreSkipped: lore.skipped };
}

/** Perkiraan token seluruh konteks chat (tanpa ringkasan). */
export function estimateRp(w: RpWorld): number {
  const chars = systemText(w).length + historyOf(w.messages).reduce((n, m) => n + messageText(m).length, 0);
  return estimateTokens(chars);
}
