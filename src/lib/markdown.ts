import type { JSONContent } from '@tiptap/react';

/**
 * Konversi antara teks Markdown sederhana dari model dan dokumen TipTap.
 * Hanya mendukung yang dipakai aplikasi: paragraf, judul bab (h2), pemisah adegan,
 * tebal, dan miring.
 *
 * Setiap blok di dokumen boleh punya atribut `seg` = id pesan AI yang menulisnya.
 * - Untuk KONTEKS AI, blok tanpa `seg` (diketik penulis) ikut dibaca bersama balasan AI di atasnya
 *   (`groupSegments`).
 * - Untuk MENGUBAH naskah (coba lagi, batalkan, ganti versi), hanya blok yang benar-benar ditulis AI
 *   (`seg` = id balasan) yang diganti; paragraf penulis tidak pernah ikut terhapus.
 */

export type Block = JSONContent;

const HR_RE = /^\s*((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})\s*$/;
const HEADING_RE = /^\s*#{1,6}\s+(.*)$/;
const INLINE_RE =
  /\*\*\*([^*\n]+?)\*\*\*|\*\*([^*\n]+?)\*\*|\*([^*\s](?:[^*\n]*?[^*\s])?)\*|(?<![\p{L}\p{N}_])_([^_\s](?:[^_\n]*?[^_\s])?)_(?![\p{L}\p{N}_])/gu;

type Mark = { type: 'bold' } | { type: 'italic' };

function textNode(text: string, marks: Mark[]): JSONContent {
  return marks.length ? { type: 'text', text, marks } : { type: 'text', text };
}

export function parseInline(s: string): JSONContent[] {
  const out: JSONContent[] = [];
  let last = 0;
  for (const m of s.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(textNode(s.slice(last, idx), []));
    if (m[1] !== undefined) out.push(textNode(m[1], [{ type: 'bold' }, { type: 'italic' }]));
    else if (m[2] !== undefined) out.push(textNode(m[2], [{ type: 'bold' }]));
    else if (m[3] !== undefined) out.push(textNode(m[3], [{ type: 'italic' }]));
    else if (m[4] !== undefined) out.push(textNode(m[4], [{ type: 'italic' }]));
    last = idx + m[0].length;
  }
  if (last < s.length) out.push(textNode(s.slice(last), []));
  return out.filter((n) => n.text);
}

/** Ubah teks Markdown menjadi blok TipTap. Setiap baris tidak kosong = satu blok. */
export function parseMarkdown(md: string, seg: string | null): Block[] {
  const blocks: Block[] = [];
  for (const rawLine of md.replace(/\r/g, '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (HR_RE.test(line)) {
      blocks.push({ type: 'horizontalRule', attrs: { seg } });
      continue;
    }
    const h = line.match(HEADING_RE);
    if (h) {
      const content = parseInline(h[1].trim());
      blocks.push({ type: 'heading', attrs: { level: 2, seg }, ...(content.length ? { content } : {}) });
      continue;
    }
    const content = parseInline(line);
    blocks.push({ type: 'paragraph', attrs: { seg }, ...(content.length ? { content } : {}) });
  }
  return blocks;
}

function serializeInline(nodes: JSONContent[] | undefined): string {
  if (!nodes) return '';
  let s = '';
  for (const n of nodes) {
    if (n.type === 'hardBreak') {
      s += '\n';
      continue;
    }
    if (n.type !== 'text' || !n.text) continue;
    const bold = n.marks?.some((m) => m.type === 'bold');
    const italic = n.marks?.some((m) => m.type === 'italic');
    const marker = bold && italic ? '***' : bold ? '**' : italic ? '*' : '';
    if (!marker || !n.text.trim()) {
      s += n.text;
      continue;
    }
    const lead = n.text.match(/^\s*/)![0];
    const trail = n.text.match(/\s*$/)![0];
    s += lead + marker + n.text.trim() + marker + trail;
  }
  return s;
}

export function serializeBlock(b: Block): string {
  if (b.type === 'horizontalRule') return '***';
  if (b.type === 'heading') return '## ' + serializeInline(b.content);
  return serializeInline(b.content);
}

/** Blok → Markdown. Blok kosong dilewati. */
export function serializeBlocks(blocks: Block[]): string {
  return blocks
    .map(serializeBlock)
    .filter((s) => s.trim() !== '')
    .join('\n\n');
}

function inlineText(nodes: JSONContent[] | undefined): string {
  if (!nodes) return '';
  return nodes.map((n) => (n.type === 'hardBreak' ? '\n' : (n.text ?? ''))).join('');
}

export function blockText(b: Block): string {
  if (b.type === 'horizontalRule') return '***';
  return inlineText(b.content);
}

export function docBlocks(doc: JSONContent | undefined): Block[] {
  return doc?.content ?? [];
}

