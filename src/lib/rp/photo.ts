import type { PhotoCrop } from '../../db';

/** Foto avatar: foto asli diperkecil (untuk dilihat utuh) dan avatar persegi yang dipotong darinya. */

export const PHOTO_MAX = 1600;
export const AVATAR_SIDE = 512;

/** Baca file dengan laporan kemajuan (0–1). */
export function readWithProgress(file: Blob, onProgress: (p: number) => void): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onprogress = (e) => {
      if (e.lengthComputable && e.total) onProgress(e.loaded / e.total);
    };
    r.onerror = () => reject(new Error('Gagal membaca foto.'));
    r.onload = () => {
      onProgress(1);
      resolve(new Blob([r.result as ArrayBuffer], { type: file.type || 'image/jpeg' }));
    };
    r.readAsArrayBuffer(file);
  });
}

function toBlob(canvas: HTMLCanvasElement, type: string, q: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Gagal memproses foto.'))), type, q));
}

/** Perkecil foto (sisi terpanjang maks. 1600 px). WebP supaya transparansi kartu PNG tetap. */
export async function normalizePhoto(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, PHOTO_MAX / Math.max(bmp.width, bmp.height));
  const width = Math.max(1, Math.round(bmp.width * scale));
  const height = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  let blob = await toBlob(canvas, 'image/webp', 0.9);
  if (blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', 0.9);
  return { blob, width, height };
}

export async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const bmp = await createImageBitmap(blob);
  const r = { width: bmp.width, height: bmp.height };
  bmp.close();
  return r;
}

/** Potongan bawaan: persegi terbesar; foto potret diambil agak ke atas (biasanya wajah). */
export function defaultCrop(width: number, height: number): PhotoCrop {
  const side = Math.min(width, height);
  const x = (width - side) / 2 / width;
  const y = height > width ? ((height - side) * 0.15) / height : (height - side) / 2 / height;
  return { x, y, size: 1 };
}

/** Potongan dalam piksel foto. */
export function cropRect(width: number, height: number, c: PhotoCrop) {
  const side = Math.min(width, height) * Math.min(1, Math.max(0.05, c.size));
  const x = Math.min(Math.max(0, c.x * width), width - side);
  const y = Math.min(Math.max(0, c.y * height), height - side);
  return { x, y, side };
}

export async function cropAvatar(photo: Blob, c: PhotoCrop): Promise<Blob> {
  const bmp = await createImageBitmap(photo);
  const r = cropRect(bmp.width, bmp.height, c);
  const size = Math.min(AVATAR_SIDE, Math.round(r.side));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(bmp, r.x, r.y, r.side, r.side, 0, 0, size, size);
  bmp.close();
  return toBlob(canvas, 'image/jpeg', 0.88);
}

/** Foto baru → foto asli + potongan bawaan + avatar. */
export async function photoFromFile(file: Blob): Promise<{ photo: Blob; crop: PhotoCrop; avatar: Blob }> {
  const n = await normalizePhoto(file);
  const crop = defaultCrop(n.width, n.height);
  return { photo: n.blob, crop, avatar: await cropAvatar(n.blob, crop) };
}
