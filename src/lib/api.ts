import type { Usage } from '../db';
import { chatUrl, type ModelConfig, type ProviderConfig } from './providers';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ApiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
  prefix?: boolean;
}

export interface ChatRequest {
  provider: ProviderConfig;
  model: ModelConfig;
  messages: ApiMessage[];
  thinking: boolean;
  temperature: number;
  maxTokens: number;
  /** DeepSeek Chat Prefix Completion (pesan terakhir = awalan jawaban) */
  prefix?: boolean;
}

export interface StreamResult {
  content: string;
  usage: Usage;
  finishReason: string | null;
}

export type ApiErrorKind =
  | 'offline'
  | 'auth'
  | 'balance'
  | 'rate'
  | 'server'
  | 'invalid'
  | 'notfound'
  | 'refused'
  | 'interrupted'
  | 'aborted'
  | 'unknown';

export class ApiError extends Error {
  kind: ApiErrorKind;
  constructor(kind: ApiErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

function errorFromStatus(status: number, detail: string, name: string): ApiError {
  const d = detail ? `: ${detail}` : '.';
  switch (status) {
    case 401:
    case 403:
      return new ApiError('auth', `API key ${name} salah, tidak aktif, atau tidak punya akses${d} Periksa di Pengaturan → Penyedia AI.`);
    case 402:
      return new ApiError('balance', `Saldo ${name} habis atau tidak cukup. Isi ulang saldo di situs ${name}.`);
    case 404:
      return new ApiError('notfound', `Model atau alamat tidak ditemukan di ${name}${d} Periksa model id dan base URL di Pengaturan.`);
    case 429:
      return new ApiError('rate', `Terlalu banyak permintaan ke ${name}. Tunggu sebentar lalu coba lagi.`);
    case 500:
    case 502:
    case 503:
    case 504:
      return new ApiError('server', `Server ${name} sedang sibuk atau bermasalah. Coba lagi sebentar lagi.`);
    case 400:
    case 422:
      return new ApiError('invalid', `Permintaan ditolak ${name}${d}`);
    default:
      return new ApiError('unknown', `Terjadi kesalahan dari ${name} (${status})${d}`);
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      return j?.error?.message ?? j?.message ?? text.slice(0, 200);
    } catch {
      return text.slice(0, 200);
    }
  } catch {
    return '';
  }
}

/** Baca token cache dari berbagai format usage (DeepSeek, OpenAI/OpenRouter, Anthropic). */
function toUsage(u: Record<string, unknown> | null | undefined): Usage {
  if (!u) return { hit: 0, miss: 0, out: 0 };
  const num = (v: unknown) => (typeof v === 'number' ? v : 0);
  const details = (u.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const prompt = num(u.prompt_tokens);
  const hit = num(u.prompt_cache_hit_tokens) || num(details.cached_tokens) || num(u.cache_read_input_tokens);
  const miss = u.prompt_cache_miss_tokens !== undefined ? num(u.prompt_cache_miss_tokens) : Math.max(0, prompt - hit);
  return { hit, miss, out: num(u.completion_tokens) };
}

function thinkingParams(model: ModelConfig, thinking: boolean): Record<string, unknown> {
  switch (model.thinking) {
    case 'deepseek':
      return { thinking: { type: thinking ? 'enabled' : 'disabled' } };
    case 'poolside':
      return { chat_template_kwargs: { enable_thinking: thinking } };
    case 'openrouter':
      return { reasoning: { enabled: thinking } };
    default:
      return {};
  }
}

export function buildBody(req: ChatRequest, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model.id,
    messages: req.messages,
    max_tokens: req.maxTokens,
    ...thinkingParams(req.model, req.thinking),
  };
  if (stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }
  // DeepSeek mengabaikan temperature saat thinking; model lain tetap menerimanya.
  if (!(req.thinking && req.model.thinking === 'deepseek')) body.temperature = req.temperature;
  return body;
}

export async function streamChat(
  req: ChatRequest,
  onDelta: (text: string, kind: 'content' | 'reasoning') => void,
  signal: AbortSignal,
): Promise<StreamResult> {
  const name = req.provider.name;
  if (!navigator.onLine) throw new ApiError('offline', 'Tidak ada koneksi internet.');

  let res: Response;
  try {
    res = await fetch(chatUrl(req.provider, req.prefix), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${req.provider.apiKey.trim()}` },
      body: JSON.stringify(buildBody(req, true)),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new ApiError('aborted', 'Dihentikan.');
    throw new ApiError(
      navigator.onLine ? 'interrupted' : 'offline',
      navigator.onLine
        ? `Tidak bisa terhubung ke ${name}. Periksa koneksi internet dan base URL di Pengaturan.`
        : 'Tidak ada koneksi internet.',
    );
  }
  if (!res.ok || !res.body) throw errorFromStatus(res.status, await readError(res), name);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let content = '';
  let usage: Usage = { hit: 0, miss: 0, out: 0 };
  let finishReason: string | null = null;
  let done = false;

  try {
    while (!done) {
      const r = await reader.read();
      if (r.done) break;
      buf += decoder.decode(r.value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') {
          done = true;
          break;
        }
        let j: {
          choices?: {
            delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null };
            finish_reason?: string | null;
          }[];
          usage?: Record<string, unknown> | null;
          error?: { message?: string };
        };
        try {
          j = JSON.parse(data);
        } catch {
          continue;
        }
        if (j.error) throw new ApiError('unknown', j.error.message ?? `Kesalahan dari ${name}.`);
        const ch = j.choices?.[0];
        const reasoning = ch?.delta?.reasoning_content ?? ch?.delta?.reasoning;
        if (reasoning) onDelta(reasoning, 'reasoning');
        if (ch?.delta?.content) {
          content += ch.delta.content;
          onDelta(ch.delta.content, 'content');
        }
        if (ch?.finish_reason) finishReason = ch.finish_reason;
        if (j.usage) usage = toUsage(j.usage);
      }
    }
  } catch (e) {
    if (e instanceof ApiError) throw Object.assign(e, { partial: content, usage });
    const err =
      (e as Error).name === 'AbortError'
        ? new ApiError('aborted', 'Dihentikan.')
        : new ApiError('interrupted', 'Koneksi terputus saat AI menulis.');
    throw Object.assign(err, { partial: content, usage });
  }

  if (!done && !finishReason) {
    throw Object.assign(new ApiError('interrupted', 'Koneksi terputus saat AI menulis.'), { partial: content, usage });
  }
  if (finishReason === 'content_filter') {
    throw Object.assign(
      new ApiError('refused', `${name} menolak permintaan ini karena pemeriksaan konten. Coba ubah arahan atau lampiran.`),
      { partial: content, usage },
    );
  }
  return { content, usage, finishReason };
}

export interface TestResult {
  ok: true;
  text: string;
}

/**
 * Tes koneksi. DeepSeek: cek saldo (gratis). Penyedia lain: kirim pesan sangat pendek ke model pertama
 * (biayanya sangat kecil), karena tidak semua penyedia mengizinkan endpoint daftar model dari browser.
 */
export async function testProvider(provider: ProviderConfig, model?: ModelConfig): Promise<TestResult> {
  const name = provider.name;
  const key = provider.apiKey.trim();
  if (!key) throw new ApiError('auth', 'Masukkan API key dulu.');
  if (provider.kind === 'deepseek') {
    let res: Response;
    try {
      res = await fetch(`${provider.baseUrl.replace(/\/+$/, '')}/user/balance`, { headers: { Authorization: `Bearer ${key}` } });
    } catch {
      throw new ApiError('offline', `Tidak bisa terhubung ke ${name}. Periksa koneksi internet.`);
    }
    if (!res.ok) throw errorFromStatus(res.status, await readError(res), name);
    const j = (await res.json()) as { is_available: boolean; balance_infos: { currency: string; total_balance: string }[] };
    const bal = j.balance_infos.length
      ? j.balance_infos.map((b) => `${b.currency === 'USD' ? '$' : b.currency + ' '}${b.total_balance}`).join(' · ')
      : '0';
    return { ok: true, text: `Terhubung. Saldo: ${bal}${j.is_available ? '' : ' (tidak cukup)'}` };
  }
  const m = model ?? provider.models[0];
  if (!m) throw new ApiError('invalid', 'Tambahkan minimal satu model dulu.');
  let res: Response;
  try {
    res = await fetch(chatUrl(provider), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(
        buildBody(
          { provider, model: m, messages: [{ role: 'user', content: 'Balas dengan satu kata: halo' }], thinking: false, temperature: 0.5, maxTokens: 16 },
          false,
        ),
      ),
    });
  } catch {
    throw new ApiError(
      'offline',
      `Tidak bisa terhubung ke ${name}. Periksa koneksi internet dan base URL. Sebagian penyedia juga tidak mengizinkan aplikasi web memanggilnya langsung.`,
    );
  }
  if (!res.ok) throw errorFromStatus(res.status, await readError(res), name);
  return { ok: true, text: `Terhubung ke ${name} dengan model ${m.label}. Cek saldo di situs ${name}.` };
}