export function plainText(doc: JSONContent | undefined): string {
  return docBlocks(doc)
    .map(blockText)
    .filter((s) => s.trim() !== '')
    .join('\n\n');
}

export function emptyDoc(): JSONContent {
  return { type: 'doc', content: [{ type: 'paragraph', attrs: { seg: null } }] };
}

export function isDocEmpty(doc: JSONContent | undefined): boolean {
  return plainText(doc).trim() === '';
}

export interface SegmentGroups {
  /** blok manual sebelum segmen AI pertama */
  leading: Block[];
  segs: Map<string, { first: number; blocks: Block[] }>;
}

/** Kelompokkan blok menurut segmen efektif (blok manual ikut segmen di atasnya). */
export function groupSegments(doc: JSONContent | undefined): SegmentGroups {
  const leading: Block[] = [];
  const segs = new Map<string, { first: number; blocks: Block[] }>();
  let cur: string | null = null;
  docBlocks(doc).forEach((b, i) => {
    const s = (b.attrs?.seg as string | null | undefined) ?? null;
    if (s) cur = s;
    if (!cur) {
      leading.push(b);
      return;
    }
    const g = segs.get(cur);
    if (g) g.blocks.push(b);
    else segs.set(cur, { first: i, blocks: [b] });
  });
  return { leading, segs };
}

function segOf(b: Block): string | null {
  return (b.attrs?.seg as string | null | undefined) ?? null;
}

/** Indeks blok yang ditulis oleh balasan `seg` (termasuk placeholder kosong). */
function ownedIndices(blocks: Block[], seg: string): number[] {
  const out: number[] = [];
  blocks.forEach((b, i) => {
    if (segOf(b) === seg) out.push(i);
  });
  return out;
}

function withoutTrailingEmpty(blocks: Block[]): Block[] {
  const out = [...blocks];
  while (out.length) {
    const b = out[out.length - 1];
    if (b.type === 'paragraph' && !inlineText(b.content).trim()) out.pop();
    else break;
  }
  return out;
}

export function appendBlocks(doc: JSONContent, add: Block[]): JSONContent {
  const base = withoutTrailingEmpty(docBlocks(doc));
  const content = [...base, ...add];
  return { type: 'doc', content: content.length ? content : emptyDoc().content };
}

/**
 * Ganti blok milik balasan `seg` dengan `next`. Blok baru diletakkan di posisi blok pertama milik balasan itu;
 * paragraf penulis (tanpa `seg`) dan balasan lain tidak disentuh. Kalau balasan belum ada di naskah,
 * blok ditambahkan di akhir.
 */
export function replaceSegment(doc: JSONContent, seg: string, next: Block[]): JSONContent {
  const blocks = docBlocks(doc);
  const owned = ownedIndices(blocks, seg);
  if (!owned.length) return appendBlocks(doc, next);
  const ownedSet = new Set(owned);
  const content: Block[] = [];
  blocks.forEach((b, i) => {
    if (i === owned[0]) content.push(...next);
    if (!ownedSet.has(i)) content.push(b);
  });
  return { type: 'doc', content: content.length ? content : emptyDoc().content };
}

export function removeSegment(doc: JSONContent, seg: string): JSONContent {
  return replaceSegment(doc, seg, []);
}

/** Penanda posisi selama balasan ditulis ulang, supaya tulisan baru kembali ke tempat yang sama. */
export function placeholderBlock(seg: string): Block {
  return { type: 'paragraph', attrs: { seg } };
}

/** Teks yang benar-benar ditulis AI untuk balasan `seg` (termasuk editan penulis di dalamnya). */
export function ownedText(doc: JSONContent | undefined, seg: string): string | null {
  const blocks = docBlocks(doc);
  const s = serializeBlocks(ownedIndices(blocks, seg).map((i) => blocks[i]));
  return s.trim() ? s : null;
}

/** Ada balasan `seg` di naskah (walaupun hanya placeholder). */
export function hasSegment(doc: JSONContent | undefined, seg: string): boolean {
  return docBlocks(doc).some((b) => segOf(b) === seg);
}

/**
 * Paragraf yang ditulis penulis sendiri setelah balasan `seg` mulai (sampai balasan AI lain dimulai).
 * Dipakai saat menulis ulang supaya tulisan baru nyambung ke paragraf penulis.
 */
export function trailingManualText(doc: JSONContent | undefined, seg: string): string {
  const out: Block[] = [];
  let cur: string | null = null;
  for (const b of docBlocks(doc)) {
    const s = segOf(b);
    if (s) cur = s;
    if (cur === seg && s !== seg) out.push(b);
  }
  return serializeBlocks(out);
}

