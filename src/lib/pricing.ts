import type { Usage } from '../db';
import { hasPrice, PROVIDER_INFO, type ModelConfig, type ProviderConfig } from './providers';

/**
 * Jam peak DeepSeek: 01:00–04:00 dan 06:00–10:00 UTC, Senin–Jumat
 * (= 08:00–11:00 dan 13:00–17:00 WIB). Hari libur Tiongkok tidak dihitung.
 */
export function isPeak(date = new Date()): boolean {
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  const h = date.getUTCHours();
  return (h >= 1 && h < 4) || (h >= 6 && h < 10);
}

/** Biaya dalam USD (harga Rupiah dikonversi dengan kurs di Pengaturan). null = harga model tidak diketahui. */
export function costUsd(
  provider: ProviderConfig,
  model: ModelConfig,
  usage: Usage,
  peak: boolean,
  usdToIdr: number,
): number | null {
  if (!hasPrice(model)) return null;
  const p = model.price;
  let cost = (usage.hit * p.cache + usage.miss * p.in + usage.out * p.out) / 1_000_000;
  if (model.currency === 'IDR') cost = cost / usdToIdr;
  if (peak && PROVIDER_INFO[provider.kind].peak) cost *= 2;
  return cost;
}

export function formatPrice(model: ModelConfig): string {
  if (!hasPrice(model)) return 'harga belum diisi';
  const f = (n: number) => (model.currency === 'IDR' ? 'Rp' + n.toLocaleString('id-ID') : '$' + n);
  return `${f(model.price.in)} / ${f(model.price.cache)} / ${f(model.price.out)} per 1 juta token (input / cache / output)`;
}
