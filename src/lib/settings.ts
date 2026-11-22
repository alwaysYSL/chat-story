import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ModelId } from '../db';

export type Creativity = 'stable' | 'normal' | 'wild';

export interface Settings {
  apiKey: string;
  onboarded: boolean;
  model: ModelId;
  thinking: boolean;
  creativity: Creativity;
  openingMin: number;
  openingMax: number;
  contMin: number;
  contMax: number;
  shortWords: number;
  longWords: number;
  chapterThreshold: number;
  usdToIdr: number;
  peakWarning: boolean;
  fontSize: number;
  lineHeight: number;
  serif: boolean;
  segMarker: boolean;
  lastBackupAt: number;
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  onboarded: false,
  model: 'deepseek-flash',
  thinking: false,
  creativity: 'normal',
  openingMin: 2000,
  openingMax: 3000,
  contMin: 500,
  contMax: 700,
  shortWords: 300,
  longWords: 1000,
  chapterThreshold: 5000,
  usdToIdr: 16500,
  peakWarning: true,
  fontSize: 17,
  lineHeight: 1.7,
  serif: false,
  segMarker: false,
  lastBackupAt: 0,
};

/** Temperature per tingkat kreativitas. DeepSeek merekomendasikan 1.5 untuk penulisan kreatif. */
export const TEMPERATURE: Record<Creativity, number> = {
  stable: 1.2,
  normal: 1.5,
  wild: 1.7,
};

export const CREATIVITY_LABEL: Record<Creativity, string> = {
  stable: 'Stabil',
  normal: 'Normal',
  wild: 'Liar',
};

export async function getSettings(): Promise<Settings> {
  const row = await db.kv.get('settings');
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings>) ?? {}) };
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  await db.transaction('rw', db.kv, async () => {
    const cur = await getSettings();
    await db.kv.put({ key: 'settings', value: { ...cur, ...patch } });
  });
}

export function useSettings(): Settings | undefined {
  return useLiveQuery(getSettings, []);
}

/**
 * Tandai ada perubahan data (untuk pengingat backup).
 * Disimpan di kunci terpisah supaya tidak memicu render ulang semua pengguna useSettings.
 */
export function markChanged() {
  void db.kv.put({ key: 'lastChangeAt', value: Date.now() });
}

export async function getLastChangeAt(): Promise<number> {
  const row = await db.kv.get('lastChangeAt');
  return (row?.value as number) ?? 0;
}
