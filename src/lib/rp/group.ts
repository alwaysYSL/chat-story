import type { Chat, Message } from '../../db';

/** Group chat (Versi 3.2): keanggotaan dan pemilihan pembicara. */

export const MAX_MEMBERS = 5;

export function isGroupChat(chat: Pick<Chat, 'memberIds'> | null | undefined): boolean {
  return (chat?.memberIds?.length ?? 0) >= 2;
}

/** Anggota berurutan; chat 1:1 = satu anggota (characterId). */
export function memberIdsOf(chat: Pick<Chat, 'memberIds' | 'characterId'>): string[] {
  if (chat.memberIds?.length) return chat.memberIds;
  return chat.characterId ? [chat.characterId] : [];
}

/** "Rika", "Rika & Sari", "Rika, Sari & Bayu" */
export function joinNames(list: string[]): string {
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} & ${list[list.length - 1]}`;
}

export interface SpeakerMember {
  id: string;
  name: string;
}

export interface PickInput {
  /** anggota yang masih ada (urut), termasuk yang dibisukan */
  members: SpeakerMember[];
  muted?: string[];
  history: Message[];
  mode: 'auto' | 'order' | 'manual';
  /** dipilih pengguna di baris anggota */
  forced?: string | null;
  /** sudah menjawab di giliran ini (balasan berantai) */
  exclude?: Set<string>;
  /** pembicara pesan lama tanpa speakerId (chat 1:1 yang dijadikan grup) */
  fallbackId?: string | null;
}

const escRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Posisi terakhir nama (atau nama depan, minimal 3 huruf) disebut di teks; -1 kalau tidak disebut. */
export function lastMention(text: string, name: string): number {
  const variants = [name.trim(), name.trim().split(/\s+/)[0]].filter((v, i, a) => v.length >= 3 && a.indexOf(v) === i);
  let best = -1;
  for (const v of variants) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escRe(v)}(?![\\p{L}\\p{N}_])`, 'giu');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) best = Math.max(best, m.index);
  }
  return best;
}

export function speakerIdOf(m: Message, fallbackId?: string | null): string | null {
  return m.role === 'assistant' ? (m.speakerId ?? fallbackId ?? null) : null;
}

/**
 * Siapa yang bicara berikutnya. Otomatis (tanpa biaya): dipilih pengguna → disebut paling akhir di pesan pengguna
 * terakhir → disebut di balasan terakhir (selain pembicaranya) → paling lama diam. Karakter yang baru bicara tidak
 * dipilih lagi kecuali satu-satunya. Manual: hanya kalau dipilih pengguna.
 */
export function pickSpeaker(o: PickInput): string | null {
  const alive = new Set(o.members.map((m) => m.id));
  if (o.forced && alive.has(o.forced)) return o.forced;
  if (o.mode === 'manual') return null;
  const muted = new Set(o.muted ?? []);
  const exclude = o.exclude ?? new Set<string>();
  let cands = o.members.filter((m) => !muted.has(m.id) && !exclude.has(m.id));
  if (!cands.length) return null;
  const asst = o.history.filter((m) => m.role === 'assistant');
  const lastAsst = asst[asst.length - 1];
  const lastSpeaker = lastAsst ? speakerIdOf(lastAsst, o.fallbackId) : null;

  if (o.mode === 'order') {
    const order = o.members.filter((m) => !muted.has(m.id));
    const i = order.findIndex((m) => m.id === lastSpeaker);
    for (let k = 1; k <= order.length; k++) {
      const m = order[(i + k + order.length) % order.length];
      if (!exclude.has(m.id)) return m.id;
    }
    return null;
  }

  if (cands.length > 1 && lastSpeaker) cands = cands.filter((m) => m.id !== lastSpeaker);
  const mentioned = (text: string, pool: SpeakerMember[]) => {
    let best: { id: string; at: number } | null = null;
    for (const m of pool) {
      const at = lastMention(text, m.name);
      if (at >= 0 && (!best || at > best.at)) best = { id: m.id, at };
    }
    return best?.id ?? null;
  };
  // Pesan pengguna terakhir (sesudah balasan terakhir) yang menyebut nama.
  const lastUserIdx = o.history.map((m) => m.role).lastIndexOf('user');
  const lastAsstIdx = o.history.indexOf(lastAsst);
  if (lastUserIdx >= 0 && lastUserIdx > lastAsstIdx) {
    const byUser = mentioned(o.history[lastUserIdx].text, cands);
    if (byUser) return byUser;
  }
  if (lastAsst) {
    const byChar = mentioned(lastAsst.text, cands);
    if (byChar) return byChar;
  }
  // Paling lama diam (belum pernah bicara = paling lama).
  const lastAt = (id: string) => {
    for (let i = asst.length - 1; i >= 0; i--) if (speakerIdOf(asst[i], o.fallbackId) === id) return i;
    return -1;
  };
  return [...cands].sort((a, b) => lastAt(a.id) - lastAt(b.id))[0].id;
}
