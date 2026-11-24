import { EditorContent, Extension, useEditor, type Editor as TEditor } from '@tiptap/react';
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef, useState } from 'react';
import type { Page } from '../db';
import { registerFlush } from '../lib/editors';
import { findPlugin } from '../lib/find';
import { blocksToHtml, parseMarkdown, serializeBlocks, type Block } from '../lib/markdown';
import { rootIdOf, savePageDoc } from '../lib/pages';
import { debounce } from '../lib/util';
import { IconCheck, IconRedo, IconSparkle, IconUndo, IconUser } from './Icons';
import { RewriteSheet, type RewriteTarget } from './StoryTools';
import { toast } from './ui';

/** Meta transaksi untuk perubahan dari luar editor (AI menulis, ganti versi, batalkan). */
const EXTERNAL = 'chatStoryExternal';

/**
 * Atribut `seg` di setiap blok: id balasan AI yang menulisnya.
 * - Enter di tengah paragraf AI: kedua potongan tetap milik AI (keepOnSplit).
 * - Paragraf kosong baru (Enter di akhir paragraf, atau isinya dihapus semua) menjadi milik penulis.
 * - Teks yang ditempel selalu milik penulis.
 */
const SegAttr = Extension.create({
  name: 'segAttr',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading', 'horizontalRule'],
        attributes: {
          seg: {
            default: null,
            keepOnSplit: true,
            parseHTML: (el) => el.getAttribute('data-seg'),
            renderHTML: (attrs) => (attrs.seg ? { 'data-seg': attrs.seg } : {}),
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('segOwnership'),
        appendTransaction(trs, _old, state) {
          if (!trs.some((tr) => tr.docChanged && !tr.getMeta(EXTERNAL))) return null;
          const { $head } = state.selection;
          if ($head.depth < 1) return null;
          const node = $head.node(1);
          if (!node.isTextblock || node.content.size > 0 || !node.attrs.seg) return null;
          return state.tr.setNodeMarkup($head.before(1), undefined, { ...node.attrs, seg: null });
        },
        props: {
          transformPasted(slice) {
            const strip = (frag: Fragment): Fragment => {
              const nodes: PMNode[] = [];
              frag.forEach((n) => nodes.push(n.attrs.seg ? n.type.create({ ...n.attrs, seg: null }, n.content, n.marks) : n));
              return Fragment.fromArray(nodes);
            };
            return new Slice(strip(slice.content), slice.openStart, slice.openEnd);
          },
          transformPastedHTML(html) {
            // Tempelan dari luar aplikasi (mis. Notion): judul jadi paragraf tebal, daftar jadi paragraf berawalan "–",
            // supaya tidak berubah tanpa sengaja menjadi judul bab.
            if (html.includes('data-pm-slice')) return html;
            return html
              .replace(/<h[1-6]\b[^>]*>/gi, '<p><strong>')
              .replace(/<\/h[1-6]>/gi, '</strong></p>')
              .replace(/<li\b[^>]*>/gi, '<p>– ')
              .replace(/<\/li>/gi, '</p>');
          },
        },
      }),
    ];
  },
});

const FindHighlight = Extension.create({
  name: 'findHighlight',
  addProseMirrorPlugins() {
    return [findPlugin()];
  },
});

export interface StreamInfo {
  seg: string;
  text: string;
  thinking: boolean;
}

const streamKey = new PluginKey<StreamInfo | null>('stream');

/** Tulisan AI yang sedang mengalir ditampilkan di posisi akhirnya di naskah (bukan selalu di akhir page). */
const StreamWidget = Extension.create({
  name: 'streamWidget',
  addProseMirrorPlugins() {
    return [
      new Plugin<StreamInfo | null>({
        key: streamKey,
        state: {
          init: () => null,
          apply: (tr, prev) => {
            const meta = tr.getMeta(streamKey);
            return meta === undefined ? prev : (meta as StreamInfo | null);
          },
        },
        props: {
          decorations(state) {
            const info = streamKey.getState(state);
            if (!info) return null;
            let pos = state.doc.content.size;
            state.doc.forEach((node, offset) => {
              if (node.attrs.seg === info.seg) pos = offset + node.nodeSize;
            });
            const html = blocksToHtml(parseMarkdown(info.text, null));
            const widget = Decoration.widget(
              pos,
              () => {
                const el = document.createElement('div');
                el.className = 'stream-widget';
                el.contentEditable = 'false';
                el.innerHTML =
                  html + `<div class="typing"><span></span><span></span><span></span>${info.thinking ? ' AI sedang berpikir…' : ''}</div>`;
                return el;
              },
              { side: 1, key: `stream-${info.text.length}-${info.thinking ? 1 : 0}` },
            );
            return DecorationSet.create(state.doc, [widget]);
          },
        },
      }),
    ];
  },
});

