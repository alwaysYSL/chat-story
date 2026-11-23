import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBack } from '../lib/nav';
import { db } from '../db';
import { IconBack } from '../components/Icons';
import { ConfirmSheet, toast } from '../components/ui';
import { deleteChatPermanently, deletePageHard, displayTitle, restoreChat, restorePage, TRASH_DAYS } from '../lib/pages';

function daysLeft(deletedAt: number) {
  return Math.max(0, TRASH_DAYS - Math.floor((Date.now() - deletedAt) / 86400_000));
}

export default function Trash() {
  const nav = useNavigate();
  const pages = useLiveQuery(async () => {
    const all = await db.pages.toArray();
    const byId = new Map(all.map((p) => [p.id, p]));
    // Tampilkan cerita terhapus, dan bab terhapus yang ceritanya masih ada.
    return all
      .filter((p) => p.deletedAt && (!p.parentId || !byId.get(p.parentId)?.deletedAt))
      .map((p) => ({ p, parent: p.parentId ? byId.get(p.parentId) : undefined }))
      .sort((a, b) => b.p.deletedAt! - a.p.deletedAt!);
  }, []);
  const chats = useLiveQuery(async () => {
    const all = await db.chats.filter((c) => !!c.deletedAt).toArray();
    const pagesDeleted = new Set((await db.pages.filter((p) => !!p.deletedAt).toArray()).map((p) => p.id));
    // Chat yang terhapus bersama ceritanya cukup tampil lewat ceritanya.
    return all.filter((c) => !c.pageId || !pagesDeleted.has(c.pageId)).sort((a, b) => b.deletedAt! - a.deletedAt!);
  }, []);
  const [confirm, setConfirm] = useState<{ kind: 'page' | 'chat'; id: string; name: string } | null>(null);

  return (
    <div className="screen">
      <header className="page-header">
        <button className="icon-btn" aria-label="Kembali" onClick={() => goBack(nav)}>
          <IconBack />
        </button>
        <div className="chat-head-title">Sampah</div>
      </header>
      <div className="scroll-area">
        <p className="note pad">Item di Sampah dihapus permanen setelah {TRASH_DAYS} hari.</p>
        {pages?.length === 0 && chats?.length === 0 && <p className="note pad">Sampah kosong.</p>}
        {pages?.map(({ p, parent }) => (
          <div key={p.id} className="trash-row">
            <span className="trash-text">
              <b>
                {parent ? `${displayTitle(parent)} › ` : `${p.icon} `}
                {displayTitle(p)}
              </b>
              <small>
                {p.parentId ? 'Bab' : 'Cerita'} · {daysLeft(p.deletedAt!)} hari lagi
              </small>
            </span>
            <button
              className="btn btn-small"
              onClick={async () => {
                await restorePage(p.id);
                toast('Dipulihkan');
              }}
            >
              Pulihkan
            </button>
            <button className="btn btn-small btn-danger" onClick={() => setConfirm({ kind: 'page', id: p.id, name: displayTitle(p) })}>
              Hapus
            </button>
          </div>
        ))}
        {chats?.map((c) => (
          <div key={c.id} className="trash-row">
            <span className="trash-text">
              <b>💬 {c.title}</b>
              <small>Chat · {daysLeft(c.deletedAt!)} hari lagi</small>
            </span>
            <button
              className="btn btn-small"
              onClick={async () => {
                await restoreChat(c.id);
                toast('Dipulihkan');
              }}
            >
              Pulihkan
            </button>
            <button className="btn btn-small btn-danger" onClick={() => setConfirm({ kind: 'chat', id: c.id, name: c.title })}>
              Hapus
            </button>
          </div>
        ))}
      </div>
      <ConfirmSheet
        open={!!confirm}
        title="Hapus permanen?"
        message={`"${confirm?.name}" akan dihapus selamanya dan tidak bisa dipulihkan.`}
        confirmLabel="Hapus permanen"
        danger
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return;
          if (confirm.kind === 'page') await deletePageHard(confirm.id);
          else await deleteChatPermanently(confirm.id);
          toast('Dihapus permanen');
        }}
      />
    </div>
  );
}
