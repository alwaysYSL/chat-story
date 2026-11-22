import { db, SCHEMA_VERSION, type Attachment, type Chat, type Message, type Page } from '../db';
import { getSettings, updateSettings, type Settings } from './settings';
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

export async function createBackup(): Promise<Blob> {
  const [pages, chats, messages, atts, settings] = await Promise.all([
    db.pages.toArray(),
    db.chats.toArray(),
    db.messages.toArray(),
    db.attachments.toArray(),
    getSettings(),
  ]);
  const attachments = await Promise.all(
    atts.map(async (a) => ({ ...a, blob: a.blob ? await blobToDataUrl(a.blob) : null })),
  );
  // API key sengaja tidak ikut dibackup.
  const { apiKey: _omit, ...safeSettings } = settings;
  void _omit;
  const file: BackupFile = {
    app: 'chat-story',
    schema: SCHEMA_VERSION,
    exportedAt: Date.now(),
    pages,
    chats,
    messages,
    attachments,
    settings: safeSettings,
  };
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

export function backupFileName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `chat-story-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

export async function markBackedUp() {
  await updateSettings({ lastBackupAt: Date.now() });
}

export interface RestoreSummary {
  pages: number;
  chats: number;
}

export async function restoreBackup(file: File, mode: 'merge' | 'replace'): Promise<RestoreSummary> {
  let data: BackupFile;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('File ini bukan backup Chat Story yang valid.');
  }
  if (data?.app !== 'chat-story' || !Array.isArray(data.pages)) {
    throw new Error('File ini bukan backup Chat Story yang valid.');
  }
  if (data.schema > SCHEMA_VERSION) {
    throw new Error('Backup ini dibuat oleh versi aplikasi yang lebih baru. Perbarui aplikasi dulu.');
  }
  const attachments: Attachment[] = await Promise.all(
    data.attachments.map(async (a) => ({ ...a, blob: a.blob ? await dataUrlToBlob(a.blob) : null })),
  );
  const keepKey = (await getSettings()).apiKey;
  await db.transaction('rw', [db.pages, db.chats, db.messages, db.attachments, db.kv], async () => {
    if (mode === 'replace') {
      await Promise.all([db.pages.clear(), db.chats.clear(), db.messages.clear(), db.attachments.clear()]);
    }
    await db.pages.bulkPut(data.pages.map((p) => ({ ...p, extRev: (p.extRev ?? 0) + 1 })));
    await db.chats.bulkPut(data.chats);
    await db.messages.bulkPut(data.messages);
    await db.attachments.bulkPut(attachments);
    if (mode === 'replace') {
      const cur = await getSettings();
      await db.kv.put({ key: 'settings', value: { ...cur, ...data.settings, apiKey: keepKey, onboarded: true } });
    }
  });
  return { pages: data.pages.length, chats: data.chats.length };
}
