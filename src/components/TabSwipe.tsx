import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { IconChat, IconHome } from './Icons';
import { useLocation, useNavigate, type Location, type NavigateFunction } from 'react-router-dom';

/**
 * Tiga layar utama yang bisa digeser: Pengaturan ← Beranda → Chat.
 *
 * Riwayat: Beranda adalah akar. Pindah dari Beranda ke Chat/Pengaturan menambah satu entri
 * (ditandai `tabFromHome`), pindah antar Chat ↔ Pengaturan menggantikan entri itu, dan kembali ke
 * Beranda memakai back. Jadi tombol back dari tab mana pun kembali ke Beranda, tidak bolak-balik antar tab.
 */
export type Tab = 'settings' | 'home' | 'chats';

export const TAB_ORDER: Tab[] = ['settings', 'home', 'chats'];
const PATH: Record<Tab, string> = { settings: '/settings', home: '/', chats: '/chats' };

interface TabState {
  tabFromHome?: boolean;
}

export function tabOf(pathname: string): Tab | null {
  if (pathname === '/' || pathname === '') return 'home';
  if (pathname === '/chats') return 'chats';
  if (pathname === '/settings') return 'settings';
  return null;
}

export function goTab(nav: NavigateFunction, loc: Location, from: Tab, to: Tab) {
  if (from === to) return;
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
const SLOP = 8; // jarak sebelum arah gerak ditentukan (touch slop Android)
const FLING_MIN_DX = 40; // geseran cepat minimal sejauh ini
const FLING_VELOCITY = 0.3; // px/ms (±300 dp/detik)
const EASE = 'cubic-bezier(0.2, 0.9, 0.25, 1)'; // melambat di akhir, seperti ViewPager

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
 * Wadah geser seperti ViewPager Android: ketiga layar dipasang berdampingan dan tetap terpasang,
 * jadi layar sebelah ikut terlihat dan bergerak bersama jari, tanpa layar kosong saat berpindah.
 * Pindah lewat tombol atau back juga dianimasikan dengan cara yang sama.
 */
export function TabPager({ panes }: { panes: Record<Tab, ReactNode> }) {
  const loc = useLocation();
  const nav = useNavigate();
  const tab = tabOf(loc.pathname) ?? 'home';
  const idx = TAB_ORDER.indexOf(tab);
  const rootRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const live = useRef({ nav, loc, idx, tab });
  live.current = { nav, loc, idx, tab };
  const mounted = useRef(false);
  /** durasi animasi berikutnya (diisi saat jari dilepas, supaya kecepatannya menyambung geseran) */
  const settleTimer = useRef(0);
  /** tab yang sudah dituju animasi geser (rute menyusul sesaat kemudian) */
  const sliding = useRef<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const indRef = useRef<HTMLSpanElement>(null);
  const tabRects = useRef<{ left: number; width: number }[]>([]);
  const lastP = useRef(idx);

  /**
   * Penanda tab aktif mengikuti posisi geser. `p` = posisi pecahan (mis. 1,4 = 40% dari Beranda ke Chat),
   * `dur` = durasi animasi yang sama dengan isi layar, supaya bergerak bersamaan.
   */
  const moveIndicator = (p: number, dur = 0) => {
    lastP.current = p;
    const ind = indRef.current;
    const rects = tabRects.current;
    const bar = barRef.current;
    if (!ind || !bar || rects.length !== TAB_ORDER.length) return;
    const q = Math.max(0, Math.min(TAB_ORDER.length - 1, p));
    const i0 = Math.floor(q);
    const i1 = Math.min(i0 + 1, TAB_ORDER.length - 1);
    const f = q - i0;
    const left = rects[i0].left + (rects[i1].left - rects[i0].left) * f;
    const width = rects[i0].width + (rects[i1].width - rects[i0].width) * f;
    ind.style.transition = dur ? `transform ${dur}ms ${EASE}, width ${dur}ms ${EASE}` : 'none';
    ind.style.transform = `translate3d(${left}px, 0, 0)`;
    ind.style.width = `${width}px`;
    ind.style.opacity = '1';
    // Ikon yang paling dekat dengan penanda tampil aktif.
    const near = Math.round(q);
    bar.querySelectorAll<HTMLElement>('[data-tab-btn]').forEach((b, i) => b.classList.toggle('active', i === near));
  };
  const indicatorRef = useRef(moveIndicator);
  indicatorRef.current = moveIndicator;

  // Ukur posisi tombol tab (ulang saat ukuran layar berubah).
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const measure = () => {
      const base = bar.getBoundingClientRect().left;
      tabRects.current = [...bar.querySelectorAll<HTMLElement>('[data-tab-btn]')].map((b) => {
        const r = b.getBoundingClientRect();
        return { left: r.left - base, width: r.width };
      });
      indicatorRef.current(lastP.current);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  /** Layar sebelah hanya digambar saat sedang digeser atau dianimasikan (selain itu disembunyikan, hemat tenaga). */
  const moving = (on: boolean, after = 0) => {
    const root = rootRef.current;
    if (!root) return;
    window.clearTimeout(settleTimer.current);
    if (on) root.classList.add('moving');
    else if (after) settleTimer.current = window.setTimeout(() => root.classList.remove('moving'), after);
    else root.classList.remove('moving');
  };
  const movingRef = useRef(moving);
  movingRef.current = moving;

  // Posisi strip mengikuti tab aktif. Pertama kali dipasang: langsung, tanpa animasi.
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    if (sliding.current === idx) {
      // Sudah meluncur ke sini sejak jari dilepas.
      sliding.current = null;
      return;
    }
    sliding.current = null;
    const dur = mounted.current ? 280 : 0;
    mounted.current = true;
    indicatorRef.current(idx, dur);
    if (dur) {
      movingRef.current(true);
      movingRef.current(false, dur + 60);
    }
    strip.style.transition = dur ? `transform ${dur}ms ${EASE}` : 'none';
    strip.style.transform = `translate3d(${-idx * 100}%, 0, 0)`;
  }, [idx]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const strip = stripRef.current;
    if (!root || !strip) return;
    let start: { x: number; y: number } | null = null;
    let mode: 'none' | 'h' | 'v' = 'none';
    let dx = 0;
    let samples: { t: number; x: number }[] = [];
    /** posisi layar saat disentuh di tengah animasi (relatif ke posisi tab aktif) */
    let grab = 0;
    const curIdx = () => sliding.current ?? live.current.idx;

    const place = (offset: number, dur = 0) => {
      strip.style.transition = dur ? `transform ${dur}ms ${EASE}` : 'none';
      strip.style.transform = `translate3d(calc(${-curIdx() * 100}% + ${offset}px), 0, 0)`;
      indicatorRef.current(curIdx() - offset / (root.clientWidth || 1), dur);
    };

    const onStart = (e: TouchEvent) => {
      start = null;
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX < EDGE || t.clientX > window.innerWidth - EDGE || blocksSwipe(e.target, root)) return;
      start = { x: t.clientX, y: t.clientY };
      mode = 'none';
      dx = 0;
      // Disentuh saat masih meluncur: tahan di posisinya sekarang (seperti ViewPager), lalu lanjut dari situ.
      grab = 0;
      if (root.classList.contains('moving')) {
        const x = new DOMMatrixReadOnly(getComputedStyle(strip).transform).m41;
        grab = Math.round(x + curIdx() * root.clientWidth);
        if (Math.abs(grab) > 1) place(grab);
        else grab = 0;
      }
      samples = [{ t: e.timeStamp, x: t.clientX }];
      movingRef.current(true);
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      if (e.touches.length !== 1) {
        // Jari kedua: batalkan geseran.
        if (mode === 'h') place(0, 200);
        movingRef.current(false, mode === 'h' ? 260 : 0);
        start = null;
        return;
      }
      const t = e.touches[0];
      const mx = t.clientX - start.x;
      const my = t.clientY - start.y;
      if (mode === 'none') {
        if (Math.abs(mx) < SLOP && Math.abs(my) < SLOP) return;
        mode = Math.abs(mx) > Math.abs(my) * 1.2 ? 'h' : 'v';
        if (mode === 'v') {
          if (grab) {
            // Ternyata menggulir: selesaikan perpindahan yang tadi ditahan.
            place(0, 220);
            movingRef.current(false, 280);
            grab = 0;
          } else movingRef.current(false);
        }
        if (mode === 'h') start = { x: t.clientX, y: t.clientY }; // mulai dari titik ini, supaya tidak melompat
      }
      if (mode !== 'h') return;
      const i = curIdx();
      const raw = t.clientX - start.x + grab;
      // Di ujung (tidak ada layar di arah itu) layar tidak ikut bergeser.
      const w = root.clientWidth;
      dx = Math.max(i === TAB_ORDER.length - 1 ? 0 : -w, Math.min(i === 0 ? 0 : w, raw));
      samples.push({ t: e.timeStamp, x: t.clientX });
      if (samples.length > 6) samples.shift();
      place(dx);
    };
    const onEnd = (e: TouchEvent) => {
      if (!start) return;
      const wasH = mode === 'h';
      start = null;
      mode = 'none';
      if (!wasH) {
        if (grab) {
          place(0, 220);
          movingRef.current(false, 280);
        } else movingRef.current(false);
        return;
      }
      const w = root.clientWidth;
      // Kecepatan saat dilepas (±100 ms terakhir), bukan rata-rata seluruh geseran.
      // Jari berhenti sebelum dilepas = kecepatan 0.
      const recent = samples.filter((s) => e.timeStamp - s.t <= 100);
      let v = 0;
      if (recent.length >= 2) {
        const first = recent[0];
        const last = recent[recent.length - 1];
        const dt = last.t - first.t;
        v = dt > 0 ? (last.x - first.x) / dt : Math.sign(last.x - first.x) * 10;
      }
      const { nav: n, loc: l } = live.current;
      const i = curIdx();
      const cur = TAB_ORDER[i];
      const dir = dx < 0 ? 1 : -1;
      const next = TAB_ORDER[i + dir];
      const fling = Math.abs(dx) >= FLING_MIN_DX && Math.abs(v) >= FLING_VELOCITY && Math.sign(v) === Math.sign(dx);
      const go = !!next && dx !== 0 && (fling || Math.abs(dx) > w / 2);
      const remaining = go ? w - Math.abs(dx) : Math.abs(dx);
      const speed = Math.max(Math.abs(v), 1.2);
      const dur = Math.round(Math.min(320, Math.max(150, remaining / speed + 80)));
      if (go) {
        // Animasi langsung dimulai (berjalan di compositor), rute diganti setelah animasi mulai,
        // supaya render React tidak menahan frame pertama.
        const to = i + dir;
        sliding.current = to;
        strip.style.transition = `transform ${dur}ms ${EASE}`;
        strip.style.transform = `translate3d(${-to * 100}%, 0, 0)`;
        indicatorRef.current(to, dur);
        movingRef.current(true);
        movingRef.current(false, dur + 60);
        requestAnimationFrame(() => requestAnimationFrame(() => goTab(n, l, cur, next)));
        // Pengaman: kalau rute ternyata tidak berubah, kembalikan layar ke tempatnya.
        window.setTimeout(() => {
          if (live.current.idx === i) {
            sliding.current = null;
            place(0, 200);
            movingRef.current(false, 260);
          }
        }, dur + 500);
      } else {
        place(0, dur);
        movingRef.current(false, dur + 60);
      }
    };

    // Pasif supaya gulir vertikal tidak menunggu JavaScript. touch-action: pan-y membuat browser tidak ikut
    // menggulir kalau gerakan pertama mendatar, jadi layar tidak bergerak dua arah sekaligus.
    root.addEventListener('touchstart', onStart, { passive: true });
    root.addEventListener('touchmove', onMove, { passive: true });
    root.addEventListener('touchend', onEnd);
    root.addEventListener('touchcancel', onEnd);
    return () => {
      root.removeEventListener('touchstart', onStart);
      root.removeEventListener('touchmove', onMove);
      root.removeEventListener('touchend', onEnd);
      root.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  const go = (to: Tab) => goTab(nav, loc, tab, to);
  return (
    <div className="pager" ref={rootRef}>
      {/* Bar tab tetap diam; hanya isi layar di bawahnya yang bergeser. */}
      <div className="tab-bar" ref={barRef} role="tablist">
        <span className="tab-indicator" ref={indRef} aria-hidden="true" />
        <button data-tab-btn role="tab" aria-selected={tab === 'settings'} className={'avatar' + (tab === 'settings' ? ' active' : '')} aria-label="Pengaturan" onClick={() => go('settings')}>
          <span>CS</span>
        </button>
        <button data-tab-btn role="tab" aria-selected={tab === 'home'} className={'tab-pill' + (tab === 'home' ? ' active' : '')} aria-label="Beranda" onClick={() => go('home')}>
          <IconHome size={20} />
        </button>
        <button data-tab-btn role="tab" aria-selected={tab === 'chats'} className={'tab-pill' + (tab === 'chats' ? ' active' : '')} aria-label="Chat" onClick={() => go('chats')}>
          <IconChat size={20} />
        </button>
      </div>
      <div className="pager-view">
        <div className="pager-strip" ref={stripRef}>
          {TAB_ORDER.map((t, i) => (
            <div key={t} className="pager-pane" data-tab={t} inert={i !== idx} aria-hidden={i !== idx}>
              {panes[t]}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
