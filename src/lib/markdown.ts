import type { JSONContent } from '@tiptap/react';

/**
 * Konversi antara teks Markdown sederhana dari model dan dokumen TipTap.
 * Hanya mendukung yang dipakai aplikasi: paragraf, judul bab (h2), pemisah adegan,
 * tebal, dan miring.
 *
 * Setiap blok di dokumen boleh punya atribut `seg` = id pesan AI yang menulisnya.
 * Blok tanpa `seg` (diketik manual) dianggap milik segmen di atasnya.
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

/** Indeks blok [start, end) milik segmen efektif `seg`. */
function segmentRange(blocks: Block[], seg: string): [number, number] | null {
  let start = -1;
  let end = -1;
  let cur: string | null = null;
  blocks.forEach((b, i) => {
    const s = (b.attrs?.seg as string | null | undefined) ?? null;
    if (s) cur = s;
    if (cur === seg) {
      if (start < 0) start = i;
      end = i + 1;
    }
  });
  return start < 0 ? null : [start, end];
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

export function replaceSegment(doc: JSONContent, seg: string, next: Block[]): JSONContent {
  const blocks = docBlocks(doc);
  const r = segmentRange(blocks, seg);
  if (!r) return appendBlocks(doc, next);
  const content = [...blocks.slice(0, r[0]), ...next, ...blocks.slice(r[1])];
  return { type: 'doc', content: content.length ? content : emptyDoc().content };
}

export function removeSegment(doc: JSONContent, seg: string): JSONContent {
  return replaceSegment(doc, seg, []);
}

export function segmentText(doc: JSONContent | undefined, seg: string): string | null {
  const g = groupSegments(doc).segs.get(seg);
  if (!g) return null;
  const s = serializeBlocks(g.blocks);
  return s.trim() ? s : null;
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
const PREAMBLE_RE =
  /^(berikut|tentu|baik|oke|ok|siap|ini (dia|adalah)|here is|sure)\b.*(:|lanjutan|pembukaan|cerita)\W*$/i;

export interface CleanResult {
  title: string | null;
  body: string;
  /** true kalau baris pertama belum lengkap (masih streaming) dan sengaja ditahan */
  pending: boolean;
}

/**
 * Pisahkan judul (kalau diminta) dan buang kalimat pembuka seperti "Berikut lanjutannya:".
 * `final` = false selama streaming: baris pertama yang belum selesai ditahan dulu.
 */
export function cleanOutput(raw: string, expectTitle: boolean, final: boolean): CleanResult {
  let text = raw.replace(/\r/g, '');
  let title: string | null = null;
  const firstNl = text.indexOf('\n');
  const firstLine = (firstNl < 0 ? text : text.slice(0, firstNl)).trim();

  if (!final && firstNl < 0 && firstLine.length < 160) {
    // Baris pertama belum selesai; bisa jadi judul atau kalimat pembuka.
    return { title: null, body: '', pending: true };
  }

  if (expectTitle) {
    const m = firstLine.match(TITLE_RE);
    const h = firstLine.match(/^#{1,6}\s+(.+)$/);
    if (m) {
      title = m[1].replace(/\*+/g, '').replace(/^["“]|["”]$/g, '').trim();
      text = firstNl < 0 ? '' : text.slice(firstNl + 1);
    } else if (h) {
      title = h[1].replace(/\*+/g, '').trim();
      text = firstNl < 0 ? '' : text.slice(firstNl + 1);
    }
  }

  const trimmed = text.replace(/^\s+/, '');
  const nl = trimmed.indexOf('\n');
  const line = (nl < 0 ? trimmed : trimmed.slice(0, nl)).trim();
  if (line.length <= 140 && PREAMBLE_RE.test(line)) {
    text = nl < 0 ? '' : trimmed.slice(nl + 1);
  }

  return { title, body: text.replace(/^\s+/, ''), pending: false };
}
