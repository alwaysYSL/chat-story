import { useEffect, useMemo } from 'react';
import { initials } from '../../lib/rp/cards';

/** Foto bulat dari blob, atau huruf awal nama. */
export function Avatar({ blob, name, size = 40, className = '' }: { blob: Blob | null | undefined; name: string; size?: number; className?: string }) {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return (
    <span className={'rp-avatar ' + className} style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden="true">
      {url ? <img src={url} alt="" draggable={false} /> : initials(name || '?')}
    </span>
  );
}
