import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { presetProviders, withPresetDefaults, type ModelConfig, type ModelRef, type ProviderConfig } from './providers';

export type Creativity = 'stable' | 'normal' | 'wild';

export interface Settings {
  providers: ProviderConfig[];
  defaultModel: ModelRef;
  onboarded: boolean;
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
  /** model bawaan yang dihapus pengguna (`provider::model`), supaya tidak muncul lagi saat update */
  removedPresets: string[];
}

const DEFAULT_SETTINGS: Omit<Settings, 'providers'> = {
  defaultModel: { provider: 'deepseek', model: 'deepseek-flash' },
  onboarded: false,
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
  removedPresets: [],
};

/**
 * Temperature per tingkat kreativitas. DeepSeek merekomendasikan 1.5 untuk penulisan kreatif;
 * model lain (Claude, GPT, Laguna) memakai skala lebih rendah, dan sebagian menolak nilai di atas 1.
 */
export function temperatureFor(model: ModelConfig, c: Creativity): number {
  const deepseek = /deepseek/i.test(model.id);
  const scale: Record<Creativity, number> = deepseek
    ? { stable: 1.2, normal: 1.5, wild: 1.7 }
    : { stable: 0.6, normal: 0.85, wild: 1.0 };
  return scale[c];
}

export const CREATIVITY_LABEL: Record<Creativity, string> = {
  stable: 'Stabil',
  normal: 'Normal',
  wild: 'Liar',
};

type StoredSettings = Partial<Settings> & { apiKey?: string; model?: string };

export async function getSettings(): Promise<Settings> {
  const row = await db.kv.get('settings');
  const raw = (row?.value as StoredSettings) ?? {};
  const { apiKey: legacyKey, model: legacyModel, ...rest } = raw;
  const merged: Settings = { ...DEFAULT_SETTINGS, providers: presetProviders(), ...rest };
  if (!raw.providers) {
    // Data versi pertama: satu API key DeepSeek dan satu pilihan model.
    merged.providers = presetProviders().map((p) => (p.id === 'deepseek' ? { ...p, apiKey: legacyKey ?? '' } : p));
    if (legacyModel) merged.defaultModel = { provider: 'deepseek', model: legacyModel };
  }
  merged.providers = withPresetDefaults(merged.providers, merged.removedPresets);
  return merged;
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  await db.transaction('rw', db.kv, async () => {
    const cur = await getSettings();
    await db.kv.put({ key: 'settings', value: { ...cur, ...patch } satisfies Settings });
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

export async function updateProvider(id: string, fn: (p: ProviderConfig) => ProviderConfig | null): Promise<void> {
  await db.transaction('rw', db.kv, async () => {
    const cur = await getSettings();
    const providers = cur.providers.flatMap((p) => {
      if (p.id !== id) return [p];
      const next = fn(p);
      return next ? [next] : [];
    });
    await db.kv.put({ key: 'settings', value: { ...cur, providers } satisfies Settings });
  });
}

export function hasAnyKey(s: Settings): boolean {
  return s.providers.some((p) => p.apiKey.trim() && p.models.length);
}