export function StoryEditor({
  page,
  editable,
  stream,
  onFocusChange,
  onReady,
  onEditor,
}: {
  page: Page;
  editable: boolean;
  stream: StreamInfo | null;
  onFocusChange: (focused: boolean) => void;
  onReady?: () => void;
  onEditor?: (editor: TEditor | null) => void;
}) {
  const pageId = page.id;
  const extRev = useRef(page.extRev);
  const pendingSave = useRef<Promise<void> | null>(null);
  const saver = useRef(
    debounce((ed: TEditor) => {
      pendingSave.current = savePageDoc(pageId, ed.getJSON(), false);
    }, 500),
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2] },
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
        code: false,
        codeBlock: false,
        strike: false,
        underline: false,
        link: false,
        dropcursor: false,
        gapcursor: false,
        trailingNode: false,
      }),
      SegAttr,
      StreamWidget,
      FindHighlight,
    ],
    content: page.doc,
    editable,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: 'story-text', spellcheck: 'false', 'aria-label': 'Naskah' },
      // Jaga kursor tetap terlihat di atas bar format yang menempel di bawah layar.
      scrollMargin: { top: 24, bottom: 110, left: 0, right: 0 },
      scrollThreshold: { top: 24, bottom: 110, left: 0, right: 0 },
    },
    onUpdate: ({ editor: ed, transaction }) => {
      // Hanya simpan kalau isi benar-benar berubah oleh pengguna.
      if (transaction.docChanged && !transaction.getMeta(EXTERNAL)) saver.current(ed);
    },
    onFocus: () => onFocusChange(true),
    onBlur: () => onFocusChange(false),
    onCreate: () => onReady?.(),
  });

  // Paksa simpan (dan tunggu selesai) sebelum AI membaca naskah, saat aplikasi disembunyikan, dan saat keluar dari page.
  useEffect(() => {
    const s = saver.current;
    const off = registerFlush(async () => {
      s.flush();
      await pendingSave.current;
    });
    return () => {
      s.flush();
      off();
    };
  }, []);

  // Isi diubah dari luar editor. Tidak masuk riwayat undo, supaya Undo tidak menghapus tulisan AI.
  useEffect(() => {
    if (!editor || page.extRev === extRev.current) return;
    extRev.current = page.extRev;
    saver.current.cancel();
    editor.chain().setMeta('addToHistory', false).setMeta(EXTERNAL, true).setContent(page.doc, { emitUpdate: false }).run();
  }, [editor, page.extRev, page.doc]);

  useEffect(() => {
    // false = jangan memicu event "update" (yang sebelumnya membuat page tersimpan ulang setiap dibuka).
    editor?.setEditable(editable, false);
  }, [editor, editable]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr.setMeta(streamKey, stream).setMeta('addToHistory', false).setMeta(EXTERNAL, true));
  }, [editor, stream?.seg, stream?.text, stream?.thinking]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onEditor?.(editor);
    return () => onEditor?.(null);
  }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Tulis ulang teks terpilih ---------- */
  const [rewrite, setRewrite] = useState<(RewriteTarget & { from: number; to: number }) | null>(null);
  const openRewrite = () => {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    if (empty) return;
    const doc = editor.state.doc;
    // includeParents: isi slice selalu berupa blok (juga kalau pilihan di dalam satu paragraf).
    const md = (a: number, b: number) => serializeBlocks((doc.slice(a, b, true).content.toJSON() ?? []) as Block[]);
    const selected = md(from, to);
    if (!selected.trim()) return;
    setRewrite({ rootId: rootIdOf(page), before: md(0, from), selected, after: md(to, doc.content.size), from, to });
  };
  const applyRewrite = (result: string) => {
    if (!editor || !rewrite) return;
    if (!editor.isEditable) {
      toast('Naskah sedang ditulis AI. Coba lagi setelah selesai.');
      return;
    }
    const blocks = parseMarkdown(result, null);
    if (!blocks.length) return;
    const { from, to } = rewrite;
    const nodes = blocks.map((b) => editor.schema.nodeFromJSON(b));
    // Slice terbuka: paragraf pertama hasil menyambung teks sebelum pilihan, paragraf terakhir menyambung teks sesudahnya
    // (seperti mengganti teks biasa). Paragraf di sekitarnya tetap dengan pemiliknya.
    const slice = new Slice(Fragment.fromArray(nodes), nodes[0].isTextblock ? 1 : 0, nodes[nodes.length - 1].isTextblock ? 1 : 0);
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.replace(from, to, slice);
        return true;
      })
      .run();
    setRewrite(null);
    toast('Teks diganti. Ketuk Undo untuk mengembalikan.');
  };

  return (
    <>
      <EditorContent editor={editor} />
      <FormatBar editor={editor} onRewrite={openRewrite} />
      {rewrite && <RewriteSheet target={rewrite} onClose={() => setRewrite(null)} onReplace={applyRewrite} />}
    </>
  );
}

