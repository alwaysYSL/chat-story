import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PhotoCrop } from '../../db';
import { backStack, isNative } from '../../lib/native';

/**
 * Layar crop avatar: bingkai lingkaran tetap di tengah, foto digeser/dicubit (atau slider) di belakangnya.
 * Foto selalu menutupi bingkai.
 */
export function AvatarCropper({ photo, initial, onCancel, onApply }: { photo: Blob; initial: PhotoCrop | null | undefined; onCancel: () => void; onApply: (c: PhotoCrop) => void }) {
  const url = useMemo(() => URL.createObjectURL(photo), [photo]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const areaRef = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<{ w: number; h: number } | null>(null);
  const [frame, setFrame] = useState<{ cx: number; cy: number; d: number } | null>(null);
  const [t, setT] = useState<{ s: number; x: number; y: number } | null>(null);
  const tRef = useRef(t);
  tRef.current = t;

  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    if (isNative()) {
      const close = () => cancelRef.current();
      backStack.push(close);
      return () => {
        const i = backStack.lastIndexOf(close);
        if (i >= 0) backStack.splice(i, 1);
      };
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancelRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Ukur area dan pasang posisi awal dari potongan yang ada.
  useEffect(() => {
    if (!img || !areaRef.current) return;
    const r = areaRef.current.getBoundingClientRect();
    const d = Math.min(r.width, r.height) * 0.8;
    const f = { cx: r.width / 2, cy: r.height / 2, d };
    setFrame(f);
    const minSide = Math.min(img.w, img.h);
    const c = initial ?? { x: (img.w - minSide) / 2 / img.w, y: (img.h - minSide) / 2 / img.h, size: 1 };
    const s = d / (minSide * c.size);
    setT(fit({ s, x: f.cx - d / 2 - c.x * img.w * s, y: f.cy - d / 2 - c.y * img.h * s }, img, f));
  }, [img]); // eslint-disable-line react-hooks/exhaustive-deps

  const minScale = img && frame ? frame.d / Math.min(img.w, img.h) : 1;
  const maxScale = minScale * 6;

  function fit(v: { s: number; x: number; y: number }, im = img!, f = frame!) {
    const lo = f.d / Math.min(im.w, im.h);
    const s = Math.min(lo * 6, Math.max(lo, v.s));
    const left = f.cx - f.d / 2;
    const top = f.cy - f.d / 2;
    const x = Math.min(left, Math.max(left + f.d - im.w * s, v.x));
    const y = Math.min(top, Math.max(top + f.d - im.h * s, v.y));
    return { s, x, y };
  }
  /** Ubah skala di sekitar titik (px, py) di layar. */
  const zoomAt = (cur: { s: number; x: number; y: number }, s: number, px: number, py: number) => {
    const k = s / cur.s;
    return fit({ s, x: px - (px - cur.x) * k, y: py - (py - cur.y) * k });
  };

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const g = useRef<{ start: { s: number; x: number; y: number }; px: number; py: number; dist?: number; mx?: number; my?: number } | null>(null);
  const local = (e: React.PointerEvent) => {
    const r = areaRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent) => {
    if (!tRef.current) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    const ps = [...pointers.current.values()];
    if (ps.length >= 2) {
      g.current = { start: tRef.current, px: 0, py: 0, dist: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y), mx: (ps[0].x + ps[1].x) / 2, my: (ps[0].y + ps[1].y) / 2 };
    } else g.current = { start: tRef.current, px: ps[0].x, py: ps[0].y };
  };
  const move = (e: React.PointerEvent) => {
    if (!g.current || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, local(e));
    const ps = [...pointers.current.values()];
    const st = g.current.start;
    if (ps.length >= 2 && g.current.dist) {
      const k = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) / g.current.dist;
      const mx = (ps[0].x + ps[1].x) / 2;
      const my = (ps[0].y + ps[1].y) / 2;
      const z = zoomAt(st, st.s * k, g.current.mx!, g.current.my!);
      setT(fit({ ...z, x: z.x + mx - g.current.mx!, y: z.y + my - g.current.my! }));
    } else {
      setT(fit({ ...st, x: st.x + ps[0].x - g.current.px, y: st.y + ps[0].y - g.current.py }));
    }
  };
  const up = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const ps = [...pointers.current.values()];
    if (ps.length === 1 && tRef.current) g.current = { start: tRef.current, px: ps[0].x, py: ps[0].y };
    else if (!ps.length) g.current = null;
  };

  const apply = () => {
    if (!img || !frame || !t) return;
    const side = frame.d / t.s;
    onApply({
      x: (frame.cx - frame.d / 2 - t.x) / t.s / img.w,
      y: (frame.cy - frame.d / 2 - t.y) / t.s / img.h,
      size: side / Math.min(img.w, img.h),
    });
  };

  return createPortal(
    <div className="cropper" role="dialog" aria-label="Atur potongan avatar">
      <div className="cropper-area" ref={areaRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <img
          src={url}
          alt=""
          draggable={false}
          onLoad={(e) => setImg({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          style={t ? { width: img!.w, height: img!.h, transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})` } : { visibility: 'hidden' }}
        />
        {frame && <div className="cropper-frame" style={{ left: frame.cx - frame.d / 2, top: frame.cy - frame.d / 2, width: frame.d, height: frame.d }} />}
      </div>
      <div className="cropper-bar">
        <input
          type="range"
          aria-label="Zoom"
          min={0}
          max={1}
          step={0.001}
          value={t ? Math.log(t.s / minScale) / Math.log(maxScale / minScale) : 0}
          onChange={(e) => {
            if (!t || !frame) return;
            const s = minScale * Math.pow(maxScale / minScale, Number(e.target.value));
            setT(zoomAt(t, s, frame.cx, frame.cy));
          }}
        />
        <p className="note">Geser foto untuk mengatur posisi, cubit atau geser slider untuk zoom.</p>
        <div className="row-buttons">
          <button className="btn" onClick={onCancel}>
            Batal
          </button>
          <button className="btn btn-primary" disabled={!t} onClick={apply}>
            Pakai
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
