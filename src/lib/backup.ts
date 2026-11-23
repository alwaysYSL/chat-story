import { db, SCHEMA_VERSION, type Attachment, type Chat, type Message, type Page } from '../db';
import { getSettings, markChanged, updateSettings, type Settings } from './settings';
import { mergeProviderLists } from './providers';
import { blobToDataUrl, dataUrlToBlob } from './util';

interface BackupFile {
  app: 'chat-story';
  schema: number;
  exportedAt: number;
  pages: Page[];
  chats: Chat[];
  messages: Message[];
  attachments: (Omit<Attachment, 'blob'> & { blob: string | null })[];
  settings: Partial<Settings>;
}

export interface DataSet {
  pages: Page[];
  chats: Chat[];
  messages: Message[];
  attachments: Attachment[];
  settings: Settings;
}

export async function readAllData(): Promise<DataSet> {
  const [pages, chats, messages, attachments, settings] = await Promise.all([
    db.pages.toArray(),
    db.chats.toArray(),
    db.messages.toArray(),
    db.attachments.toArray(),
    getSettings(),
  ]);
  return { pages, chats, messages, attachments, settings };
}

/**
 * Susun file backup per bagian (tidak sebagai satu string raksasa), supaya perpustakaan besar
 * tidak menghabiskan memori HP. API key sengaja tidak ikut.
 */
export async function dataToBackupBlob(d: DataSet, exportedAt = Date.now()): Promise<Blob> {
  const safeSettings: Partial<Settings> = {
    ...d.settings,
    providers: d.settings.providers.map((p) => ({ ...p, apiKey: '' })),
  };
  const parts: BlobPart[] = [
    `{"app":"chat-story","schema":${SCHEMA_VERSION},"exportedAt":${exportedAt},`,
    `"settings":${JSON.stringify(safeSettings)},`,
    `"pages":${JSON.stringify(d.pages)},`,
    `"chats":${JSON.stringify(d.chats)},`,
    `"messages":${JSON.stringify(d.messages)},`,
    '"attachments":[',
  ];
  for (let i = 0; i < d.attachments.length; i++) {
    const a = d.attachments[i];
    const blob = a.blob ? await blobToDataUrl(a.blob) : null;
    parts.push((i ? ',' : '') + JSON.stringify({ ...a, blob }));
  }
  parts.push(']}');
  return new Blob(parts, { type: 'application/json' });
}

export async function createBackup(): Promise<{ blob: Blob; at: number }> {
  const at = Date.now();
  return { blob: await dataToBackupBlob(await readAllData(), at), at };
}

export function backupFileName(prefix = 'chat-story-backup'): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

/** Waktu data yang dibackup (saat backup mulai dibuat), bukan saat file selesai dibagikan. */
export async function markBackedUp(at: number) {
  await updateSettings({ lastBackupAt: at });
}

export interface RestoreSummary {
  pages: number;
  chats: number;
  /** jumlah item lokal yang dipertahankan karena lebih baru dari backup (mode gabungkan) */
  keptNewer: number;
}

function invalid(): Error {
  return new Error('File ini bukan backup Chat Story yang valid.');
}

export async function readBackupFile(file: File): Promise<BackupFile> {
  let data: BackupFile;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw invalid();
  }
  if (data?.app !== 'chat-story' || !Array.isArray(data.pages)) throw invalid();
  if (data.schema > SCHEMA_VERSION) {
    throw new Error('Backup ini dibuat oleh versi aplikasi yang lebih baru. Perbarui aplikasi dulu.');
  }
  data.chats = Array.isArray(data.chats) ? data.chats : [];
  data.messages = Array.isArray(data.messages) ? data.messages : [];
  data.attachments = Array.isArray(data.attachments) ? data.attachments : [];
  data.settings = data.settings && typeof data.settings === 'object' ? data.settings : {};
  return data;
}

