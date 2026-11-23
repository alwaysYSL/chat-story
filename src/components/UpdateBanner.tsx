import { useRegisterSW } from 'virtual:pwa-register/react';
import { useEffect, useState } from 'react';
import { flushEditors } from '../lib/editors';
import { useActiveGen } from '../lib/generate';
import { httpFetch, isNative, openExternal } from '../lib/native';

const CHECK_EVERY_MS = 30 * 60 * 1000;
const RELEASE_API = 'https://api.github.com/repos/alwaysYSL/chat-story/releases/latest';

export function UpdateBanner() {
  return isNative() ? <ApkUpdateBanner /> : <PwaUpdateBanner />;
}

/**
 * PWA: cek versi baru saat aplikasi dibuka, saat kembali ke aplikasi, dan tiap 30 menit.
 * Versi baru tidak dipasang diam-diam supaya tulisan AI yang sedang berjalan tidak terputus;
 * pengguna menekan "Perbarui" sendiri.
 */
function PwaUpdateBanner() {
  const gen = useActiveGen();
  const [updating, setUpdating] = useState(false);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => {
        if (navigator.onLine) void reg.update().catch(() => {});
      };
      setInterval(check, CHECK_EVERY_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });

  if (!needRefresh) return null;
  return (
    <div className="update-banner" role="status">
      <span>{gen ? 'Versi baru tersedia. Tunggu AI selesai menulis.' : 'Versi baru aplikasi tersedia.'}</span>
      <button
        className="btn btn-small btn-primary"
        disabled={!!gen || updating}
        onClick={async () => {
          setUpdating(true);
          await flushEditors();
          await updateServiceWorker(true);
          // Cadangan kalau halaman tidak memuat ulang sendiri.
          setTimeout(() => location.reload(), 1500);
        }}
      >
        {updating ? 'Memperbarui…' : 'Perbarui'}
      </button>
    </div>
  );
}

/** "1.10.0" > "1.9.2" */
export function newerVersion(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

interface Release {
  tag_name: string;
  html_url: string;
  assets: { name: string; browser_download_url: string }[];
}

/**
 * APK: cek rilis terbaru di GitHub saat aplikasi dibuka dan saat kembali ke aplikasi (maks. tiap 6 jam).
 * Kalau ada, tombol "Unduh" membuka file APK di browser; Android lalu meminta konfirmasi pemasangan.
 * Data tetap aman karena APK baru ditandatangani dengan kunci yang sama.
 */
function ApkUpdateBanner() {
  const [rel, setRel] = useState<{ version: string; url: string } | null>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = 0;
    const check = async () => {
      if (!navigator.onLine || Date.now() - last < 6 * 3600_000) return;
      last = Date.now();
      try {
        const res = await httpFetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } });
        if (!res.ok) return;
        const r = (await res.json()) as Release;
        const apk = r.assets.find((a) => a.name.endsWith('.apk'));
        if (apk && newerVersion(r.tag_name, __APP_VERSION__)) setRel({ version: r.tag_name.replace(/^v/, ''), url: apk.browser_download_url });
      } catch {
        /* coba lagi nanti */
      }
    };
    void check();
    const onVis = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  if (!rel || hidden) return null;
  return (
    <div className="update-banner" role="status">
      <span>Chat Story {rel.version} tersedia.</span>
      <button className="btn btn-small" onClick={() => setHidden(true)}>
        Nanti
      </button>
      <button className="btn btn-small btn-primary" onClick={() => openExternal(rel.url)}>
        Unduh
      </button>
    </div>
  );
}
