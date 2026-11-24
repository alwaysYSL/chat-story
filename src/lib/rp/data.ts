import { db, type Character, type Chat, type Lorebook, type Message, type Persona } from '../../db';
import { deleteChatPermanently, TRASH_DAYS } from '../pages';
import { markChanged } from '../settings';
import { uid } from '../util';
import type { ImportedCard } from './cards';
import { blockHash } from './context';
import { isGroupChat, MAX_MEMBERS, memberIdsOf } from './group';

/* ---------- Karakter ---------- */

export function emptyCharacter(): Character {
  const now = Date.now();
  return {
    id: uid(),
    name: '',
    avatar: null,
    description: '',
    personality: '',
    scenario: '',
    firstMes: '',
    altGreetings: [],
    mesExample: '',
    systemPrompt: '',
    postHistory: '',
    creatorNotes: '',
    tags: [],
    personaId: null,
    worldIds: [],
    extra: {},
    pinned: false,
    createdAt: now,
    updatedAt: now,
    usedAt: 0,
    deletedAt: null,
  };
}

export async function saveCharacter(c: Character): Promise<void> {
  await db.characters.put({ ...c, updatedAt: Date.now() });
  markChanged();
}

export async function importCard(card: ImportedCard, pic: { avatar: Blob | null; photo?: Blob | null; crop?: Character['crop'] }): Promise<Character> {
  const now = Date.now();
  const c: Character = { ...card.character, avatar: pic.avatar, photo: pic.photo ?? null, crop: pic.crop ?? null, createdAt: now, updatedAt: now, usedAt: 0 };
  await db.transaction('rw', db.characters, db.lorebooks, async () => {
    await db.characters.add(c);
    if (card.lorebook) await db.lorebooks.add({ ...card.lorebook, createdAt: now, updatedAt: now });
  });
  markChanged();
  return c;
}

export async function ownLorebook(characterId: string): Promise<Lorebook | undefined> {
  return (await db.lorebooks.where('characterId').equals(characterId).toArray()).find((b) => !b.deletedAt);
}

export function emptyLorebook(characterId: string | null, name: string): Lorebook {
  const now = Date.now();
  return { id: uid(), name, characterId, scanDepth: 4, tokenBudget: 1500, entries: [], createdAt: now, updatedAt: now, deletedAt: null };
}

export async function ensureOwnLorebook(c: Character): Promise<Lorebook> {
  const b = await ownLorebook(c.id);
  if (b) return b;
  const nb = emptyLorebook(c.id, `Lorebook ${c.name || 'karakter'}`);
  await db.lorebooks.add(nb);
  return nb;
}

export async function duplicateCharacter(id: string): Promise<Character | null> {
  const c = await db.characters.get(id);
  if (!c) return null;
  const now = Date.now();
  const copy: Character = { ...c, id: uid(), name: `${c.name} (salinan)`, pinned: false, createdAt: now, updatedAt: now, usedAt: 0, deletedAt: null };
  const book = await ownLorebook(id);
  await db.transaction('rw', db.characters, db.lorebooks, async () => {
    await db.characters.add(copy);
    if (book) await db.lorebooks.add({ ...book, id: uid(), characterId: copy.id, createdAt: now, updatedAt: now });
  });
  markChanged();
  return copy;
}

/** Semua chat roleplay yang melibatkan karakter ini (chat 1:1 dan grup). */
export async function chatsOfCharacter(id: string): Promise<Chat[]> {
  const a = await db.chats.where('characterId').equals(id).toArray();
  const b = await db.chats.where('memberIds').equals(id).toArray();
  const map = new Map([...a, ...b].map((c) => [c.id, c]));
  return [...map.values()];
}

/** Anggota lain yang masih ada (tidak di Sampah, tidak dihapus). */
async function otherAlive(chat: Chat, id: string): Promise<string[]> {
  const ids = (chat.memberIds ?? []).filter((x) => x !== id);
  const found = await db.characters.bulkGet(ids);
  return ids.filter((_, i) => found[i] && !found[i]!.deletedAt);
}

/**
 * Karakter ke Sampah: chat 1:1-nya ikut ke Sampah. Grup yang masih punya anggota lain tetap berjalan tanpa karakter
 * ini (kartunya tidak dikirim, pesan lamanya tetap ada).
 */
