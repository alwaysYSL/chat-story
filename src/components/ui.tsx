import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
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

export function BottomBar({ askHref }: { askHref: string }) {
  const nav = useNavigate();
  return (
    <div className="bottom-bar">
      <button className="round-btn" aria-label="Cari" onClick={() => nav('/search')}>
        <IconSearch />
      </button>
      <button className="ask-ai" onClick={() => nav(askHref)}>
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
