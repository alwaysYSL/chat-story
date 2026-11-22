import { useRegisterSW } from 'virtual:pwa-register/react';
import { useState } from 'react';
import { flushEditors } from '../lib/editors';
import { useActiveGen } from '../lib/generate';

const CHECK_EVERY_MS = 30 * 60 * 1000;

/**
 * Cek versi baru saat aplikasi dibuka, saat kembali ke aplikasi, dan tiap 30 menit.
 * Versi baru tidak dipasang diam-diam supaya tulisan AI yang sedang berjalan tidak terputus;
 * pengguna menekan "Perbarui" sendiri.
 */
export function UpdateBanner() {
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
