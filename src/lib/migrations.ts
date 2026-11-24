import { db } from '../db';
import { dataToBackupBlob, readAllData, type DataSet } from './backup';
import { updateSettings } from './settings';

/**
 * Versi format data aplikasi. Naikkan setiap kali ada pembaruan yang mengubah data tersimpan,
 * lalu tambahkan langkahnya di `runMigrations`. Sebelum langkah apa pun dijalankan, seluruh data
 * disalin dulu ke "backup otomatis sebelum pembaruan" (spec §8).
 *
 * 1 = Versi 1 awal (satu API key DeepSeek)
 * 2 = daftar penyedia AI tersimpan, model bawaan ditandai
 * 3 = Versi 2.0.0: TokenKoding bawaan (penyedia TokenKoding buatan sendiri diubah jadi bawaan), biaya minimum
 * 4 = Versi 2.1.0: catatan cerita, ringkasan bab, catatan biaya di luar chat
 * 5 = Versi 3.0.0: roleplay (karakter, persona, lorebook, ringkasan pesan)
 */
export const DATA_VERSION = 5;

const VERSION_KEY = 'dataVersion';
const SNAPSHOT_KEY = 'snapshot:pre-update';

interface Snapshot {
  at: number;
  fromVersion: number;
  appVersion: string;
  data: DataSet;
}

export interface SnapshotInfo {
  at: number;
  fromVersion: number;
  appVersion: string;
}

async function saveSnapshot(fromVersion: number) {
  const data = await readAllData();
  const snap: Snapshot = {
    at: Date.now(),
    fromVersion,
    appVersion: __APP_VERSION__,
    // API key tidak ikut disalin.
    data: { ...data, settings: { ...data.settings, providers: data.settings.providers.map((p) => ({ ...p, apiKey: '' })) } },
  };
  await db.kv.put({ key: SNAPSHOT_KEY, value: snap });
}

let running: Promise<void> | null = null;

export function runMigrations(): Promise<void> {
  running ??= (async () => {
    const row = await db.kv.get(VERSION_KEY);
    let v = row?.value as number | undefined;
    if (v === undefined) {
      const hasData = (await db.pages.count()) > 0 || !!(await db.kv.get('settings'));
      if (!hasData) {
        await db.kv.put({ key: VERSION_KEY, value: DATA_VERSION });
        return;
      }
      v = 1;
    }
    if (v >= DATA_VERSION) return;
    await saveSnapshot(v);
    if (v < 3) {
      // Simpan pengaturan dalam format terbaru: daftar penyedia, model bawaan ditandai, penyedia bawaan baru.
      await updateSettings({});
    }
    await db.kv.put({ key: VERSION_KEY, value: DATA_VERSION });
  })();
  return running;
}

export async function getSnapshotInfo(): Promise<SnapshotInfo | null> {
  const row = await db.kv.get(SNAPSHOT_KEY);
  const s = row?.value as Snapshot | undefined;
  return s ? { at: s.at, fromVersion: s.fromVersion, appVersion: s.appVersion } : null;
}

export async function snapshotBlob(): Promise<Blob | null> {
  const row = await db.kv.get(SNAPSHOT_KEY);
  const s = row?.value as Snapshot | undefined;
  return s ? dataToBackupBlob(s.data, s.at) : null;
}
