import type { Editor as TEditor } from '@tiptap/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { countInJson, getFindState, replaceInJson, replaceMatches, setFindMeta, type FindQuery } from '../lib/find';
import { isBusy, useActiveGen } from '../lib/generate';
import { backStack, isNative } from '../lib/native';
import { getStoryPages, savePageDoc } from '../lib/pages';
import { formatNumber } from '../lib/util';
import { IconClose, IconDown, IconUp } from './Icons';
import { ConfirmSheet, toast } from './ui';

/** Bar cari & ganti di atas naskah. Ganti di page ini bisa di-undo; "seluruh cerita" juga mengganti bab lain. */
export function FindBar({ editor, rootId, pageId, onClose }: { editor: TEditor | null; rootId: string; pageId: string; onClose: () => void }) {
  const [text, setText] = useState('');
  const [repl, setRepl] = useState('');
  const [caseSensitive, setCase] = useState(false);
  const [wholeWord, setWhole] = useState(false);
  const [allStory, setAllStory] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [, setTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const gen = useActiveGen();
  const q: FindQuery = { text, caseSensitive, wholeWord };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Tombol back Android menutup bar ini dulu.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!isNative()) return;
    const close = () => closeRef.current();
    backStack.push(close);
    return () => {
      const i = backStack.lastIndexOf(close);
      if (i >= 0) backStack.splice(i, 1);
    };
  }, []);

  useEffect(() => {
    if (!editor) return;
    const update = () => setTick((n) => n + 1);
    editor.on('transaction', update);
    return () => {
      editor.off('transaction', update);
    };
  }, [editor]);

  // Kirim kata yang dicari ke editor (untuk sorotan), lalu gulir ke kecocokan pertama.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dispatch(setFindMeta(editor.state.tr, { query: text ? q : null }));
    scrollToCurrent();
  }, [editor, text, caseSensitive, wholeWord]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      if (editor && !editor.isDestroyed) editor.view.dispatch(setFindMeta(editor.state.tr, { query: null }));
    },
    [editor],
  );

  const others = useLiveQuery(async () => {
    if (!allStory || !text || !editor) return { count: 0, pages: 0 };
    const pages = (await getStoryPages(rootId)).filter((p) => p.id !== pageId);
    let count = 0;
    let n = 0;
    for (const p of pages) {
      const c = countInJson(editor.schema, p.doc, q);
      count += c;
      if (c) n++;
    }
    return { count, pages: n };
  }, [allStory, text, caseSensitive, wholeWord, rootId, pageId, editor]);

  const st = editor ? getFindState(editor.state) : undefined;
  const matches = st?.matches ?? [];
  const current = st?.current ?? 0;
  const editable = !!editor?.isEditable;
  const otherCount = allStory ? (others?.count ?? 0) : 0;

  function scrollToCurrent() {
    requestAnimationFrame(() => {
      const el = editor?.view.dom.querySelector('.find-hit.current');
      el?.scrollIntoView({ block: 'center' });
    });
  }

  const go = (d: 1 | -1) => {
    if (!editor || !matches.length) return;
    editor.view.dispatch(setFindMeta(editor.state.tr, { current: current + d }));
    scrollToCurrent();
  };

  const replaceOne = () => {
    if (!editor || !editable || !matches.length) return;
    const tr = editor.state.tr;
    replaceMatches(tr, [matches[current]], repl);
    editor.view.dispatch(tr);
    scrollToCurrent();
  };

  const replaceAll = async () => {
    if (!editor) return;
    let n = 0;
    if (matches.length && editable) {
      n += matches.length;
      const tr = editor.state.tr;
      replaceMatches(tr, matches, repl);
      editor.view.dispatch(tr);
    }
    let pages = 0;
    if (allStory) {
      if (isBusy()) {
        toast('AI sedang menulis. Bab lain diganti setelah selesai.');
        return;
      }
      for (const p of (await getStoryPages(rootId)).filter((x) => x.id !== pageId)) {
        const r = replaceInJson(editor.schema, p.doc, q, repl);
        if (!r) continue;
        await savePageDoc(p.id, r.doc, true);
        n += r.count;
        pages++;
      }
    }
    toast(n ? `${formatNumber(n)} diganti${pages ? ` (termasuk ${pages} bab lain)` : ''}` : 'Tidak ada yang cocok');
  };

  const total = matches.length + otherCount;
  return (
    <div className="find-bar">
      <div className="find-row">
        <input
          ref={inputRef}
          className="input find-input"
          placeholder="Cari di bab ini"
          aria-label="Cari"
          value={text}
          enterKeyHint="search"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              go(e.shiftKey ? -1 : 1);
            }
          }}
        />
        <span className="find-count" aria-live="polite">
          {text ? (matches.length ? `${current + 1}/${matches.length}` : '0') : ''}
        </span>
        <button className="icon-btn" aria-label="Sebelumnya" disabled={!matches.length} onClick={() => go(-1)}>
          <IconUp size={18} />
        </button>
        <button className="icon-btn" aria-label="Berikutnya" disabled={!matches.length} onClick={() => go(1)}>
          <IconDown size={18} />
        </button>
        <button className="icon-btn" aria-label="Tutup cari" onClick={onClose}>
          <IconClose size={18} />
        </button>
      </div>
      <div className="find-row">
        <input
          className="input find-input"
          placeholder="Ganti dengan"
          aria-label="Ganti dengan"
          value={repl}
          onChange={(e) => setRepl(e.target.value)}
        />
        <button className="btn btn-small" disabled={!editable || !matches.length} onClick={replaceOne}>
          Ganti
        </button>
        <button
          className="btn btn-small"
          disabled={!total || (!editable && !allStory) || (allStory && !!gen)}
          onClick={() => (allStory && otherCount ? setConfirm(true) : void replaceAll())}
        >
          Semua{total ? ` (${formatNumber(total)})` : ''}
        </button>
      </div>
      <div className="find-row find-opts">
        <button className={'chip' + (caseSensitive ? ' on' : '')} aria-pressed={caseSensitive} onClick={() => setCase((v) => !v)}>
          Aa huruf besar
        </button>
        <button className={'chip' + (wholeWord ? ' on' : '')} aria-pressed={wholeWord} onClick={() => setWhole((v) => !v)}>
          Kata utuh
        </button>
        <button className={'chip' + (allStory ? ' on' : '')} aria-pressed={allStory} onClick={() => setAllStory((v) => !v)}>
          Seluruh cerita{allStory && text ? ` · ${formatNumber(otherCount)} di bab lain` : ''}
        </button>
      </div>
      {!editable && <div className="find-note">AI sedang menulis di page ini. Ganti bisa dipakai setelah selesai.</div>}
      <ConfirmSheet
        open={confirm}
        title="Ganti di seluruh cerita?"
        message={
          <>
            {formatNumber(total)} kecocokan diganti, {formatNumber(otherCount)} di antaranya di {others?.pages ?? 0} bab lain. Perubahan di bab
            lain tidak bisa di-undo.
          </>
        }
        confirmLabel="Ganti semua"
        onConfirm={() => void replaceAll()}
        onClose={() => setConfirm(false)}
      />
    </div>
  );
}
