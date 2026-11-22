/**
 * Penyedia AI yang bisa dipakai. Semua memakai format OpenAI Chat Completions,
 * dengan sedikit perbedaan (cara mematikan thinking, cek saldo, lanjutan prefix).
 */

export type ProviderKind = 'deepseek' | 'vikey' | 'poolside' | 'openrouter' | 'custom';

/** Cara menyalakan/mematikan mode berpikir untuk model ini. */
export type ThinkingStyle = 'deepseek' | 'poolside' | 'openrouter' | 'none';

export interface ModelPrice {
  /** harga per 1 juta token */
  in: number;
  cache: number;
  out: number;
}

export interface ModelConfig {
  id: string;
  label: string;
  vision: boolean;
  thinking: ThinkingStyle;
  currency: 'USD' | 'IDR';
  price: ModelPrice;
}

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: ModelConfig[];
}

export interface ModelRef {
  provider: string;
  model: string;
}

export interface ProviderInfo {
  /** halaman untuk membuat API key */
  keyUrl: string;
  /** endpoint cek saldo (khusus DeepSeek) */
  balance: boolean;
  /** Chat Prefix Completion untuk "Lanjutkan dari sini" (khusus DeepSeek) */
  prefix: boolean;
  /** harga 2× di jam peak (khusus DeepSeek) */
  peak: boolean;
  note: string;
}

export const PROVIDER_INFO: Record<ProviderKind, ProviderInfo> = {
  deepseek: {
    keyUrl: 'https://platform.deepseek.com/api_keys',
    balance: true,
    prefix: true,
    peak: true,
    note: 'Langsung dari DeepSeek. Cache paling murah, cocok untuk cerita panjang.',
  },
  vikey: {
    keyUrl: 'https://app.vikey.ai/dashboard',
    balance: false,
    prefix: false,
    peak: false,
    note: 'Bayar pakai QRIS dalam Rupiah. Banyak model (DeepSeek, Claude, GPT, dan lainnya). Saldo dicek di dashboard Vikey.',
  },
  poolside: {
    keyUrl: 'https://platform.poolside.ai/',
    balance: false,
    prefix: false,
    peak: false,
    note: 'Model Laguna dari Poolside. Dirancang untuk coding, hanya teks (tidak bisa membaca gambar). Harga isi sendiri kalau ingin biaya tampil.',
  },
  openrouter: {
    keyUrl: 'https://openrouter.ai/keys',
    balance: false,
    prefix: false,
    peak: false,
    note: 'Ratusan model dari banyak penyedia, termasuk model gratis. Tambahkan model id dari openrouter.ai/models.',
  },
  custom: {
    keyUrl: '',
    balance: false,
    prefix: false,
    peak: false,
    note: 'Penyedia lain yang kompatibel dengan format OpenAI. Isi base URL (biasanya berakhiran /v1) dan model id.',
  },
};

const DS = (id: string, label: string, vision: boolean, price: ModelPrice): ModelConfig => ({
  id,
  label,
  vision,
  thinking: 'deepseek',
  currency: 'USD',
  price,
});

/**
 * Model bawaan. Harga DeepSeek dari api-docs.deepseek.com (off-peak, USD).
 * Harga Vikey dari vikey.ai/pricing (Rupiah), diambil November 2026.
 * Harga Poolside belum dipublikasikan untuk API, jadi dibiarkan 0 (biaya tidak ditampilkan).
 */
export function presetProviders(): ProviderConfig[] {
  return [
    {
      id: 'deepseek',
      kind: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: '',
      models: [
        DS('deepseek-flash', 'DeepSeek Flash', true, { in: 0.15, cache: 0.003, out: 0.6 }),
        DS('deepseek-v4-pro', 'DeepSeek Pro', false, { in: 0.66, cache: 0.022, out: 1.98 }),
      ],
    },
    {
      id: 'vikey',
      kind: 'vikey',
      name: 'Vikey',
      baseUrl: 'https://api.vikey.ai/v1',
      apiKey: '',
      models: [
        { ...DS('deepseek/deepseek-v4.1-flash', 'DeepSeek V4.1 Flash', true, { in: 1350, cache: 630, out: 5400 }), currency: 'IDR' },
        { ...DS('deepseek/deepseek-v4-flash', 'DeepSeek V4 Flash', false, { in: 1080, cache: 270, out: 1800 }), currency: 'IDR' },
        { ...DS('deepseek/deepseek-v4-pro', 'DeepSeek V4 Pro', false, { in: 1800, cache: 360, out: 3600 }), currency: 'IDR' },
      ],
    },
    {
      id: 'poolside',
      kind: 'poolside',
      name: 'Poolside',
      baseUrl: 'https://inference.poolside.ai/v1',
      apiKey: '',
      models: [
        {
          id: 'poolside/laguna-s-2.1',
          label: 'Laguna S 2.1',
          vision: false,
          thinking: 'poolside',
          currency: 'USD',
          price: { in: 0, cache: 0, out: 0 },
        },
      ],
    },
    {
      id: 'openrouter',
      kind: 'openrouter',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: '',
      models: [
        {
          id: 'poolside/laguna-s-2.1:free',
          label: 'Laguna S 2.1 (gratis)',
          vision: false,
          thinking: 'openrouter',
          currency: 'USD',
          price: { in: 0, cache: 0, out: 0 },
        },
      ],
    },
  ];
}

export function newCustomProvider(id: string): ProviderConfig {
  return { id, kind: 'custom', name: 'Penyedia lain', baseUrl: 'https://', apiKey: '', models: [] };
}

export function defaultThinkingStyle(kind: ProviderKind): ThinkingStyle {
  return kind === 'deepseek' || kind === 'vikey'
    ? 'deepseek'
    : kind === 'poolside'
      ? 'poolside'
      : kind === 'openrouter'
        ? 'openrouter'
        : 'none';
}

export function hasPrice(m: ModelConfig): boolean {
  return m.price.in > 0 || m.price.out > 0 || m.price.cache > 0;
}

export function findModel(
  providers: ProviderConfig[],
  ref: ModelRef | null | undefined,
): { provider: ProviderConfig; model: ModelConfig } | null {
  if (!ref) return null;
  const provider = providers.find((p) => p.id === ref.provider);
  const model = provider?.models.find((m) => m.id === ref.model);
  return provider && model ? { provider, model } : null;
}

/** Semua model dari penyedia yang sudah diisi API key-nya. */
export function usableModels(providers: ProviderConfig[]): { provider: ProviderConfig; model: ModelConfig }[] {
  return providers.filter((p) => p.apiKey.trim()).flatMap((p) => p.models.map((model) => ({ provider: p, model })));
}

export function chatUrl(p: ProviderConfig, prefix = false): string {
  const base = p.baseUrl.replace(/\/+$/, '');
  if (p.kind === 'deepseek') return `${base}${prefix ? '/beta' : ''}/chat/completions`;
  return `${base}/chat/completions`;
}

export function isValidBaseUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !!u.hostname;
  } catch {
    return false;
  }
}
