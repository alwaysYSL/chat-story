import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, type Location, type NavigateFunction } from 'react-router-dom';

/**
 * Tiga layar utama yang bisa digeser: Pengaturan ← Beranda → Chat.
 *
 * Riwayat: Beranda adalah akar. Pindah dari Beranda ke Chat/Pengaturan menambah satu entri
 * (ditandai `tabFromHome`), pindah antar Chat ↔ Pengaturan menggantikan entri itu, dan kembali ke
 * Beranda memakai back. Jadi tombol back dari tab mana pun kembali ke Beranda, tidak bolak-balik antar tab.
 */
export type Tab = 'settings' | 'home' | 'chats';

const ORDER: Tab[] = ['settings', 'home', 'chats'];
const PATH: Record<Tab, string> = { settings: '/settings', home: '/', chats: '/chats' };

interface TabState {
  tabFromHome?: boolean;
}

/** Arah animasi untuk layar berikutnya. */
let enterFrom: 'left' | 'right' | null = null;

export function takeEnter(): 'left' | 'right' | null {
  const e = enterFrom;
  enterFrom = null;
  return e;
}

export function goTab(nav: NavigateFunction, loc: Location, from: Tab, to: Tab) {
  if (from === to) return;
  enterFrom = ORDER.indexOf(to) > ORDER.indexOf(from) ? 'right' : 'left';
  const st = (loc.state as TabState | null) ?? {};
  if (to === 'home') {
    if (st.tabFromHome) nav(-1);
    else nav('/', { replace: true });
  } else if (from === 'home') {
    nav(PATH[to], { state: { tabFromHome: true } satisfies TabState });
  } else {
    nav(PATH[to], { replace: true, state: st });
  }
}

const EDGE = 24; // tepi layar dipakai gestur back Android
const LOCK = 10; // jarak sebelum arah gerak ditentukan

function blocksSwipe(target: EventTarget | null, root: HTMLElement): boolean {
  let el = target as HTMLElement | null;
  while (el && el !== root) {
    if (el.matches('input, textarea, select, [contenteditable="true"], .sheet-backdrop, .no-swipe')) return true;
    const ox = getComputedStyle(el).overflowX;
    if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 2) return true;
    el = el.parentElement;
  }
  return false;
}

/**
 * Pasang gestur geser di layar tab. Mengembalikan ref untuk elemen akar layar.
 * Jari ke kiri = tab di kanan, jari ke kanan = tab di kiri. Tidak aktif kalau mulai di tepi layar,
 * di kolom isian, atau di area yang bisa digulir ke samping (mis. kartu Terbaru).
 */
export function useTabSwipe(tab: Tab) {
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const loc = useLocation();
  const navRef = useRef({ nav, loc });
  navRef.current = { nav, loc };

  // Animasi masuk saat datang dari tab lain.
  useEffect(() => {
    const el = ref.current;
    const dir = takeEnter();
    if (!el || !dir) return;
    el.classList.add(dir === 'right' ? 'tab-enter-right' : 'tab-enter-left');
    const done = () => el.classList.remove('tab-enter-right', 'tab-enter-left');
    el.addEventListener('animationend', done, { once: true });
    return () => el.removeEventListener('animationend', done);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const idx = ORDER.indexOf(tab);
    let start: { x: number; y: number; t: number } | null = null;
    let mode: 'none' | 'h' | 'v' = 'none';
    let dx = 0;

    const reset = (animate: boolean) => {
      el.style.transition = animate ? 'transform 0.2s ease, opacity 0.2s ease' : '';
      el.style.transform = '';
      el.style.opacity = '';
      if (animate) setTimeout(() => (el.style.transition = ''), 220);
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const w = window.innerWidth;
      if (t.clientX < EDGE || t.clientX > w - EDGE || blocksSwipe(e.target, el)) {
        start = null;
        return;
      }
      start = { x: t.clientX, y: t.clientY, t: performance.now() };
      mode = 'none';
      dx = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 1) return;
      const t = e.touches[0];
      const mx = t.clientX - start.x;
      const my = t.clientY - start.y;
      if (mode === 'none') {
        if (Math.abs(mx) < LOCK && Math.abs(my) < LOCK) return;
        mode = Math.abs(mx) > Math.abs(my) * 1.3 ? 'h' : 'v';
      }
      if (mode !== 'h') return;
      const hasTarget = mx < 0 ? idx < ORDER.length - 1 : idx > 0;
      dx = hasTarget ? mx : mx * 0.2; // tidak ada tab di arah itu: tahan seperti karet
      el.style.transition = '';
      el.style.transform = `translateX(${dx}px)`;
      el.style.opacity = String(1 - Math.min(0.35, Math.abs(dx) / window.innerWidth));
    };
    const onEnd = () => {
      if (!start) return;
      const elapsed = performance.now() - start.t;
      const wasH = mode === 'h';
      start = null;
      mode = 'none';
      if (!wasH) return;
      const fast = Math.abs(dx) > 40 && Math.abs(dx) / Math.max(elapsed, 1) > 0.5;
      const far = Math.abs(dx) > window.innerWidth * 0.25;
      const next = dx < 0 ? ORDER[idx + 1] : ORDER[idx - 1];
      if ((fast || far) && next) {
        reset(false);
        const { nav: n, loc: l } = navRef.current;
        goTab(n, l, tab, next);
      } else reset(true);
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [tab]);

  return ref;
}
