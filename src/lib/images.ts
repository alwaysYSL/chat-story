/**
 * Perkecil gambar sebelum disimpan. DeepSeek mengubah ukuran gambar menjadi kira-kira 1300×1300 piksel total,
 * jadi menyimpan lebih besar dari itu hanya memboroskan penyimpanan.
 */
const MAX_PIXELS = 1400 * 1400;
const MAX_SIDE = 2048;

export async function compressImage(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await createImageBitmap(file);
  let { width, height } = bmp;
  const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (width * height)), MAX_SIDE / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Gagal memproses gambar'))), 'image/jpeg', 0.85),
  );
  return { blob, width, height };
}

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const TEXT_EXT = /\.(txt|md|markdown)$/i;
export const MAX_TEXT_BYTES = 500_000;