export async function trashCharacter(id: string): Promise<void> {
  const now = Date.now();
  const chats = await chatsOfCharacter(id);
  await db.transaction('rw', db.characters, db.chats, async () => {
    await db.characters.update(id, { deletedAt: now });
    for (const c of chats) {
      if (c.deletedAt) continue;
      const others = await otherAlive(c, id);
      if (isGroupChat(c) && others.length) {
        if (c.characterId === id) await db.chats.update(c.id, { characterId: others[0] });
      } else await db.chats.update(c.id, { deletedAt: now });
    }
  });
  markChanged();
}

export async function restoreCharacter(id: string): Promise<void> {
  const c = await db.characters.get(id);
  if (!c) return;
  const at = c.deletedAt;
  const chats = await chatsOfCharacter(id);
  await db.transaction('rw', db.characters, db.chats, async () => {
    await db.characters.update(id, { deletedAt: null });
    for (const ch of chats) if (ch.deletedAt === at) await db.chats.update(ch.id, { deletedAt: null });
  });
  markChanged();
}

export async function deleteCharacterHard(id: string): Promise<void> {
  for (const c of await chatsOfCharacter(id)) {
    const rest = (c.memberIds ?? []).filter((x) => x !== id);
    const exist = (await db.characters.bulkGet(rest)).filter(Boolean).length;
    if (isGroupChat(c) && exist) {
      // Grup tetap ada; pesan lama karakter ini tetap tampil dengan nama yang tersimpan.
      await db.chats.update(c.id, { memberIds: rest, muted: (c.muted ?? []).filter((x) => x !== id), characterId: c.characterId === id ? rest[0] : c.characterId });
    } else await deleteChatPermanently(c.id);
  }
  await db.transaction('rw', db.characters, db.lorebooks, db.usage, async () => {
    await db.lorebooks.where('characterId').equals(id).delete();
    await db.usage.where('rootId').equals(id).delete();
    await db.characters.delete(id);
  });
}

/* ---------- Anggota grup ---------- */

/** Tambah anggota. Chat 1:1 menjadi grup; balasan lamanya ditandai milik karakter semula. */
export async function addMember(chatId: string, characterId: string): Promise<void> {
  const chat = await db.chats.get(chatId);
  if (!chat || !chat.characterId) return;
  const ids = memberIdsOf(chat);
  if (ids.includes(characterId)) return;
  if (ids.length >= MAX_MEMBERS) throw new Error(`Maksimal ${MAX_MEMBERS} karakter dalam satu grup.`);
  const now = Date.now();
  await db.transaction('rw', db.chats, db.messages, db.characters, async () => {
    if (!isGroupChat(chat)) {
      const first = await db.characters.get(chat.characterId!);
      const name = first?.name ?? '';
      for (const m of await db.messages.where('chatId').equals(chatId).toArray()) {
        if (m.role !== 'assistant' || m.speakerId) continue;
        await db.messages.update(m.id, {
          speakerId: chat.characterId!,
          speakerName: name,
          versions: m.versions.map((v) => ({ ...v, speakerId: v.speakerId ?? chat.characterId!, speakerName: v.speakerName ?? name })),
        });
      }
    }
    await db.chats.update(chatId, { memberIds: [...ids, characterId], turnMode: chat.turnMode ?? 'auto', chain: chat.chain ?? 1, updatedAt: now });
    await db.characters.update(characterId, { usedAt: now });
  });
  markChanged();
}

export async function removeMember(chatId: string, characterId: string): Promise<void> {
  const chat = await db.chats.get(chatId);
  if (!chat) return;
  const ids = memberIdsOf(chat).filter((x) => x !== characterId);
  if (!ids.length) throw new Error('Grup harus punya minimal satu karakter.');
  await db.chats.update(chatId, { memberIds: ids, muted: (chat.muted ?? []).filter((x) => x !== characterId), characterId: ids[0], updatedAt: Date.now() });
  markChanged();
}

