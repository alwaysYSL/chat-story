import { useState, type ReactNode } from 'react';
import type { Page } from '../db';
import { db } from '../db';
import {
  createChapter,
  displayTitle,
  duplicateStory,
  pageMarkdown,
  renamePage,
  rootIdOf,
  storyMarkdown,
  trashChapter,
  trashStory,
} from '../lib/pages';
import { copyText, downloadFile, shareFile } from '../lib/util';
import { IconCheck, IconEdit, IconFile, IconPage, IconPin, IconPlus, IconShare, IconTrash } from './Icons';
import { ConfirmSheet, PromptSheet, Sheet, SheetItem, toast } from './ui';

export const ICON_CHOICES = ['📄', '📖', '📝', '💫', '🌙', '🌸', '🔥', '🎸', '🎭', '🗡️', '🏫', '☕', '💔', '🌧️', '🌊', '🦋'];

export function ExportSheet({ page, open, onClose }: { page: Page; open: boolean; onClose: () => void }) {
  const rootId = rootIdOf(page);
  const isChapter = !!page.parentId;
  const fileName = (s: string) => (s || 'cerita').replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 60) || 'cerita';
  return (
    <Sheet open={open} onClose={onClose} title="Ekspor">
      <SheetItem
        icon={<IconCheck />}
        label={isChapter ? 'Salin bab ini (Markdown)' : 'Salin page ini (Markdown)'}
        hint="Siap ditempel ke Notion"
        onClick={async () => {
          const ok = await copyText(pageMarkdown(page, true));
          toast(ok ? 'Disalin ke clipboard' : 'Gagal menyalin');
          onClose();
        }}
      />
      <SheetItem
        icon={<IconCheck />}
        label="Salin seluruh cerita (Markdown)"
        hint="Semua bab digabung"
        onClick={async () => {
          const ok = await copyText(await storyMarkdown(rootId));
          toast(ok ? 'Disalin ke clipboard' : 'Gagal menyalin');
          onClose();
        }}
      />
      <SheetItem
        icon={<IconShare />}
        label="Bagikan file .md (seluruh cerita)"
        onClick={async () => {
          const root = await db.pages.get(rootId);
          const md = await storyMarkdown(rootId);
          const blob = new Blob([md], { type: 'text/markdown' });
          const name = fileName(displayTitle(root)) + '.md';
          if (!(await shareFile(name, blob, displayTitle(root)))) downloadFile(name, blob);
          onClose();
        }}
      />
      <SheetItem
        icon={<IconFile />}
        label="Unduh file .txt (seluruh cerita)"
        onClick={async () => {
          const root = await db.pages.get(rootId);
          const md = await storyMarkdown(rootId);
          downloadFile(fileName(displayTitle(root)) + '.txt', new Blob([md], { type: 'text/plain' }));
          onClose();
        }}
      />
    </Sheet>
  );
}

export function IconPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (icon: string) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Pilih ikon">
      <div className="icon-grid">
        {ICON_CHOICES.map((i) => (
          <button
            key={i}
            className="icon-choice"
            onClick={() => {
              onPick(i);
              onClose();
            }}
          >
            {i}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** Menu ⋯ untuk cerita atau bab. */
export function PageMenu({
  page,
  open,
  onClose,
  onOpenPage,
  onDeleted,
  extra,
}: {
  page: Page;
  open: boolean;
  onClose: () => void;
  onOpenPage?: (id: string) => void;
  onDeleted?: () => void;
  extra?: ReactNode;
}) {
  const [rename, setRename] = useState(false);
  const [icon, setIcon] = useState(false);
  const [exp, setExp] = useState(false);
  const [del, setDel] = useState(false);
  const isChapter = !!page.parentId;

  return (
    <>
      <Sheet open={open} onClose={onClose} title={displayTitle(page)}>
        {extra}
        <SheetItem
          icon={<IconEdit />}
          label="Ganti nama"
          onClick={() => {
            onClose();
            setRename(true);
          }}
        />
        {!isChapter && (
          <SheetItem
            icon={<span className="emoji-ico">{page.icon}</span>}
            label="Ganti ikon"
            onClick={() => {
              onClose();
              setIcon(true);
            }}
          />
        )}
        {!isChapter && (
          <SheetItem
            icon={<IconPin />}
            label={page.pinned ? 'Lepas pin' : 'Pin ke atas'}
            onClick={async () => {
              await db.pages.update(page.id, { pinned: !page.pinned });
              onClose();
            }}
          />
        )}
        <SheetItem
          icon={<IconPlus />}
          label="Bab baru"
          onClick={async () => {
            const ch = await createChapter(rootIdOf(page));
            onClose();
            onOpenPage?.(ch.id);
          }}
        />
        {!isChapter && (
          <SheetItem
            icon={<IconPage />}
            label="Duplikat cerita"
            hint="Untuk mencoba alur alternatif"
            onClick={async () => {
              const copy = await duplicateStory(page.id);
              onClose();
              if (copy) toast('Cerita diduplikat');
            }}
          />
        )}
        <SheetItem
          icon={<IconShare />}
          label="Ekspor"
          onClick={() => {
            onClose();
            setExp(true);
          }}
        />
        <SheetItem
          icon={<IconTrash />}
          label={isChapter ? 'Hapus bab' : 'Hapus cerita'}
          danger
          onClick={() => {
            onClose();
            setDel(true);
          }}
        />
      </Sheet>
      <PromptSheet
        open={rename}
        title={isChapter ? 'Nama bab' : 'Judul cerita'}
        initial={page.title}
        onClose={() => setRename(false)}
        onSubmit={(v) => void renamePage(page.id, v.trim())}
      />
      <IconPicker open={icon} onClose={() => setIcon(false)} onPick={(i) => void db.pages.update(page.id, { icon: i })} />
      <ExportSheet page={page} open={exp} onClose={() => setExp(false)} />
      <ConfirmSheet
        open={del}
        title={isChapter ? 'Hapus bab?' : 'Hapus cerita?'}
        message={
          isChapter
            ? 'Bab ini dipindah ke Sampah selama 30 hari dan tidak lagi dibaca AI.'
            : 'Cerita, semua bab, dan chat-nya dipindah ke Sampah selama 30 hari.'
        }
        confirmLabel="Hapus"
        danger
        onClose={() => setDel(false)}
        onConfirm={async () => {
          if (isChapter) await trashChapter(page.id);
          else await trashStory(page.id);
          toast('Dipindah ke Sampah');
          onDeleted?.();
        }}
      />
    </>
  );
}
