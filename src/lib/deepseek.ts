import type { ModelId, Usage } from '../db';

export const API_BASE = 'https://api.deepseek.com';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ApiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
  prefix?: boolean;
}

export interface ChatRequest {
  model: ModelId;
  messages: ApiMessage[];
  thinking: boolean;
  temperature: number;
  maxTokens: number;
  /** pakai endpoint beta untuk Chat Prefix Completion */
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

function errorFromStatus(status: number, detail: string): ApiError {
  switch (status) {
    case 401:
      return new ApiError('auth', 'API key salah atau sudah tidak berlaku. Periksa di Pengaturan.');
    case 402:
      return new ApiError('balance', 'Saldo DeepSeek habis. Isi ulang saldo di platform.deepseek.com.');
    case 429:
      return new ApiError('rate', 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.');
    case 500:
    case 502:
    case 503:
    case 504:
      return new ApiError('server', 'Server DeepSeek sedang sibuk atau bermasalah. Coba lagi sebentar lagi.');
    case 400:
    case 422:
      return new ApiError('invalid', 'Permintaan ditolak DeepSeek' + (detail ? `: ${detail}` : '.'));
    default:
      return new ApiError('unknown', `Terjadi kesalahan (${status})` + (detail ? `: ${detail}` : '.'));
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return j?.error?.message ?? '';
  } catch {
    return '';
  }
}

function toUsage(u: Record<string, number> | null | undefined): Usage {
  if (!u) return { hit: 0, miss: 0, out: 0 };
  const hit = u.prompt_cache_hit_tokens ?? 0;
  const miss = u.prompt_cache_miss_tokens ?? Math.max(0, (u.prompt_tokens ?? 0) - hit);
  return { hit, miss, out: u.completion_tokens ?? 0 };
}

export async function streamChat(
  apiKey: string,
  req: ChatRequest,
  onDelta: (text: string, kind: 'content' | 'reasoning') => void,
  signal: AbortSignal,
): Promise<StreamResult> {
  if (!navigator.onLine) throw new ApiError('offline', 'Tidak ada koneksi internet.');
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    stream: true,
    stream_options: { include_usage: true },
    thinking: { type: req.thinking ? 'enabled' : 'disabled' },
    max_tokens: req.maxTokens,
  };
  if (!req.thinking) body.temperature = req.temperature;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${req.prefix ? '/beta' : ''}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new ApiError('aborted', 'Dihentikan.');
    throw new ApiError(navigator.onLine ? 'interrupted' : 'offline', 'Tidak bisa terhubung ke DeepSeek. Periksa koneksi internet.');
  }
  if (!res.ok || !res.body) throw errorFromStatus(res.status, await readError(res));

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
          choices?: { delta?: { content?: string; reasoning_content?: string }; finish_reason?: string | null }[];
          usage?: Record<string, number> | null;
          error?: { message?: string };
        };
        try {
          j = JSON.parse(data);
        } catch {
          continue;
        }
        if (j.error) throw new ApiError('unknown', j.error.message ?? 'Kesalahan dari DeepSeek.');
        const ch = j.choices?.[0];
        if (ch?.delta?.reasoning_content) onDelta(ch.delta.reasoning_content, 'reasoning');
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
    const name = (e as Error).name;
    const err =
      name === 'AbortError'
        ? new ApiError('aborted', 'Dihentikan.')
        : new ApiError('interrupted', 'Koneksi terputus saat AI menulis.');
    throw Object.assign(err, { partial: content, usage });
  }

  if (!done && !finishReason) {
    throw Object.assign(new ApiError('interrupted', 'Koneksi terputus saat AI menulis.'), { partial: content, usage });
  }
  if (finishReason === 'content_filter') {
    throw Object.assign(
      new ApiError('refused', 'DeepSeek menolak permintaan ini karena pemeriksaan konten. Coba ubah arahan atau lampiran.'),
      { partial: content, usage },
    );
  }
  return { content, usage, finishReason };
}

export interface Balance {
  available: boolean;
  text: string;
}

export async function getBalance(apiKey: string): Promise<Balance> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/user/balance`, { headers: { Authorization: `Bearer ${apiKey}` } });
  } catch {
    throw new ApiError('offline', 'Tidak bisa terhubung ke DeepSeek. Periksa koneksi internet.');
  }
  if (!res.ok) throw errorFromStatus(res.status, await readError(res));
  const j = (await res.json()) as {
    is_available: boolean;
    balance_infos: { currency: string; total_balance: string }[];
  };
  const text = j.balance_infos.length
    ? j.balance_infos.map((b) => `${b.currency === 'USD' ? '$' : b.currency + ' '}${b.total_balance}`).join(' · ')
    : '0';
  return { available: j.is_available, text };
}
