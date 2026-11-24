import type { JSONContent } from '@tiptap/react';
import { db, type Chat, type Message, type Page, type Attachment } from '../db';
import { emptyDoc, plainText, remapSegments, serializeBlocks, docBlocks } from './markdown';
import { countWords, uid } from './util';
import { markChanged } from './settings';

export const TRASH_DAYS = 30;

export function makePage(p: Partial<Page> & { parentId: string | null }): Page {
  const now = Date.now();
  return {
    id: uid(),
    order: 0,
    title: '',
    titleAuto: true,
    icon: '📄',
    pinned: false,
    doc: emptyDoc(),
    text: '',
    words: 0,
    scrollY: 0,
    extRev: 0,
    createdAt: now,
    updatedAt: now,
    openedAt: now,
    deletedAt: null,
    ...p,
  };
}

export async function createStory(title = ''): Promise<Page> {
  const page = makePage({ parentId: null, title, titleAuto: !title });
  await db.pages.add(page);
  markChanged();
  return page;
}

export async function getChapters(rootId: string): Promise<Page[]> {
  const list = await db.pages.where('parentId').equals(rootId).toArray();
  return list.filter((p) => !p.deletedAt).sort((a, b) => a.order - b.order);
}

/** Page cerita + semua bab, berurutan. */
export async function getStoryPages(rootId: string): Promise<Page[]> {
  const root = await db.pages.get(rootId);
  if (!root) return [];
  return [root, ...(await getChapters(rootId))];
}

export async function lastStoryPage(rootId: string): Promise<Page | undefined> {
  const pages = await getStoryPages(rootId);
  return pages[pages.length - 1];
}

export async function createChapter(rootId: string): Promise<Page> {
  const page = await db.transaction('rw', db.pages, async () => {
    const all = await db.pages.where('parentId').equals(rootId).toArray();
    const alive = all.filter((p) => !p.deletedAt);
    const order = all.reduce((m, p) => Math.max(m, p.order), 0) + 1;
    // Nomor tidak dipakai ulang walaupun ada bab yang dihapus (termasuk yang masih di Sampah).
    const maxNum = all.reduce((m, p) => {
      const n = /^Bagian (\d+)$/.exec(p.title.trim());
      return n ? Math.max(m, Number(n[1])) : m;
    }, 1);
    const num = Math.max(alive.length + 2, maxNum + 1);
    const p = makePage({ parentId: rootId, order, title: `Bagian ${num}`, titleAuto: true });
    await db.pages.add(p);
    await db.pages.update(rootId, { updatedAt: Date.now() });
    return p;
  });
  markChanged();
  return page;
}

/**
 * Hapus page yang dibuat lalu ditinggal tanpa diisi apa pun (✏️ Page baru / + Bab baru lalu kembali).
 * Page tidak dihapus kalau sudah pernah diubah, punya bab, punya chat, atau sedang/pernah ditulis AI.
 */
export async function discardIfUntouched(id: string): Promise<boolean> {
  const page = await db.pages.get(id);
  if (!page || page.deletedAt || page.words > 0 || page.text.trim()) return false;
  if (page.updatedAt !== page.createdAt || !page.titleAuto || page.title.trim() && !/^Bagian \d+$/.test(page.title)) return false;
  if (!page.parentId) {
    if ((await db.pages.where('parentId').equals(id).count()) > 0) return false;
    if ((await db.chats.where('pageId').equals(id).count()) > 0) return false;
  }
  if (await db.messages.filter((m) => m.targetPageId === id || m.createdPageId === id).first()) return false;
  await db.pages.delete(id);
  return true;
}

export function rootIdOf(page: Page): string {
  return page.parentId ?? page.id;
}

export async function savePageDoc(id: string, doc: JSONContent, external: boolean): Promise<void> {
  const text = plainText(doc);
  const now = Date.now();
  await db.transaction('rw', db.pages, async () => {
    const page = await db.pages.get(id);
    if (!page) return;
    await db.pages.update(id, {
      doc,
      text,
      words: countWords(text),
      updatedAt: now,
      ...(external ? { extRev: page.extRev + 1 } : {}),
    });
    if (page.parentId) await db.pages.update(page.parentId, { updatedAt: now });
  });
  markChanged();
}