/**
 * Pulihkan backup.
 * - 'merge' (Gabungkan): item yang belum ada ditambahkan; item yang ada di keduanya memakai versi yang
 *   lebih baru, jadi tulisan terbaru di HP ini tidak tertimpa. Pengaturan di HP ini tidak diubah.
 * - 'replace' (Ganti semua): semua data diganti isi backup. Penyedia AI dan API key di HP ini tetap ada.
 * Item yang di backup berada di Sampah mendapat masa 30 hari baru, supaya tidak langsung terhapus permanen.
 */
export async function restoreBackup(file: File, mode: 'merge' | 'replace'): Promise<RestoreSummary> {
  const data = await readBackupFile(file);
  const now = Date.now();
  const attachments: Attachment[] = [];
  for (const a of data.attachments) {
    attachments.push({ ...a, blob: a.blob ? await dataUrlToBlob(a.blob) : null });
  }
  const freshTrash = <T extends { deletedAt: number | null }>(x: T): T => (x.deletedAt ? { ...x, deletedAt: now } : x);
  const pages = data.pages.map((p) => freshTrash({ ...p, extRev: (p.extRev ?? 0) + 1 }));
  const chats = data.chats.map(freshTrash);
  let keptNewer = 0;

  await db.transaction('rw', [db.pages, db.chats, db.messages, db.attachments, db.kv], async () => {
    if (mode === 'replace') {
      await Promise.all([db.pages.clear(), db.chats.clear(), db.messages.clear(), db.attachments.clear()]);
      await db.pages.bulkPut(pages);
      await db.chats.bulkPut(chats);
      await db.messages.bulkPut(data.messages);
      await db.attachments.bulkPut(attachments);
      const cur = await getSettings();
      const backup = data.settings as Partial<Settings> & { apiKey?: string };
      const { apiKey: _k, providers: bProviders, ...rest } = backup;
      void _k;
      const restored: Settings = {
        ...cur,
        ...rest,
        onboarded: true,
        // Penyedia di HP ini (beserta API key) dipertahankan; penyedia tambahan dari backup ikut masuk.
        providers: mergeProviderLists(cur.providers, bProviders ?? []),
        lastBackupAt: Math.max(cur.lastBackupAt, data.exportedAt ?? 0),
      };
      await db.kv.put({ key: 'settings', value: restored });
      return;
    }

    // Gabungkan: pakai yang lebih baru.
    const localPages = new Map((await db.pages.toArray()).map((p) => [p.id, p]));
    const localChats = new Map((await db.chats.toArray()).map((c) => [c.id, c]));
    const pagesToPut = pages.filter((p) => {
      const l = localPages.get(p.id);
      if (l && l.updatedAt >= p.updatedAt) {
        keptNewer++;
        return false;
      }
      return true;
    });
    const takeChat = new Set<string>();
    const chatsToPut = chats.filter((c) => {
      const l = localChats.get(c.id);
      if (l && l.updatedAt >= c.updatedAt) {
        keptNewer++;
        return false;
      }
      takeChat.add(c.id);
      return true;
    });
    const localMsgIds = new Set((await db.messages.toCollection().primaryKeys()) as string[]);
    // Pesan: ambil dari backup kalau chat-nya diambil dari backup, atau pesannya belum ada di HP ini.
    const msgsToPut = data.messages.filter((m) => takeChat.has(m.chatId) || !localMsgIds.has(m.id));
    const localAttIds = new Set((await db.attachments.toCollection().primaryKeys()) as string[]);
    const attsToPut = attachments.filter((a) => !localAttIds.has(a.id));
    await db.pages.bulkPut(pagesToPut);
    await db.chats.bulkPut(chatsToPut);
    await db.messages.bulkPut(msgsToPut);
    await db.attachments.bulkPut(attsToPut);
  });
  markChanged();
  return { pages: data.pages.length, chats: data.chats.length, keptNewer };
}
