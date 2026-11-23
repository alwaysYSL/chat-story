import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useNavigate } from 'react-router-dom';
import { IconChat, IconEdit, IconHome, IconSearch, IconSparkle } from './Icons';
import { createStory } from '../lib/pages';

/* ---------- Toast ---------- */

let toastMsg: { id: number; text: string } | null = null;
const toastListeners = new Set<() => void>();
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function toast(text: string) {
  toastMsg = { id: Date.now(), text };
  toastListeners.forEach((l) => l());
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastMsg = null;
    toastListeners.forEach((l) => l());
  }, 3200);
}

export function ToastHost() {
  const msg = useSyncExternalStore(
    (l) => {
      toastListeners.add(l);
      return () => toastListeners.delete(l);
    },
    () => toastMsg,
  );
  if (!msg) return null;
  return (
    <div className="toast" role="status" key={msg.id}>
      {msg.text}
    </div>
  );
}

/* ---------- Bottom sheet ---------- */

interface CloseWatcherLike {
  onclose: (() => void) | null;
  destroy(): void;
}

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    // Tombol back Android (dan Esc) menutup sheet paling atas dulu, bukan meninggalkan halaman.
    // CloseWatcher didukung Chrome Android; tanpa itu, cukup Esc.
    const CW = (window as unknown as { CloseWatcher?: new () => CloseWatcherLike }).CloseWatcher;
    if (CW) {
      let watcher: CloseWatcherLike | null = null;
      try {
        watcher = new CW();
        watcher.onclose = () => closeRef.current();
      } catch {
        watcher = null;
      }
      if (watcher) return () => watcher!.destroy();
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        {title && <div className="sheet-title">{title}</div>}
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function SheetItem({
  icon,
  label,
  hint,
  danger,
  disabled,
  onClick,
}: {
  icon?: ReactNode;
  label: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button className={'sheet-item' + (danger ? ' danger' : '')} onClick={onClick} disabled={disabled}>
      {icon && <span className="sheet-icon">{icon}</span>}
      <span className="sheet-label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </button>
  );
}

/* ---------- Dialog konfirmasi ---------- */

export function ConfirmSheet({
  open,
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="confirm-msg">{message}</div>
      <div className="row-buttons">
        <button className="btn" onClick={onClose}>
          Batal
        </button>
        <button
          className={'btn ' + (danger ? 'btn-danger' : 'btn-primary')}
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}

/* ---------- Input teks dalam sheet ---------- */

export function PromptSheet({
  open,
  title,
  initial,
  multiline,
  confirmLabel = 'Simpan',
  placeholder,
  note,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  initial: string;
  multiline?: boolean;
  confirmLabel?: string;
  placeholder?: string;
  note?: ReactNode;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {multiline ? (
        <textarea
          className="input textarea-lg"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
      ) : (
        <input
          className="input"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onSubmit(value);
              onClose();
            }
          }}
          autoFocus
        />
      )}
      {note && <p className="note">{note}</p>}
      <div className="row-buttons">
        <button className="btn" onClick={onClose}>
          Batal
        </button>
        <button
          className="btn btn-primary"
          onClick={() => {
            onSubmit(value);
            onClose();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}

/* ---------- Navigasi atas & bawah ---------- */

export function TopTabs() {
  return (
    <div className="top-tabs">
      <NavLink to="/settings" className="avatar" aria-label="Pengaturan">
        CS
      </NavLink>
      <NavLink to="/" end className={({ isActive }) => 'tab-pill' + (isActive ? ' active' : '')} aria-label="Beranda">
        <IconHome size={20} />
      </NavLink>
      <NavLink to="/chats" className={({ isActive }) => 'tab-pill' + (isActive ? ' active' : '')} aria-label="Chat">
        <IconChat size={20} />
      </NavLink>
    </div>
  );
}

export function BottomBar({ askHref, askState }: { askHref: string; askState?: unknown }) {
  const nav = useNavigate();
  return (
    <div className="bottom-bar">
      <button className="round-btn" aria-label="Cari" onClick={() => nav('/search')}>
        <IconSearch />
      </button>
      <button className="ask-ai" onClick={() => nav(askHref, askState ? { state: askState } : undefined)}>
        <span className="ask-ai-icon">
          <IconSparkle size={16} />
        </span>
        Ask AI
      </button>
      <button
        className="round-btn"
        aria-label="Page baru"
        onClick={async () => {
          const p = await createStory('');
          nav(`/page/${p.id}?new=1`);
        }}
      >
        <IconEdit />
      </button>
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={'toggle' + (checked ? ' on' : '')}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-knob" />
    </button>
  );
}

/* ---------- Tahan lama (long press) ---------- */

/**
 * Tahan ±0,5 detik untuk membuka menu aksi. Batal kalau jari bergeser (menggulir).
 * Klik kanan / menu konteks bawaan Android juga membuka menu yang sama.
 */
export function useLongPress(onLong: () => void, ms = 480) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const fire = () => {
    fired.current = true;
    navigator.vibrate?.(12);
    onLong();
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      clear();
      timer.current = window.setTimeout(fire, ms);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      if (fired.current) return;
      clear();
      fire();
    },
    onClickCapture: (e: React.MouseEvent) => {
      // Jangan teruskan "klik" yang terjadi saat jari dilepas setelah menahan.
      if (fired.current) {
        e.preventDefault();
        e.stopPropagation();
        fired.current = false;
      }
    },
  };
}
