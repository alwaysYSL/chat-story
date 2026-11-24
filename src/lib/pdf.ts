/**
 * Ambil teks dari PDF di HP (pdf.js, dimuat hanya saat dibutuhkan).
 * PDF hasil scan (gambar saja) tidak punya teks; OCR belum didukung.
 */

export interface PdfText {
  text: string;
  pages: number;
}

export async function pdfToText(file: Blob): Promise<PdfText> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  try {
    const out: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let s = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        s += item.str;
        if (item.hasEOL) s += '\n';
      }
      page.cleanup();
      const t = tidy(s);
      if (t) out.push(t);
    }
    return { text: out.join('\n\n'), pages: doc.numPages };
  } finally {
    void task.destroy();
  }
}

/** Rapikan baris: gabungkan baris yang terpotong di tengah kalimat, pertahankan paragraf. */
function tidy(s: string): string {
  return s
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    // Kata berulang (kupu-kupu) sering terpotong di tanda hubung: sambung tanpa membuang tanda hubungnya.
    .replace(/(\S)-\n(\p{Ll})/gu, '$1-$2')
    .replace(/([^\n.!?:"”’)])\n(?=\p{Ll})/gu, '$1 ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
