import { EditorContent, Extension, useEditor, type Editor as TEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef, useState } from 'react';
import type { Page } from '../db';
import { registerFlush } from '../lib/editors';
import { savePageDoc } from '../lib/pages';
import { debounce } from '../lib/util';
import { IconCheck, IconRedo, IconUndo } from './Icons';

/** Atribut `seg` di setiap blok: id balasan AI yang menulisnya. Ikut terbawa saat Enter. */
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
});

export function StoryEditor({
  page,
  editable,
  onFocusChange,
  onReady,
}: {
  page: Page;
  editable: boolean;
  onFocusChange: (focused: boolean) => void;
  onReady?: () => void;
}) {
  const pageId = page.id;
  const extRev = useRef(page.extRev);
  const saver = useRef(
    debounce((ed: TEditor) => {
      void savePageDoc(pageId, ed.getJSON(), false);
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
    ],
    content: page.doc,
    editable,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: 'story-text', spellcheck: 'false', 'aria-label': 'Naskah' },
    },
    onUpdate: ({ editor: ed }) => saver.current(ed),
    onFocus: () => onFocusChange(true),
    onBlur: () => onFocusChange(false),
    onCreate: () => onReady?.(),
  });

  // Paksa simpan sebelum AI membaca naskah, dan saat keluar dari page.
  useEffect(() => {
    const s = saver.current;
    const off = registerFlush(() => s.flush());
    return () => {
      s.flush();
      off();
    };
  }, []);

  // Isi diubah dari luar editor (AI menulis, ganti versi, batalkan).
  useEffect(() => {
    if (!editor || page.extRev === extRev.current) return;
    extRev.current = page.extRev;
    saver.current.cancel();
    editor.commands.setContent(page.doc, { emitUpdate: false });
  }, [editor, page.extRev, page.doc]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  return (
    <>
      <EditorContent editor={editor} />
      <FormatBar editor={editor} />
    </>
  );
}

function FormatBar({ editor }: { editor: TEditor | null }) {
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
  return (
    <div className="format-bar" onMouseDown={(e) => e.preventDefault()}>
      {btn(<b>H</b>, editor.isActive('heading'), () => chain().toggleHeading({ level: 2 }).run(), 'Judul bab')}
      {btn(<b>B</b>, editor.isActive('bold'), () => chain().toggleBold().run(), 'Tebal')}
      {btn(<i>I</i>, editor.isActive('italic'), () => chain().toggleItalic().run(), 'Miring')}
      {btn('***', false, () => chain().setHorizontalRule().run(), 'Pemisah adegan')}
      {btn(<IconUndo size={18} />, false, () => chain().undo().run(), 'Undo')}
      {btn(<IconRedo size={18} />, false, () => chain().redo().run(), 'Redo')}
      <span className="fmt-spacer" />
      {btn(<IconCheck size={18} />, false, () => editor.commands.blur(), 'Selesai')}
    </div>
  );
}
