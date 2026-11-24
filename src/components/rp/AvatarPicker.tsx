import { createPortal } from 'react-dom';
import { useRef, useState } from 'react';
import type { PhotoCrop } from '../../db';
import { cropAvatar, normalizePhoto, readWithProgress } from '../../lib/rp/photo';
import { IconImage, IconTrash } from '../Icons';
import { Sheet, SheetItem, toast } from '../ui';
import { AvatarCropper } from './AvatarCropper';
import { Avatar } from './Avatar';
import { showPhoto } from './PhotoViewer';

export interface PhotoValue {
  avatar: Blob | null;
  photo?: Blob | null;
  crop?: PhotoCrop | null;
}

/**
 * Avatar di editor: pilih foto (dengan indikator proses), atur potongan (crop), lihat, atau hapus.
 * Semua proses di HP; "unggah" = memilih foto dari galeri.
 */
export function AvatarPicker({
  value,
  name,
  size,
  onChange,
  onBusy,
}: {
  value: PhotoValue;
  name: string;
  size: number;
  onChange: (v: PhotoValue) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState(false);
  const [progress, setProgress] = useState<null | { phase: 'read' | 'process'; pct: number }>(null);
  const [crop, setCrop] = useState<null | { photo: Blob; initial: PhotoCrop | null | undefined; fresh: boolean }>(null);
  const photo = value.photo ?? value.avatar;
  const has = !!(value.avatar || value.photo);

  const busy = (b: boolean) => onBusy?.(b);
  const pick = async (f: File) => {
    busy(true);
    try {
      setProgress({ phase: 'read', pct: 0 });
      const raw = await readWithProgress(f, (p) => setProgress({ phase: 'read', pct: Math.round(p * 100) }));
      setProgress({ phase: 'process', pct: 100 });
      const n = await normalizePhoto(raw);
      setProgress(null);
      setCrop({ photo: n.blob, initial: null, fresh: true });
    } catch {
      setProgress(null);
      busy(false);
      toast('Gagal membaca foto. Pilih file gambar (JPG, PNG, WebP).');
    }
  };
  const apply = async (c: PhotoCrop) => {
    if (!crop) return;
    setProgress({ phase: 'process', pct: 100 });
    try {
      const avatar = await cropAvatar(crop.photo, c);
      onChange({ avatar, photo: crop.photo, crop: c });
    } catch {
      toast('Gagal memotong foto.');
    } finally {
      setProgress(null);
      setCrop(null);
      busy(false);
    }
  };

  return (
    <>
      <button className="rp-avatar-btn" aria-label="Foto" disabled={!!progress} onClick={() => (has ? setMenu(true) : fileRef.current?.click())}>
        <Avatar blob={value.avatar} name={name || '?'} size={size} />
        <span className="rp-avatar-cam">
          <IconImage size={size > 70 ? 16 : 14} />
        </span>
        {progress && <span className="rp-avatar-busy" />}
      </button>
      <input
        ref={fileRef}
        type="file"
        hidden
        accept="image/*"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void pick(f);
        }}
      />
      <Sheet open={menu} onClose={() => setMenu(false)} title="Foto">
        <SheetItem icon={<IconImage />} label="Ganti foto" onClick={() => { setMenu(false); fileRef.current?.click(); }} />
        <SheetItem
          icon={<IconImage />}
          label="Atur potongan"
          hint="Posisi dan zoom avatar bulat"
          disabled={!photo}
          onClick={() => {
            setMenu(false);
            if (photo) {
              busy(true);
              setCrop({ photo, initial: value.photo ? value.crop : null, fresh: false });
            }
          }}
        />
        <SheetItem icon={<IconImage />} label="Lihat foto" disabled={!photo} onClick={() => { setMenu(false); showPhoto(photo, name); }} />
        <SheetItem icon={<IconTrash />} label="Hapus foto" danger onClick={() => { setMenu(false); onChange({ avatar: null, photo: null, crop: null }); }} />
      </Sheet>
      {crop && (
        <AvatarCropper
          photo={crop.photo}
          initial={crop.initial}
          onCancel={() => {
            setCrop(null);
            busy(false);
          }}
          onApply={(c) => void apply(c)}
        />
      )}
      {progress &&
        createPortal(
          <div className="photo-progress" role="status">
            <span>{progress.phase === 'read' ? `Membaca foto… ${progress.pct}%` : 'Memproses foto…'}</span>
            <span className="photo-progress-bar">
              <span className={progress.phase === 'process' ? 'indeterminate' : ''} style={{ width: `${progress.pct}%` }} />
            </span>
          </div>,
          document.body,
        )}
    </>
  );
}