export async function updatePageDoc(id: string, fn: (doc: JSONContent) => JSONContent): Promise<void> {
  const page = await db.pages.get(id);
  if (!page) return;
  await savePageDoc(id, fn(page.doc), true);
}

export async function renamePage(id: string, title: string): Promise<void> {
  const page = await db.pages.get(id);
  if (!page || page.title === title) return;
  await db.pages.update(id, { title, titleAuto: false, updatedAt: Date.now() });
  markChanged();
}

export async function getMainChat(rootId: string): Promise<Chat | undefined> {
  const chats = await db.chats.where('pageId').equals(rootId).toArray();
  return chats.find((c) => c.kind === 'main' && !c.deletedAt);
}

export async function trashStory(rootId: string): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', db.pages, db.chats, async () => {
    await db.pages.update(rootId, { deletedAt: now });
    const chapters = await db.pages.where('parentId').equals(rootId).toArray();
    for (const c of chapters) if (!c.deletedAt) await db.pages.update(c.id, { deletedAt: now });
    const chats = await db.chats.where('pageId').equals(rootId).toArray();
    for (const c of chats) if (!c.deletedAt) await db.chats.update(c.id, { deletedAt: now });
  });
  markChanged();
}

export async function trashChapter(id: string): Promise<void> {
  await db.pages.update(id, { deletedAt: Date.now() });
  markChanged();
}

export async function trashChat(id: string): Promise<void> {
  await db.chats.update(id, { deletedAt: Date.now() });
  markChanged();
}

export async function restorePage(id: string): Promise<void> {
  const page = await db.pages.get(id);
  if (!page) return;
  await db.transaction('rw', db.pages, db.chats, async () => {
    if (page.parentId) {
      await db.pages.update(id, { deletedAt: null });
      const root = await db.pages.get(page.parentId);
      if (root?.deletedAt) await db.pages.update(root.id, { deletedAt: null });
      return;
    }
    // Pulihkan cerita beserta bab dan chat yang terhapus bersamaan.
    const at = page.deletedAt;
    await db.pages.update(id, { deletedAt: null });
    const chapters = await db.pages.where('parentId').equals(id).toArray();
    for (const c of chapters) if (c.deletedAt === at) await db.pages.update(c.id, { deletedAt: null });
    const chats = await db.chats.where('pageId').equals(id).toArray();
    for (const c of chats) if (c.deletedAt === at) await db.chats.update(c.id, { deletedAt: null });
  });
  markChanged();
}

export async function restoreChat(id: string): Promise<void> {
  const chat = await db.chats.get(id);
  if (!chat) return;
  if (chat.pageId) {
    const root = await db.pages.get(chat.pageId);
    if (root?.deletedAt) return restorePage(root.id);
  }
  await db.chats.update(id, { deletedAt: null });
  markChanged();
}

async function deleteChatHard(chatId: string): Promise<void> {
  const msgs = await db.messages.where('chatId').equals(chatId).toArray();
  const attIds = msgs.flatMap((m) => m.attachmentIds);
  await db.attachments.bulkDelete(attIds);
  await db.messages.bulkDelete(msgs.map((m) => m.id));
  await db.chats.delete(chatId);
}

export async function deletePageHard(id: string): Promise<void> {
  await db.transaction('rw', [db.pages, db.chats, db.messages, db.attachments, db.usage], async () => {
    const page = await db.pages.get(id);
    if (!page) return;
    if (!page.parentId) {
      await db.usage.where('rootId').equals(id).delete();
      const chapters = await db.pages.where('parentId').equals(id).toArray();
      await db.pages.bulkDelete(chapters.map((c) => c.id));
      const chats = await db.chats.where('pageId').equals(id).toArray();
      for (const c of chats) await deleteChatHard(c.id);
    }
    await db.pages.delete(id);
  });
}

export async function deleteChatPermanently(id: string): Promise<void> {
  await db.transaction('rw', db.chats, db.messages, db.attachments, () => deleteChatHard(id));
}

