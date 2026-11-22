/**
 * Navigasi antara chat dan page tanpa menumpuk riwayat (page → chat → page → chat …).
 *
 * - Page membuka chat dengan state `{ fromPage }`.
 * - Chat yang ingin menampilkan page tersebut cukup kembali (history.back), bukan membuka page baru.
 * - Kalau chat tidak dibuka dari page itu, page menggantikan chat di riwayat (replace).
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
