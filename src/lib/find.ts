import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Transform } from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { JSONContent } from '@tiptap/react';

/** Cari & ganti di naskah. Pencarian per paragraf (tidak melewati batas paragraf). */

export interface FindQuery {
  text: string;
  caseSensitive: boolean;
  wholeWord: boolean;
}

export interface Match {
  from: number;
  to: number;
}

export function buildRegex(q: FindQuery): RegExp | null {
  if (!q.text) return null;
  const esc = q.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const src = q.wholeWord ? `(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])` : esc;
  return new RegExp(src, 'gu' + (q.caseSensitive ? '' : 'i'));
}

/** Semua kecocokan di dokumen. Satu karakter teks = satu posisi, node inline lain (mis. baris baru) = satu karakter pengganti. */
export function findMatches(doc: PMNode, q: FindQuery): Match[] {
  const re = buildRegex(q);
  if (!re) return [];
  const out: Match[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const text = node.textBetween(0, node.content.size, undefined, '\uFFFC');
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (!m[0].length) {
        re.lastIndex++;
        continue;
      }
      out.push({ from: pos + 1 + m.index, to: pos + 1 + m.index + m[0].length });
    }
    return false;
  });
  return out;
}

/** Ganti kecocokan (dari belakang supaya posisi yang belum diganti tidak bergeser). */
export function replaceMatches(tr: Transform, matches: Match[], replacement: string): void {
  for (let i = matches.length - 1; i >= 0; i--) {
    const { from, to } = matches[i];
    if (replacement) {
      // Pertahankan format (tebal/miring) teks yang diganti.
      const marks = tr.doc.resolve(from + 1).marks();
      tr.replaceWith(from, to, tr.doc.type.schema.text(replacement, marks));
    } else tr.delete(from, to);
  }
}

/** Ganti semua di dokumen JSON (page lain dalam cerita). Mengembalikan null kalau tidak ada yang cocok. */
export function replaceInJson(schema: Schema, json: JSONContent, q: FindQuery, replacement: string): { doc: JSONContent; count: number } | null {
  let doc: PMNode;
  try {
    doc = schema.nodeFromJSON(json);
  } catch {
    return null;
  }
  const matches = findMatches(doc, q);
  if (!matches.length) return null;
  const tr = new Transform(doc);
  replaceMatches(tr, matches, replacement);
  return { doc: tr.doc.toJSON() as JSONContent, count: matches.length };
}

export function countInJson(schema: Schema, json: JSONContent, q: FindQuery): number {
  try {
    return findMatches(schema.nodeFromJSON(json), q).length;
  } catch {
    return 0;
  }
}

/* ---------- Sorotan di editor ---------- */

interface FindState {
  query: FindQuery | null;
  matches: Match[];
  current: number;
}

export const findKey = new PluginKey<FindState>('find');

type FindMeta = { query: FindQuery | null; current?: number } | { current: number };

export function findPlugin(): Plugin<FindState> {
  return new Plugin<FindState>({
    key: findKey,
    state: {
      init: () => ({ query: null, matches: [], current: 0 }),
      apply(tr, prev, _old, state) {
        const meta = tr.getMeta(findKey) as FindMeta | undefined;
        let next = prev;
        if (meta && 'query' in meta) {
          const matches = meta.query ? findMatches(state.doc, meta.query) : [];
          next = { query: meta.query, matches, current: clamp(meta.current ?? 0, matches.length) };
        } else if (meta) {
          next = { ...prev, current: clamp(meta.current, prev.matches.length) };
        }
        if (tr.docChanged && next.query && next === prev) {
          const matches = findMatches(state.doc, next.query);
          next = { ...next, matches, current: clamp(next.current, matches.length) };
        }
        return next;
      },
    },
    props: {
      decorations(state) {
        const s = findKey.getState(state);
        if (!s || !s.matches.length) return null;
        return DecorationSet.create(
          state.doc,
          s.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: 'find-hit' + (i === s.current ? ' current' : '') })),
        );
      },
    },
  });
}

function clamp(i: number, n: number): number {
  if (!n) return 0;
  return ((i % n) + n) % n;
}

export function getFindState(state: EditorState): FindState | undefined {
  return findKey.getState(state);
}

export function setFindMeta(tr: Transaction, meta: FindMeta): Transaction {
  return tr.setMeta(findKey, meta).setMeta('addToHistory', false);
}
