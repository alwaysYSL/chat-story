import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/**
 * Jembatan ke fitur Android (APK). Di PWA semua fungsi di sini jatuh ke API browser biasa.
 */

interface StreamHttpPlugin {
  request(o: { id: string; url: string; method: string; headers: Record<string, string>; body?: string }): Promise<{
    status: number;
    headers: Record<string, string>;
  }>;
  cancel(o: { id: string }): Promise<void>;
  keepAwake(o: { on: boolean }): Promise<void>;
  openUrl(o: { url: string }): Promise<void>;
  addListener(event: 'chunk', fn: (e: { id: string; data: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'end', fn: (e: { id: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'error', fn: (e: { id: string; message: string }) => void): Promise<PluginListenerHandle>;
}

const StreamHttp = registerPlugin<StreamHttpPlugin>('StreamHttp');

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/* ---------- HTTP lewat Android (tanpa batasan CORS, tetap streaming) ---------- */

interface Pending {
  controller: ReadableStreamDefaultController<Uint8Array>;
}

const streams = new Map<string, Pending>();
let listening: Promise<void> | null = null;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function ensureListeners(): Promise<void> {
  listening ??= (async () => {
    await StreamHttp.addListener('chunk', (e) => streams.get(e.id)?.controller.enqueue(b64ToBytes(e.data)));
    await StreamHttp.addListener('end', (e) => {
      streams.get(e.id)?.controller.close();
      streams.delete(e.id);
    });
    await StreamHttp.addListener('error', (e) => {
      streams.get(e.id)?.controller.error(new TypeError(e.message || 'Koneksi terputus'));
      streams.delete(e.id);
    });
  })();
  return listening;
}

function abortError(): DOMException {
  return new DOMException('Dihentikan', 'AbortError');
}

async function nativeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  await ensureListeners();
  const id = crypto.randomUUID();
  const signal = init.signal;
  if (signal?.aborted) throw abortError();
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((v, k) => (headers[k] = v));

  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start: (c) => {
      controller = c;
    },
    cancel: () => {
      streams.delete(id);
      void StreamHttp.cancel({ id });
    },
  });
  streams.set(id, { controller });

  const onAbort = () => {
    void StreamHttp.cancel({ id });
    streams.get(id)?.controller.error(abortError());
    streams.delete(id);
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  let res: { status: number; headers: Record<string, string> };
  try {
    res = await StreamHttp.request({
      id,
      url,
      method: init.method ?? 'GET',
      headers,
      body: typeof init.body === 'string' ? init.body : undefined,
    });
  } catch (e) {
    streams.delete(id);
    signal?.removeEventListener('abort', onAbort);
    if (signal?.aborted) throw abortError();
    // Disamakan dengan fetch: kegagalan jaringan = TypeError.
    throw new TypeError((e as Error).message || 'Failed to fetch');
  }
  const status = res.status >= 200 && res.status <= 599 ? res.status : 500;
  return new Response(status === 204 || status === 304 ? null : body, { status, headers: res.headers });
}

/** fetch yang di APK lewat Android, di PWA lewat browser. */
export function httpFetch(url: string, init?: RequestInit): Promise<Response> {
  return isNative() ? nativeFetch(url, init) : fetch(url, init);
}

/* ---------- Layar tetap menyala ---------- */

export async function nativeKeepAwake(on: boolean): Promise<void> {
  try {
    await StreamHttp.keepAwake({ on });
  } catch {
    /* abaikan */
  }
}

/* ---------- Tautan keluar ---------- */

export function openExternal(url: string) {
  if (isNative()) void StreamHttp.openUrl({ url });
  else window.open(url, '_blank', 'noopener');
}

/** Di APK, tautan target=_blank dibuka di browser HP (WebView tidak membuka jendela baru). */
export function installExternalLinkHandler() {
  if (!isNative()) return;
  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target !== '_blank' || !/^https?:/.test(a.href)) return;
      e.preventDefault();
      openExternal(a.href);
    },
    true,
  );
}

/* ---------- Simpan / bagikan file ---------- */

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Bagikan file lewat menu share Android. */
export async function nativeShareFile(name: string, blob: Blob, title: string): Promise<'shared' | 'canceled'> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');
  const w = await Filesystem.writeFile({ path: `share/${name}`, data: await blobToBase64(blob), directory: Directory.Cache, recursive: true });
  try {
    await Share.share({ title, files: [w.uri], dialogTitle: title });
    return 'shared';
  } catch (e) {
    if (/cancel/i.test((e as Error).message ?? '')) return 'canceled';
    throw e;
  }
}

/** Simpan file ke folder Documents/ChatStory di HP. Mengembalikan lokasi yang bisa ditampilkan. */
export async function nativeSaveFile(name: string, blob: Blob): Promise<string> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  await Filesystem.writeFile({ path: `ChatStory/${name}`, data: await blobToBase64(blob), directory: Directory.Documents, recursive: true });
  return `Documents/ChatStory/${name}`;
}

/* ---------- Tombol back Android ---------- */

/** Penutup sheet yang sedang terbuka, paling atas di akhir. */
export const backStack: (() => void)[] = [];

export async function installBackButton(onEmpty: () => void) {
  if (!isNative()) return;
  const { App } = await import('@capacitor/app');
  await App.addListener('backButton', () => {
    const top = backStack[backStack.length - 1];
    if (top) top();
    else onEmpty();
  });
}

export async function exitApp() {
  if (!isNative()) return;
  const { App } = await import('@capacitor/app');
  await App.minimizeApp();
}
