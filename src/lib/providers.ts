/**
 * Penyedia AI yang bisa dipakai. Semua memakai format OpenAI Chat Completions,
 * dengan sedikit perbedaan (cara mematikan thinking, cek saldo, lanjutan prefix).
 */

export type ProviderKind = 'deepseek' | 'vikey' | 'poolside' | 'openrouter' | 'tokenkoding' | 'custom';

/** Cara menyalakan/mematikan mode berpikir untuk model ini. */
export type ThinkingStyle = 'deepseek' | 'poolside' | 'openrouter' | 'none';

export interface ModelPrice {
  /** harga per 1 juta token */
  in: number;
  cache: number;
  out: number;
  /** tagihan minimum per permintaan (mata uang model), mis. TokenKoding Rp10 */
  min?: number;
}

export interface ModelConfig {
  id: string;
  label: string;
  vision: boolean;
  thinking: ThinkingStyle;
  currency: 'USD' | 'IDR';
  price: ModelPrice;
  /** batas konteks dalam token; 0/undefined = tidak diketahui */
  context?: number;
  /**
   * true = model bawaan aplikasi yang belum diubah pengguna; harga & batasnya ikut diperbarui saat aplikasi update.
   * false = sudah diubah pengguna (atau buatan pengguna).
   */
  preset?: boolean;
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
  /** penyedia mengizinkan aplikasi web (CORS); kalau false hanya bisa dipakai di APK */
  web: boolean;
  note: string;
}

