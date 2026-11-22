import type { ModelId, Usage } from '../db';

/**
 * Harga resmi DeepSeek per 1 juta token, tarif off-peak (USD).
 * Sumber: https://api-docs.deepseek.com/quick_start/pricing (diambil November 2026).
 * Jam peak = 2× harga ini.
 */
export const PRICES: Record<ModelId, { hit: number; miss: number; out: number }> = {
  'deepseek-flash': { hit: 0.003, miss: 0.15, out: 0.6 },
  'deepseek-v4-pro': { hit: 0.022, miss: 0.66, out: 1.98 },
};

export const MODEL_LABEL: Record<ModelId, string> = {
  'deepseek-flash': 'Flash',
  'deepseek-v4-pro': 'Pro',
};

/**
 * Jam peak: 01:00–04:00 dan 06:00–10:00 UTC, Senin–Jumat
 * (= 08:00–11:00 dan 13:00–17:00 WIB). Hari libur Tiongkok tidak dihitung.
 */
export function isPeak(date = new Date()): boolean {
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  const h = date.getUTCHours();
  return (h >= 1 && h < 4) || (h >= 6 && h < 10);
}

export function costUsd(model: ModelId, usage: Usage, peak: boolean): number {
  const p = PRICES[model];
  const base = (usage.hit * p.hit + usage.miss * p.miss + usage.out * p.out) / 1_000_000;
  return peak ? base * 2 : base;
}