export async function moveMember(chatId: string, characterId: string, dir: -1 | 1): Promise<void> {
  const chat = await db.chats.get(chatId);
  if (!chat?.memberIds) return;
  const ids = [...chat.memberIds];
  const i = ids.indexOf(characterId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await db.chats.update(chatId, { memberIds: ids, characterId: ids[0] });
  markChanged();
}

export async function toggleMute(chatId: string, characterId: string): Promise<boolean> {
  const chat = await db.chats.get(chatId);
  if (!chat) return false;
  const muted = new Set(chat.muted ?? []);
  const on = !muted.has(characterId);
  if (on) muted.add(characterId);
  else muted.delete(characterId);
  await db.chats.update(chatId, { muted: [...muted] });
  markChanged();
  return on;
}

/** Chat roleplay terhapus bisa dipulihkan hanya kalau karakternya masih ada (karakter dipulihkan sekalian). */
export async function restoreRpChat(chat: Chat): Promise<void> {
  if (chat.characterId) {
    const c = await db.characters.get(chat.characterId);
    if (c?.deletedAt) return restoreCharacter(c.id);
  }
  await db.chats.update(chat.id, { deletedAt: null });
  markChanged();
}

/* ---------- Persona ---------- */

export function emptyPersona(name = ''): Persona {
  const now = Date.now();
  return { id: uid(), name, avatar: null, description: '', isDefault: false, createdAt: now, updatedAt: now, deletedAt: null };
}

export async function listPersonas(): Promise<Persona[]> {
  return (await db.personas.toArray()).filter((p) => !p.deletedAt).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
}

export async function defaultPersona(): Promise<Persona | undefined> {
  const list = await listPersonas();
  return list.find((p) => p.isDefault) ?? list[0];
}

/**
 * Persona yang dipakai: persona pilihan kalau masih ada (tidak di Sampah), selain itu persona bawaan.
 * Dipakai di semua tempat supaya persona yang dihapus tidak pernah dipakai lagi.
 */
export async function resolvePersona(personaId: string | null | undefined): Promise<Persona | null> {
  if (personaId) {
    const p = await db.personas.get(personaId);
    if (p && !p.deletedAt) return p;
  }
  return (await defaultPersona()) ?? null;
}

export async function savePersona(p: Persona): Promise<void> {
  await db.transaction('rw', db.personas, async () => {
    const others = (await db.personas.toArray()).filter((x) => x.id !== p.id && !x.deletedAt);
    // Selalu ada tepat satu persona bawaan.
    const makeDefault = p.isDefault || !others.some((x) => x.isDefault);
    if (makeDefault) for (const o of others) if (o.isDefault) await db.personas.update(o.id, { isDefault: false });
    await db.personas.put({ ...p, isDefault: makeDefault, updatedAt: Date.now() });
  });
  markChanged();
}

export async function trashPersona(id: string): Promise<void> {
  const p = await db.personas.get(id);
  await db.personas.update(id, { deletedAt: Date.now(), isDefault: false });
  if (p?.isDefault) {
    const next = (await listPersonas())[0];
    if (next) await db.personas.update(next.id, { isDefault: true });
  }
  markChanged();
}

export async function restorePersona(id: string): Promise<void> {
  await db.personas.update(id, { deletedAt: null });
  if (!(await listPersonas()).some((p) => p.isDefault)) await db.personas.update(id, { isDefault: true });
  markChanged();
}

/* ---------- Lorebook dunia ---------- */

export async function saveLorebook(b: Lorebook): Promise<void> {
  await db.lorebooks.put({ ...b, updatedAt: Date.now() });
  markChanged();
}

export async function trashLorebook(id: string): Promise<void> {
  await db.lorebooks.update(id, { deletedAt: Date.now() });
  markChanged();
}

export async function restoreLorebook(id: string): Promise<void> {
  await db.lorebooks.update(id, { deletedAt: null });
  markChanged();
}

export async function deleteLorebookHard(id: string): Promise<void> {
  await db.lorebooks.delete(id);
  // Lepas dari karakter yang memasangnya.
  for (const c of await db.characters.toArray()) {
    if (c.worldIds.includes(id)) await db.characters.update(c.id, { worldIds: c.worldIds.filter((w) => w !== id) });
  }
}

/* ---------- Chat ---------- */

export async function rpMessages(chatId: string): Promise<Message[]> {
  return db.messages.where('chatId').equals(chatId).sortBy('seq');
}

export async function purgeRpTrash(): Promise<void> {
  const limit = Date.now() - TRASH_DAYS * 86400_000;
  for (const c of await db.characters.filter((x) => !!x.deletedAt && x.deletedAt < limit).toArray()) await deleteCharacterHard(c.id);
  for (const p of await db.personas.filter((x) => !!x.deletedAt && x.deletedAt < limit).toArray()) await db.personas.delete(p.id);
  for (const b of await db.lorebooks.filter((x) => !!x.deletedAt && x.deletedAt < limit).toArray()) await deleteLorebookHard(b.id);
}

export async function duplicateRpChat(chatId: string): Promise<string | null> {
  const chat = await db.chats.get(chatId);
  if (!chat) return null;
  const now = Date.now();
  const id = uid();
  const msgs = await rpMessages(chatId);
  const ids = new Map(msgs.map((m) => [m.id, uid()]));
  const sums = await db.rpSummaries.where('chatId').equals(chatId).toArray();
  await db.transaction('rw', db.chats, db.messages, db.rpSummaries, async () => {
    await db.chats.add({ ...chat, id, title: `${chat.title} (salinan)`, titleAuto: false, createdAt: now, updatedAt: now, deletedAt: null });
    const copies = msgs.map((m) => ({ ...m, id: ids.get(m.id)!, chatId: id, status: m.status === 'streaming' ? ('done' as const) : m.status }));
    await db.messages.bulkAdd(copies);
    // Ringkasan ikut disalin (sidiknya dihitung ulang dengan id pesan salinan), supaya tidak perlu diringkas ulang.
    for (const s of sums) {
      const inRange = (list: Message[]) => list.filter((m) => m.seq >= s.fromSeq && m.seq <= s.toSeq && m.status !== 'canceled' && (m.role === 'user' || m.text.trim()));
      if (blockHash(inRange(msgs)) !== s.hash) continue; // sudah usang di chat asal
      await db.rpSummaries.add({ ...s, id: uid(), chatId: id, hash: blockHash(inRange(copies)) });
    }
  });
  markChanged();
  return id;
}

/**
 * Cabang chat: chat baru berisi semua pesan sampai pesan yang dipilih (termasuk versi balasan),
 * memori, pengingat, gaya, persona, dan ringkasan blok yang tersalin utuh.
 */
export async function branchRpChat(chatId: string, msgId: string): Promise<string | null> {
  const chat = await db.chats.get(chatId);
  const at = await db.messages.get(msgId);
  if (!chat || !at) return null;
  const now = Date.now();
  const id = uid();
  const msgs = (await rpMessages(chatId)).filter((m) => m.seq <= at.seq);
  const ids = new Map(msgs.map((m) => [m.id, uid()]));
  const sums = (await db.rpSummaries.where('chatId').equals(chatId).toArray()).filter((s) => s.toSeq <= at.seq);
  await db.transaction('rw', db.chats, db.messages, db.rpSummaries, async () => {
    await db.chats.add({
      ...chat,
      id,
      title: `${chat.title} (cabang)`,
      titleAuto: false,
      branchOf: { chatId, title: chat.title, seq: at.seq },
      memoryAtCount: Math.min(chat.memoryAtCount ?? 0, msgs.length),
      draft: '',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    const copies = msgs.map((m) => ({ ...m, id: ids.get(m.id)!, chatId: id, status: m.status === 'streaming' ? ('done' as const) : m.status }));
    await db.messages.bulkAdd(copies);
    for (const s of sums) {
      const inRange = (list: Message[]) => list.filter((m) => m.seq >= s.fromSeq && m.seq <= s.toSeq && m.status !== 'canceled' && (m.role === 'user' || m.text.trim()));
      if (blockHash(inRange(msgs)) !== s.hash) continue;
      await db.rpSummaries.add({ ...s, id: uid(), chatId: id, hash: blockHash(inRange(copies)) });
    }
  });
  markChanged();
  return id;
}

export async function togglePin(msgId: string): Promise<boolean> {
  const m = await db.messages.get(msgId);
  if (!m) return false;
  const pinned = !m.pinned;
  await db.messages.update(msgId, { pinned });
  markChanged();
  return pinned;
}
