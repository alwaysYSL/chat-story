import type { Usage } from '../db';
import { httpFetch, isNative } from './native';
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

/**
 * Model yang menolak mode berpikir dimatikan (mis. sebagian model OpenRouter: "Reasoning is mandatory").
 * Diingat selama aplikasi terbuka supaya permintaan berikutnya langsung benar.
 */
const reasoningRequired = new Set<string>();
const REASONING_REQUIRED_RE = /(reason|think)[\s\S]*(mandatory|cannot be disabled|can ?not be turned off|required|must be enabled)/i;
/** Token tambahan untuk model yang tetap berpikir walaupun mode berpikir mati. */
const FORCED_REASONING_TOKENS = 16000;

function modelKey(req: Pick<ChatRequest, 'provider' | 'model'>) {
  return `${req.provider.id}::${req.model.id}`;
}

export function buildBody(req: ChatRequest, stream: boolean, extraForForced = true): Record<string, unknown> {
  const forced = !req.thinking && reasoningRequired.has(modelKey(req));
  const body: Record<string, unknown> = {
    model: req.model.id,
    messages: req.messages,
    max_tokens: forced && extraForForced ? req.maxTokens + FORCED_REASONING_TOKENS : req.maxTokens,
    ...(forced ? {} : thinkingParams(req.model, req.thinking)),
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

  const send = async (): Promise<Response> => {
    try {
      return await httpFetch(chatUrl(req.provider, req.prefix), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${req.provider.apiKey.trim()}` },
        body: JSON.stringify(buildBody(req, true)),
        signal,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new ApiError('aborted', 'Dihentikan.');
      if (!navigator.onLine) throw new ApiError('offline', 'Tidak ada koneksi internet.');
      throw new ApiError('interrupted', await connectFailMessage(chatUrl(req.provider, req.prefix), name));
    }
  };
  let res = await send();
  if (!res.ok) {
    const detail = await readError(res);
    if (needsReasoning(req, res.status, detail)) res = await send();
    else throw errorFromStatus(res.status, detail, name);
  }
  if (!res.ok || !res.body) throw errorFromStatus(res.status, await readError(res), name);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let dataLines: string[] = [];
  let content = '';
  let usage: Usage = { hit: 0, miss: 0, out: 0 };
  let finishReason: string | null = null;
  let done = false;

  type Chunk = {
    choices?: {
      delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null };
      finish_reason?: string | null;
    }[];
    usage?: Record<string, unknown> | null;
    error?: { message?: string };
  };

  /** Satu event SSE selesai (baris kosong, atau akhir stream). */
  const dispatch = () => {
    if (!dataLines.length) return;
    const data = dataLines.join('\n').trim();
    dataLines = [];
    if (data === '[DONE]') {
      done = true;
      return;
    }
    let j: Chunk;
    try {
      j = JSON.parse(data);
    } catch {
      return;
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
  };

  const handleLine = (raw: string) => {
    const line = raw.replace(/\r$/, '');
    if (line === '') return dispatch();
    if (line.startsWith(':')) return; // komentar / keep-alive
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
      // Kebanyakan penyedia mengirim satu baris data per event tanpa baris kosong yang rapi.
      const joined = dataLines.join('\n').trim();
      if (joined === '[DONE]' || isCompleteJson(joined)) dispatch();
    }
  };

  try {
    while (!done) {
      const r = await reader.read();
      if (r.done) {
        buf += decoder.decode();
        break;
      }
      buf += decoder.decode(r.value, { stream: true });
      let idx: number;
      while (!done && (idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        handleLine(line);
      }
    }
    // Sisa terakhir tanpa baris baru di akhir stream.
    if (!done && buf) handleLine(buf);
    if (!done) dispatch();
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

/**
 * Jelaskan kenapa koneksi gagal. Di PWA, permintaan "no-cors" berhasil kalau servernya bisa dihubungi;
 * berarti yang memblokir adalah aturan CORS browser, bukan alamat atau internet.
 */
async function connectFailMessage(url: string, name: string): Promise<string> {
  if (!navigator.onLine) return 'Tidak ada koneksi internet.';
  if (!isNative()) {
    try {
      await fetch(url, { method: 'GET', mode: 'no-cors', cache: 'no-store' });
      return `${name} tidak mengizinkan aplikasi web memanggil API-nya langsung (CORS). Pakai aplikasi Android (APK) Chat Story, yang tidak terkena aturan ini, atau minta ${name} mengaktifkan CORS.`;
    } catch {
      /* server memang tidak bisa dihubungi */
    }
  }
  return `Tidak bisa terhubung ke ${name}. Periksa koneksi internet dan base URL di Pengaturan.`;
}

function isCompleteJson(s: string): boolean {
  if (!s.startsWith('{')) return false;
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

/** Kalau model menolak mode berpikir dimatikan, ingat dan kembalikan true supaya permintaan diulang. */
function needsReasoning(req: Pick<ChatRequest, 'provider' | 'model' | 'thinking'>, status: number, detail: string): boolean {
  const key = modelKey(req);
  if (req.thinking || reasoningRequired.has(key)) return false;
  if ((status !== 400 && status !== 422) || !REASONING_REQUIRED_RE.test(detail)) return false;
  reasoningRequired.add(key);
  return true;
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
      res = await httpFetch(`${provider.baseUrl.replace(/\/+$/, '')}/user/balance`, { headers: { Authorization: `Bearer ${key}` } });
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
  const req: ChatRequest = {
    provider,
    model: m,
    messages: [{ role: 'user', content: 'Balas dengan satu kata: halo' }],
    thinking: false,
    temperature: 0.5,
    maxTokens: 16,
  };
  const send = async () => {
    try {
      return await httpFetch(chatUrl(provider), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        // Tes koneksi tidak perlu jawaban panjang, walaupun modelnya wajib berpikir.
        body: JSON.stringify(buildBody(req, false, false)),
      });
    } catch {
      throw new ApiError('offline', await connectFailMessage(chatUrl(provider), name));
    }
  };
  let res = await send();
  if (!res.ok) {
    const detail = await readError(res);
    if (needsReasoning(req, res.status, detail)) res = await send();
    else throw errorFromStatus(res.status, detail, name);
  }
  if (!res.ok) throw errorFromStatus(res.status, await readError(res), name);
  // Sebagian penyedia mengembalikan status 200 dengan pesan error di isinya.
  const body = (await res.json().catch(() => null)) as { error?: { message?: string }; choices?: unknown[] } | null;
  if (!body || body.error || !Array.isArray(body.choices)) {
    throw new ApiError('invalid', `${name} membalas dengan format yang tidak dikenal${body?.error?.message ? `: ${body.error.message}` : '.'}`);
  }
  return { ok: true, text: `Terhubung ke ${name} dengan model ${m.label}. Cek saldo di situs ${name}.` };
}

/* ---------- Daftar model dari penyedia ---------- */

export interface RemoteModel {
  id: string;
  label: string;
  context?: number;
  vision: boolean;
  /** harga USD per 1 juta token kalau penyedia mencantumkannya (mis. OpenRouter) */
  priceUsd?: { in: number; cache: number; out: number };
}

type Raw = Record<string, unknown>;
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};

function parseRemote(m: Raw): RemoteModel | null {
  const id = typeof m.id === 'string' ? m.id : null;
  if (!id) return null;
  const arch = (m.architecture ?? {}) as Raw;
  const top = (m.top_provider ?? {}) as Raw;
  const caps = m.capabilities;
  const modalities = [
    ...(Array.isArray(arch.input_modalities) ? arch.input_modalities : []),
    ...(Array.isArray(m.input_modalities) ? m.input_modalities : []),
    ...(Array.isArray(m.modalities) ? m.modalities : []),
  ].map(String);
  const vision =
    m.supports_vision === true ||
    modalities.includes('image') ||
    (Array.isArray(caps) && caps.map(String).includes('vision')) ||
    (!!caps && typeof caps === 'object' && (caps as Raw).vision === true);
  const context = num(m.context_window) ?? num(m.context_length) ?? num(top.context_length) ?? num(m.max_context_length);
  const label = [m.display_name, m.name].find((x) => typeof x === 'string' && x.trim()) as string | undefined;
  let priceUsd: RemoteModel['priceUsd'];
  const pr = (m.pricing ?? null) as Raw | null;
  // Format OpenRouter: USD per token dalam string.
  const pIn = num(pr?.prompt);
  const pOut = num(pr?.completion);
  if (pIn !== undefined && pOut !== undefined && pIn >= 0 && pOut >= 0) {
    const pCache = num(pr?.input_cache_read) ?? pIn;
    priceUsd = { in: pIn * 1e6, cache: pCache * 1e6, out: pOut * 1e6 };
  }
  return { id, label: label?.trim() || id, context, vision, priceUsd };
}

/** Ambil daftar model dari endpoint `/models` penyedia (format OpenAI). */
export async function listModels(provider: ProviderConfig): Promise<RemoteModel[]> {
  const name = provider.name;
  const url = `${provider.baseUrl.replace(/\/+$/, '')}/models`;
  const key = provider.apiKey.trim();
  let res: Response;
  try {
    res = await httpFetch(url, { headers: key ? { Authorization: `Bearer ${key}` } : {} });
  } catch {
    throw new ApiError('offline', await connectFailMessage(url, name));
  }
  if (!res.ok) throw errorFromStatus(res.status, await readError(res), name);
  const body = (await res.json().catch(() => null)) as { data?: unknown; models?: unknown } | unknown[] | null;
  const list = Array.isArray(body) ? body : Array.isArray((body as Raw | null)?.data) ? ((body as Raw).data as unknown[]) : Array.isArray((body as Raw | null)?.models) ? ((body as Raw).models as unknown[]) : null;
  if (!list) throw new ApiError('invalid', `${name} tidak mengirim daftar model dengan format yang dikenal.`);
  return list
    .map((m) => (m && typeof m === 'object' ? parseRemote(m as Raw) : null))
    .filter((m): m is RemoteModel => !!m)
    .sort((a, b) => a.id.localeCompare(b.id));
}
