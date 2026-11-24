import { useEffect, useMemo } from 'react';
import { initials } from '../../lib/rp/cards';
import { showPhoto } from './PhotoViewer';

/**
 * Foto bulat dari blob, atau huruf awal nama. Dengan `view`, ketuk avatar membuka jendela foto
 * (foto asli kalau ada) tanpa memicu tombol di sekitarnya.
 */
export function Avatar({
  blob,
  name,
  size = 40,
  className = '',
  view,
}: {
  blob: Blob | null | undefined;
  name: string;
  size?: number;
  className?: string;
  view?: Blob | null;
}) {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  const pic = view ?? blob;
  if (view !== undefined && pic) {
    return (
      <span
        className={'rp-avatar tappable ' + className}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
        role="button"
        tabIndex={0}
        aria-label={`Lihat foto ${name}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          showPhoto(pic, name);
        }}
      >
        {url ? <img src={url} alt="" draggable={false} /> : initials(name || '?')}
      </span>
    );
  }
  return (
    <span className={'rp-avatar ' + className} style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden="true">
      {url ? <img src={url} alt="" draggable={false} /> : initials(name || '?')}
    </span>
  );
}