export async function purgeTrash(): Promise<void> {
  const limit = Date.now() - TRASH_DAYS * 86400_000;
  const pages = await db.pages.filter((p) => !!p.deletedAt && p.deletedAt < limit).toArray();
  for (const p of pages) await deletePageHard(p.id);
  const chats = await db.chats.filter((c) => !!c.deletedAt && c.deletedAt < limit).toArray();
  for (const c of chats) await deleteChatPermanently(c.id);
}

export async function moveChapter(id: string, dir: -1 | 1): Promise<void> {
  const page = await db.pages.get(id);
  if (!page?.parentId) return;
  const list = await getChapters(page.parentId);
  const i = list.findIndex((p) => p.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  const a = list[i];
  const b = list[j];
  await db.transaction('rw', db.pages, async () => {
    await db.pages.update(a.id, { order: b.order });
    await db.pages.update(b.id, { order: a.order });
  });
  markChanged();
}

/** Salin cerita beserta bab, chat utama, pesan, dan lampiran. */
export async function duplicateStory(rootId: string): Promise<Page | null> {
  const pages = await getStoryPages(rootId);
  if (!pages.length) return null;
  const chats = (await db.chats.where('pageId').equals(rootId).toArray()).filter((c) => !c.deletedAt);
  const now = Date.now();
  const segMap = new Map<string, string>();
  const pageMap = new Map<string, string>();
  pages.forEach((p) => pageMap.set(p.id, uid()));

  const newChats: Chat[] = [];
  const newMsgs: Message[] = [];
  const newAtts: Attachment[] = [];
  for (const c of chats) {
    const chatId = uid();
    newChats.push({ ...c, id: chatId, pageId: pageMap.get(rootId)!, createdAt: now, updatedAt: now });
    const msgs = await db.messages.where('chatId').equals(c.id).toArray();
    for (const m of msgs) {
      const id = uid();
      segMap.set(m.id, id);
      const attIds: string[] = [];
      for (const aid of m.attachmentIds) {
        const a = await db.attachments.get(aid);
        if (!a) continue;
        const nid = uid();
        newAtts.push({ ...a, id: nid });
        attIds.push(nid);
      }
      newMsgs.push({
        ...m,
        id,
        chatId,
        attachmentIds: attIds,
        targetPageId: m.targetPageId ? (pageMap.get(m.targetPageId) ?? null) : null,
        createdPageId: m.createdPageId ? (pageMap.get(m.createdPageId) ?? null) : null,
      });
    }
  }
  const newPages = pages.map((p) => ({
    ...p,
    id: pageMap.get(p.id)!,
    parentId: p.parentId ? pageMap.get(p.parentId)! : null,
    title: p.parentId ? p.title : `${p.title || 'Tanpa judul'} (salinan)`,
    doc: remapSegments(p.doc, segMap),
    pinned: false,
    createdAt: now,
    updatedAt: now,
    openedAt: now,
    extRev: 0,
  }));
  await db.transaction('rw', db.pages, db.chats, db.messages, db.attachments, async () => {
    await db.pages.bulkAdd(newPages);
    await db.chats.bulkAdd(newChats);
    await db.messages.bulkAdd(newMsgs);
    await db.attachments.bulkAdd(newAtts);
  });
  markChanged();
  return newPages[0];
}

export function pageMarkdown(page: Page, withTitle: boolean): string {
  const body = serializeBlocks(docBlocks(page.doc));
  return withTitle ? `# ${page.title || 'Tanpa judul'}\n\n${body}` : body;
}

export async function storyMarkdown(rootId: string): Promise<string> {
  const pages = await getStoryPages(rootId);
  if (!pages.length) return '';
  const [root, ...chapters] = pages;
  const parts = [`# ${root.title || 'Tanpa judul'}`, serializeBlocks(docBlocks(root.doc))];
  for (const c of chapters) parts.push(`## ${c.title}`, serializeBlocks(docBlocks(c.doc)));
  return parts.filter((s) => s.trim()).join('\n\n');
}

export function displayTitle(page: Pick<Page, 'title'> | undefined): string {
  return page?.title?.trim() || 'Tanpa judul';
}
