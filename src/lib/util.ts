export function uid(): string {
  return crypto.randomUUID();
}

export function countWords(text: string): number {
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('id-ID').format(n);
}

export function formatRupiah(idr: number): string {
  if (idr <= 0) return 'Rp0';
  if (idr < 1) return 'Rp<1';
  if (idr < 10) return 'Rp' + idr.toLocaleString('id-ID', { maximumFractionDigits: 1 });
  return 'Rp' + Math.round(idr).toLocaleString('id-ID');
}

export function formatUsd(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return '$' + usd.toFixed(4);
  return '$' + usd.toFixed(3);
}

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'baru saja';
  if (min < 60) return `${min} mnt lalu`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} jam lalu`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} hari lalu`;
  return new Date(ts).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function firstWords(text: string, n: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const s = words.slice(0, n).join(' ');
  return words.length > n ? s + '…' : s;
}

export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;
  const run = () => {
    t = null;
    if (lastArgs) {
      const a = lastArgs;
      lastArgs = null;
      fn(...a);
    }
  };
  const d = (...args: Parameters<T>) => {
    lastArgs = args;
    if (t) clearTimeout(t);
    t = setTimeout(run, ms);
  };
  d.flush = () => {
    if (t) clearTimeout(t);
    run();
  };
  d.cancel = () => {
    if (t) clearTimeout(t);
    t = null;
    lastArgs = null;
  };
  return d;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Didekode manual (bukan fetch) karena Content Security Policy tidak mengizinkan fetch ke data: URL. */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const comma = dataUrl.indexOf(',');
  const meta = dataUrl.slice(5, comma);
  const mime = meta.split(';')[0] || 'application/octet-stream';
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function downloadFile(name: string, content: Blob) {
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export type ShareResult = 'shared' | 'canceled' | 'unsupported';

/** Bagikan file lewat menu share Android. 'canceled' = pengguna menutup menu share tanpa memilih. */
export async function shareFile(name: string, content: Blob, title: string): Promise<ShareResult> {
  const file = new File([content], name, { type: content.type || 'application/octet-stream' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'canceled';
    }
  }
  return 'unsupported';
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
