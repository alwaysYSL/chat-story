import { db, type Character, type Chat, type Lorebook, type Message, type Persona } from '../../db';
import { deleteChatPermanently, TRASH_DAYS } from '../pages';
import { markChanged } from '../settings';
import { uid } from '../util';
import type { ImportedCard } from './cards';

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

export async function importCard(card: ImportedCard, avatar: Blob | null): Promise<Character> {
  const now = Date.now();
  const c: Character = { ...card.character, avatar, createdAt: now, updatedAt: now, usedAt: 0 };
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

export async function trashCharacter(id: string): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', db.characters, db.chats, async () => {
    await db.characters.update(id, { deletedAt: now });
    const chats = await db.chats.where('characterId').equals(id).toArray();
    for (const c of chats) if (!c.deletedAt) await db.chats.update(c.id, { deletedAt: now });
  });
  markChanged();
}

export async function restoreCharacter(id: string): Promise<void> {
  const c = await db.characters.get(id);
  if (!c) return;
  const at = c.deletedAt;
  await db.transaction('rw', db.characters, db.chats, async () => {
    await db.characters.update(id, { deletedAt: null });
    const chats = await db.chats.where('characterId').equals(id).toArray();
    for (const ch of chats) if (ch.deletedAt === at) await db.chats.update(ch.id, { deletedAt: null });
  });
  markChanged();
}

export async function deleteCharacterHard(id: string): Promise<void> {
  const chats = await db.chats.where('characterId').equals(id).toArray();
  for (const c of chats) await deleteChatPermanently(c.id);
  await db.transaction('rw', db.characters, db.lorebooks, db.usage, async () => {
    await db.lorebooks.where('characterId').equals(id).delete();
    await db.usage.where('rootId').equals(id).delete();
    await db.characters.delete(id);
  });
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
    await db.messages.bulkAdd(msgs.map((m) => ({ ...m, id: ids.get(m.id)!, chatId: id, status: m.status === 'streaming' ? 'done' : m.status })));
    // Ringkasan memakai sidik id pesan, jadi dibuat ulang saat dibutuhkan; tidak disalin.
    void sums;
  });
  markChanged();
  return id;
}