export const PROVIDER_INFO: Record<ProviderKind, ProviderInfo> = {
  deepseek: {
    keyUrl: 'https://platform.deepseek.com/api_keys',
    balance: true,
    prefix: true,
    peak: true,
    web: true,
    note: 'Langsung dari DeepSeek. Cache paling murah, cocok untuk cerita panjang.',
  },
  vikey: {
    keyUrl: 'https://app.vikey.ai/dashboard',
    balance: false,
    prefix: false,
    peak: false,
    web: true,
    note: 'Bayar pakai QRIS dalam Rupiah. Banyak model (DeepSeek, Claude, GPT, dan lainnya). Saldo dicek di dashboard Vikey.',
  },
  poolside: {
    keyUrl: 'https://platform.poolside.ai/',
    balance: false,
    prefix: false,
    peak: false,
    web: true,
    note: 'Model Laguna dari Poolside. Dirancang untuk coding, hanya teks (tidak bisa membaca gambar). Harga isi sendiri kalau ingin biaya tampil.',
  },
  openrouter: {
    keyUrl: 'https://openrouter.ai/keys',
    balance: false,
    prefix: false,
    peak: false,
    web: true,
    note: 'Ratusan model dari banyak penyedia, termasuk model gratis. Tambahkan model id dari openrouter.ai/models.',
  },
  tokenkoding: {
    keyUrl: 'https://tokenkoding.id/dasbor/keys',
    balance: false,
    prefix: false,
    peak: false,
    web: false,
    note: 'Bayar Rupiah lewat QRIS, banyak model open-weight. Tagihan minimal Rp10 per permintaan. Hanya bisa dipakai di aplikasi Android (APK), karena TokenKoding tidak mengizinkan aplikasi web.',
  },
  custom: {
    keyUrl: '',
    balance: false,
    prefix: false,
    peak: false,
    web: true,
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
  context: 1_000_000,
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
          context: 1_000_000,
        },
      ],
    },
    {
      id: 'tokenkoding',
      kind: 'tokenkoding',
      name: 'TokenKoding',
      baseUrl: 'https://api.tokenkoding.id/v1',
      apiKey: '',
      models: [
        {
          ...DS('deepseek-v4.1-flash', 'DeepSeek V4.1 Flash', true, { in: 2000, cache: 54, out: 8000, min: 10 }),
          currency: 'IDR',
          context: 1_048_560,
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
  return kind === 'deepseek' || kind === 'vikey' || kind === 'tokenkoding'
    ? 'deepseek'
    : kind === 'poolside'
      ? 'poolside'
      : kind === 'openrouter'
        ? 'openrouter'
        : 'none';
}

export function hasPrice(m: ModelConfig): boolean {
  return m.price.in > 0 || m.price.out > 0 || m.price.cache > 0 || (m.price.min ?? 0) > 0;
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

export function presetKey(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

const SYNC_FIELDS = ['label', 'vision', 'thinking', 'currency', 'price', 'context'] as const;

function sameSettings(a: ModelConfig, b: ModelConfig): boolean {
  return SYNC_FIELDS.every((k) => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null));
}

/**
 * Selaraskan daftar penyedia tersimpan dengan bawaan aplikasi versi ini:
 * - penyedia bawaan yang belum ada ditambahkan;
 * - model bawaan yang belum ada ditambahkan, kecuali yang pernah dihapus pengguna (`removed`);
 * - model bawaan yang belum diubah pengguna diperbarui (harga, batas konteks, kemampuan).
 * API key, base URL, dan model buatan pengguna tidak pernah disentuh.
 */
export function withPresetDefaults(providers: ProviderConfig[], removed: string[] = []): ProviderConfig[] {
  const removedSet = new Set(removed);
  const presets = presetProviders();
  const used = new Set<string>();
  const out = providers.map((p) => {
    let pre = presets.find((x) => x.id === p.id);
    // Penyedia yang dulu ditambahkan sendiri dengan alamat yang sama kini menjadi penyedia bawaan.
    // Id-nya tetap (pesan lama merujuk id itu); jenis dan model bawaan diambil dari preset.
    let adopted = false;
    if (!pre && (p.kind === 'custom' || presets.some((x) => x.kind === p.kind))) {
      pre = presets.find(
        (x) =>
          !providers.some((y) => y.id === x.id) &&
          !used.has(x.id) &&
          (p.kind === 'custom' || p.kind === x.kind) &&
          hostOf(x.baseUrl) === hostOf(p.baseUrl),
      );
      adopted = !!pre;
    }
    if (!pre) return p;
    used.add(pre.id);
    const models = p.models.map((m) => {
      const pm = pre!.models.find((x) => x.id === m.id);
      if (!pm) return m;
      // Data lama tanpa penanda: dianggap bawaan kalau harganya masih sama dengan harga bawaan
      // (atau belum diisi sama sekali, untuk penyedia yang dulu ditambahkan sendiri).
      const unpriced = !hasPrice(m);
      const isPreset = adopted ? unpriced || m.preset === true : (m.preset ?? JSON.stringify(m.price) === JSON.stringify(pm.price));
      if (!isPreset) {
        return { ...m, preset: false, context: m.context ?? pm.context, price: { ...m.price, min: m.price.min ?? pm.price.min } };
      }
      return { ...m, ...Object.fromEntries(SYNC_FIELDS.map((k) => [k, pm[k]])), preset: true } as ModelConfig;
    });
    for (const pm of pre.models) {
      if (!models.some((m) => m.id === pm.id) && !removedSet.has(presetKey(p.id, pm.id))) models.push({ ...pm, preset: true });
    }
    return { ...p, kind: pre.kind, models };
  });
  for (const pre of presets) {
    if (!used.has(pre.id) && !out.some((p) => p.id === pre.id)) out.push({ ...pre, models: pre.models.map((m) => ({ ...m, preset: true })) });
  }
  return out;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Tandai model sebagai diubah pengguna kalau pengaturannya berbeda dari bawaan. */
export function markEdited(providerId: string, m: ModelConfig): ModelConfig {
  const pm = presetProviders()
    .find((p) => p.id === providerId)
    ?.models.find((x) => x.id === m.id);
  return { ...m, preset: !!pm && sameSettings(m, pm) };
}

/**
 * Gabungkan penyedia di HP ini dengan penyedia dari backup: yang di HP ini tetap (beserta API key),
 * penyedia yang hanya ada di backup ditambahkan tanpa API key.
 */
export function mergeProviderLists(local: ProviderConfig[], fromBackup: ProviderConfig[]): ProviderConfig[] {
  const out = [...local];
  for (const b of fromBackup) {
    if (!b || typeof b.id !== 'string' || out.some((p) => p.id === b.id)) continue;
    out.push({ ...b, apiKey: '' });
  }
  return out;
}

/** Perkiraan kasar jumlah token dari teks (bahasa Indonesia ±3,5 karakter per token). */
export function estimateTokens(chars: number, images = 0): number {
  return Math.round(chars / 3.5) + images * 1024;
}
