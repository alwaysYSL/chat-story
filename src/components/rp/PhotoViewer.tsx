import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { backStack, isNative } from '../../lib/native';
import { IconClose } from '../Icons';

/**
 * Jendela foto yang melayang (seperti picture-in-picture): latar tidak digelapkan dan chat di belakangnya
 * tetap bisa digulir. Geser untuk memindahkan, cubit atau tarik pegangan di sudut untuk mengubah ukuran,
 * ketuk dua kali untuk ukuran awal/besar. Jendela tidak bisa keluar layar.
 */

interface Shown {
  blob: Blob;
  name: string;
}
let shown: Shown | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function showPhoto(blob: Blob | null | undefined, name: string) {
  if (!blob) return;
  shown = { blob, name };
  emit();
}
export function closePhoto() {
  shown = null;
  emit();
}

const CAPTION = 26;
/** border 1px di kiri-kanan / atas-bawah (box-sizing: border-box) */
const BORDER = 2;
/** tinggi jendela untuk lebar w */
const heightOf = (w: number, a: number) => (w - BORDER) / a + CAPTION + BORDER;
const MIN_W = 120;
const TOP = 8;

interface Box {
  x: number;
  y: number;
  w: number;
}

function viewport() {
  return { vw: window.innerWidth, vh: window.innerHeight };
}

export function PhotoViewer() {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => shown,
  );
  const url = useMemo(() => (s ? URL.createObjectURL(s.blob) : null), [s?.blob]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  const [aspect, setAspect] = useState(1);
  const [box, setBox] = useState<Box | null>(null);
  const boxRef = useRef<Box | null>(null);
  boxRef.current = box;
  const aspectRef = useRef(1);
  aspectRef.current = aspect;

  // Batas: tinggi jendela = lebar / rasio foto + keterangan; jendela selalu di dalam layar.
  const clamp = (b: Box, a = aspectRef.current): Box => {
    const { vw, vh } = viewport();
    const maxW = Math.max(MIN_W, Math.min(vw, (vh - CAPTION - BORDER - TOP) * a + BORDER));
    const w = Math.min(maxW, Math.max(MIN_W, b.w));
    const h = heightOf(w, a);
    return { w, x: Math.min(Math.max(0, b.x), vw - w), y: Math.min(Math.max(TOP, b.y), vh - h) };
  };
  const initial = (a: number): Box => {
    const { vw } = viewport();
    const w = Math.max(160, vw * 0.6);
    return clamp({ w, x: (vw - w) / 2, y: 72 }, a);
  };

  // Ukuran & posisi tetap saat membuka foto lain; disesuaikan dengan rasio foto baru.
  useEffect(() => {
    if (!s) setBox(null);
  }, [s]);

  // Tutup dengan tombol back Android / Esc.
  useEffect(() => {
    if (!s) return;
    if (isNative()) {
      const close = () => closePhoto();
      backStack.push(close);
      return () => {
        const i = backStack.lastIndexOf(close);
        if (i >= 0) backStack.splice(i, 1);
      };
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closePhoto();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [!!s]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onResize = () => boxRef.current && setBox(clamp(boxRef.current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Gestur ---------- */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ mode: 'move' | 'resize' | 'pinch'; start: Box; px: number; py: number; dist?: number; cx?: number; cy?: number } | null>(null);
  const lastTap = useRef(0);

  const begin = (mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    if (!boxRef.current) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { mode: 'pinch', start: boxRef.current, px: 0, py: 0, dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    } else {
      gesture.current = { mode, start: boxRef.current, px: e.clientX, py: e.clientY };
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const st = g.start;
    if (g.mode === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const k = Math.hypot(a.x - b.x, a.y - b.y) / (g.dist || 1);
      const w = st.w * k;
      const h0 = heightOf(st.w, aspect);
      const h = heightOf(w, aspect);
      // Perbesar di sekitar titik tengah jendela.
      setBox(clamp({ w, x: st.x + st.w / 2 - w / 2, y: st.y + h0 / 2 - h / 2 }));
    } else if (g.mode === 'resize') {
      setBox(clamp({ ...st, w: st.w + (e.clientX - g.px) }));
    } else if (g.mode === 'move') {
      setBox(clamp({ ...st, x: st.x + e.clientX - g.px, y: st.y + e.clientY - g.py }));
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (g?.mode === 'move' && Math.hypot(e.clientX - g.px, e.clientY - g.py) < 6) {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        lastTap.current = 0;
        const { vw, vh } = viewport();
        const big = Math.min(vw, (vh - CAPTION - BORDER - TOP) * aspect + BORDER) * 0.96;
        const init = initial(aspect);
        const cur = boxRef.current!;
        const toBig = cur.w < (big + init.w) / 2;
        const w = toBig ? big : init.w;
        setBox(clamp({ w, x: cur.x + cur.w / 2 - w / 2, y: cur.y }));
      } else lastTap.current = now;
    }
    if (pointers.current.size === 1 && g?.mode === 'pinch') {
      // Satu jari tersisa: lanjut menggeser dari posisi sekarang.
      const [p] = [...pointers.current.values()];
      gesture.current = { mode: 'move', start: boxRef.current!, px: p.x, py: p.y };
    } else if (!pointers.current.size) gesture.current = null;
  };

  if (!s || !url) return null;
  return (
    <div
      className="photo-viewer"
      role="dialog"
      aria-label={`Foto ${s.name}`}
      style={box ? { left: box.x, top: box.y, width: box.w } : { visibility: 'hidden' }}
      onPointerDown={begin('move')}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <img
        src={url}
        alt={s.name}
        draggable={false}
        style={box ? { height: (box.w - BORDER) / aspect } : undefined}
        onLoad={(e) => {
          const img = e.currentTarget;
          const a = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
          setAspect(a);
          aspectRef.current = a;
          setBox((b) => (b ? clamp(b, a) : initial(a)));
        }}
      />
      <div className="photo-caption">{s.name}</div>
      <button
        className="photo-close"
        aria-label="Tutup foto"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => closePhoto()}
      >
        <IconClose size={16} />
      </button>
      <span className="photo-handle" aria-label="Ubah ukuran" onPointerDown={begin('resize')} />
    </div>
  );
}
