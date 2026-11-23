import type { NavigateFunction } from 'react-router-dom';

/**
 * Navigasi antara chat dan page tanpa menumpuk riwayat (page → chat → page → chat …).
 *
 * - Page membuka chat dengan state `{ fromPage }`.
 * - Chat yang ingin menampilkan page asal cukup kembali (history.back).
 * - Kalau tujuannya page lain di cerita yang sama, chat kembali ke page asal lalu page asal langsung
 *   diganti dengan page tujuan (`setRedirect`), jadi riwayat tetap: … → page tujuan.
 * - Kalau chat tidak dibuka dari page, page menggantikan chat di riwayat.
 * Posisi gulir yang diminta (akhir naskah / satu balasan) dititipkan lewat `setJump`.
 */

export interface NavState {
  fromPage?: string;
}

export type Jump = { pageId: string; seg?: string; end?: boolean };

let pending: Jump | null = null;

export function setJump(j: Jump) {
  pending = j;
}

export function takeJump(pageId: string): Jump | null {
  if (pending?.pageId !== pageId) return null;
  const j = pending;
  pending = null;
  return j;
}

let redirect: { from: string; to: string } | null = null;

export function setRedirect(from: string, to: string) {
  redirect = { from, to };
}

export function takeRedirect(pageId: string): string | null {
  if (redirect?.from !== pageId) return null;
  const to = redirect.to;
  redirect = null;
  return to;
}

/** Posisi di riwayat aplikasi (React Router menyimpan `idx` di history.state). */
function historyIndex(): number {
  const st = window.history.state as { idx?: number } | null;
  return typeof st?.idx === 'number' ? st.idx : 0;
}

/**
 * Tombol ‹: kembali kalau ada halaman aplikasi sebelumnya; kalau halaman ini dibuka langsung
 * (tautan, bookmark), ganti dengan Beranda supaya tidak keluar aplikasi.
 */
export function goBack(nav: NavigateFunction, fallback = '/') {
  if (historyIndex() > 0) nav(-1);
  else nav(fallback, { replace: true });
}
