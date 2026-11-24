import { backupFileName, createBackup } from './backup';
import { blobToBase64, isNative } from './native';
import { getLastChangeAt, getSettings, updateSettings } from './settings';

/**
 * APK: backup otomatis mingguan ke Documents/ChatStory/otomatis (hanya kalau ada perubahan).
 * File ini tetap ada walaupun data aplikasi dihapus atau aplikasi di-uninstall. 4 file terakhir disimpan.
 */

export const AUTO_DIR = 'ChatStory/otomatis';
export const AUTO_KEEP = 4;
export const AUTO_INTERVAL = 7 * 86400_000;
const PREFIX = 'chat-story-otomatis';

let running = false;

export async function autoBackupDue(): Promise<boolean> {
  if (!isNative()) return false;
  const s = await getSettings();
  if (!s.autoBackup) return false;
  const changed = await getLastChangeAt();
  return Date.now() - s.lastAutoBackupAt >= AUTO_INTERVAL && changed > s.lastAutoBackupAt;
}

/** Jalankan backup otomatis kalau sudah waktunya. Mengembalikan lokasi file, atau null. Gagal = diam (dicoba lagi lain kali). */
export async function maybeAutoBackup(): Promise<string | null> {
  if (running) return null;
  running = true;
  try {
    if (!(await autoBackupDue())) return null;
    return await writeAutoBackup();
  } catch (e) {
    console.warn('Backup otomatis gagal', e);
    return null;
  } finally {
    running = false;
  }
}

export async function writeAutoBackup(): Promise<string> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const { blob, at } = await createBackup();
  const name = backupFileName(PREFIX);
  await Filesystem.writeFile({ path: `${AUTO_DIR}/${name}`, data: await blobToBase64(blob), directory: Directory.Documents, recursive: true });
  await updateSettings({ lastAutoBackupAt: at });
  await prune();
  return `Documents/${AUTO_DIR}/${name}`;
}

async function prune(): Promise<void> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  try {
    const { files } = await Filesystem.readdir({ path: AUTO_DIR, directory: Directory.Documents });
    // Nama file berisi tanggal (YYYYMMDD-HHMM), jadi urutan nama = urutan waktu.
    const ours = files
      .filter((f) => f.type === 'file' && f.name.startsWith(PREFIX) && f.name.endsWith('.json'))
      .map((f) => f.name)
      .sort()
      .reverse();
    for (const n of ours.slice(AUTO_KEEP)) {
      await Filesystem.deleteFile({ path: `${AUTO_DIR}/${n}`, directory: Directory.Documents }).catch(() => {});
    }
  } catch {
    /* folder tidak bisa dibaca: biarkan */
  }
}