/** Posisi blok tulisan AI yang tersentuh pilihan (atau blok tempat kursor). */
function aiBlocksInSelection(state: EditorState): number[] {
  const { from, to } = state.selection;
  const out: number[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.attrs.seg) out.push(pos);
    return false;
  });
  return out;
}

function FormatBar({ editor, onRewrite }: { editor: TEditor | null; onRewrite: () => void }) {
  const [, setTick] = useState(0);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!editor) return;
    const update = () => setTick((n) => n + 1);
    const focus = () => setFocused(true);
    const blur = () => setTimeout(() => setFocused(editor.isFocused), 100);
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    editor.on('focus', focus);
    editor.on('blur', blur);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
      editor.off('focus', focus);
      editor.off('blur', blur);
    };
  }, [editor]);
  if (!editor || !focused) return null;
  const btn = (label: React.ReactNode, active: boolean, run: () => void, aria: string) => (
    <button
      className={'fmt-btn' + (active ? ' active' : '')}
      aria-label={aria}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {label}
    </button>
  );
  const chain = () => editor.chain().focus();
  const hasSelection = !editor.state.selection.empty;
  const aiBlocks = editor.isEditable ? aiBlocksInSelection(editor.state) : [];
  const markMine = () => {
    const tr = editor.state.tr;
    for (const pos of aiBlocks) {
      const node = tr.doc.nodeAt(pos);
      if (node) tr.setNodeMarkup(pos, undefined, { ...node.attrs, seg: null });
    }
    editor.view.dispatch(tr);
    toast(
      aiBlocks.length > 1
        ? `${aiBlocks.length} paragraf ditandai tulisan Anda. AI tidak akan menggantinya saat Coba lagi.`
        : 'Paragraf ditandai tulisan Anda. AI tidak akan menggantinya saat Coba lagi.',
    );
  };
  return (
    <div className="format-bar" onMouseDown={(e) => e.preventDefault()}>
      {btn(<b>H</b>, editor.isActive('heading'), () => chain().toggleHeading({ level: 2 }).run(), 'Judul bab')}
      {btn(<b>B</b>, editor.isActive('bold'), () => chain().toggleBold().run(), 'Tebal')}
      {btn(<i>I</i>, editor.isActive('italic'), () => chain().toggleItalic().run(), 'Miring')}
      {btn('***', false, () => chain().setHorizontalRule().run(), 'Pemisah adegan')}
      {btn(<IconUndo size={18} />, false, () => chain().undo().run(), 'Undo')}
      {btn(<IconRedo size={18} />, false, () => chain().redo().run(), 'Redo')}
      {hasSelection && editor.isEditable && btn(<IconSparkle size={18} />, false, onRewrite, 'Tulis ulang dengan AI')}
      {aiBlocks.length > 0 && btn(<IconUser size={18} />, false, markMine, 'Tandai tulisan saya')}
      <span className="fmt-spacer" />
      {btn(<IconCheck size={18} />, false, () => editor.commands.blur(), 'Selesai')}
    </div>
  );
}