/** Hapus atribut `seg` dari blok (teks tempelan dianggap tulisan penulis). */
export function stripSegments(blocks: Block[]): Block[] {
  return blocks.map((b) => (segOf(b) ? { ...b, attrs: { ...b.attrs, seg: null } } : b));
}

/** Ganti id segmen (dipakai saat menduplikat cerita). */
export function remapSegments(doc: JSONContent, map: Map<string, string>): JSONContent {
  return {
    ...doc,
    content: docBlocks(doc).map((b) => {
      const s = b.attrs?.seg as string | undefined;
      return s && map.has(s) ? { ...b, attrs: { ...b.attrs, seg: map.get(s) } } : b;
    }),
  };
}

/* ---------- Pembersihan keluaran model ---------- */

const TITLE_RE = /^\s*(?:#{1,6}\s*)?\**\s*(?:judul|title)\s*:\s*\**\s*(.+?)\s*\**\s*$/i;
const PREAMBLE_KEYWORD =
  /\b(lanjutan|lanjutannya|pembukaan|pembukaannya|cerita|ceritanya|bab|versi|tulisan|naskah|bagian|adegan|continuation|story|chapter)\b/i;
/** "Berikut lanjutannya:", "Here's the next part" */
const PREAMBLE_LEAD = /^(berikut|here(?:'s| is))\b/i;
/** "Tentu! …:", "Baik, …:", "Oke. …:" — kata sapaan langsung diikuti tanda baca */
const PREAMBLE_ACK = /^(tentu|baik|oke|ok|siap|sure|certainly|of course)[!,.]/i;

/** Baris pertama yang jelas komentar AI, bukan bagian cerita. */
export function isPreamble(line: string): boolean {
  const l = line.trim();
  if (!l || l.length > 160) return false;
  if (PREAMBLE_LEAD.test(l)) return PREAMBLE_KEYWORD.test(l);
  if (PREAMBLE_ACK.test(l)) return PREAMBLE_KEYWORD.test(l) && /:\s*\**$/.test(l);
  return false;
}

export interface CleanResult {
  title: string | null;
  body: string;
  /** true kalau baris pertama belum lengkap (masih streaming) dan sengaja ditahan */
  pending: boolean;
}

function splitFirstLine(text: string): [string, string | null] {
  const nl = text.indexOf('\n');
  return nl < 0 ? [text, null] : [text.slice(0, nl), text.slice(nl + 1)];
}

/**
 * Buang kalimat pembuka seperti "Berikut lanjutannya:" lalu pisahkan judul (kalau diminta).
 * Baris kosong di awal diabaikan. `final` = false selama streaming: baris yang belum selesai ditahan dulu.
 */
export function cleanOutput(raw: string, expectTitle: boolean, final: boolean): CleanResult {
  let text = raw.replace(/\r/g, '').replace(/^\s+/, '');
  let title: string | null = null;
  // Maksimal satu kalimat pembuka, lalu judul.
  for (let step = 0; step < 2; step++) {
    const [line, rest] = splitFirstLine(text);
    if (!final && rest === null && line.length < 160) return { title: null, body: '', pending: true };
    if (step === 0 && isPreamble(line)) {
      text = (rest ?? '').replace(/^\s+/, '');
      continue;
    }
    if (expectTitle) {
      const m = line.trim().match(TITLE_RE);
      const h = line.trim().match(/^#{1,6}\s+(.+)$/);
      if (m) {
        title = m[1].replace(/\*+/g, '').replace(/^["“]|["”]$/g, '').trim();
        text = (rest ?? '').replace(/^\s+/, '');
      } else if (h) {
        title = h[1].replace(/\*+/g, '').trim();
        text = (rest ?? '').replace(/^\s+/, '');
      }
    }
    break;
  }
  return { title, body: text, pending: false };
}

/** Isi naskah dari sebuah versi. Versi yang sudah bersih (hasil editan penulis) tidak dibersihkan ulang. */
export function versionBody(v: { raw: string; clean?: boolean }, expectTitle: boolean): string {
  return v.clean ? v.raw : cleanOutput(v.raw, expectTitle, true).body;
}

/* ---------- HTML sederhana (untuk tulisan AI yang sedang mengalir) ---------- */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inlineHtml(nodes: JSONContent[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      let h = escapeHtml(n.text ?? '');
      if (n.marks?.some((m) => m.type === 'italic')) h = `<em>${h}</em>`;
      if (n.marks?.some((m) => m.type === 'bold')) h = `<strong>${h}</strong>`;
      return h;
    })
    .join('');
}

export function blocksToHtml(blocks: Block[]): string {
  return blocks
    .map((b) => {
      if (b.type === 'horizontalRule') return '<hr>';
      if (b.type === 'heading') return `<h2>${inlineHtml(b.content)}</h2>`;
      return `<p>${inlineHtml(b.content)}</p>`;
    })
    .join('');
}
