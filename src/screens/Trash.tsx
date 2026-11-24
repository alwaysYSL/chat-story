import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBack } from '../lib/nav';
import { db } from '../db';
import { IconBack } from '../components/Icons';
import { ConfirmSheet, toast } from '../components/ui';
import { deleteChatPermanently, deletePageHard, displayTitle, restoreChat, restorePage, TRASH_DAYS } from '../lib/pages';
import { deleteCharacterHard, deleteLorebookHard, restoreCharacter, restoreLorebook, restorePersona, restoreRpChat } from '../lib/rp/data';

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
    const charsDeleted = new Set((await db.characters.filter((c) => !!c.deletedAt).toArray()).map((c) => c.id));
    // Chat roleplay yang terhapus bersama karakternya cukup tampil lewat karakternya.
    return all
      .filter((c) => (!c.pageId || !pagesDeleted.has(c.pageId)) && (!c.characterId || !charsDeleted.has(c.characterId)))
      .sort((a, b) => b.deletedAt! - a.deletedAt!);
  }, []);
  const rp = useLiveQuery(async () => {
    const characters = (await db.characters.filter((c) => !!c.deletedAt).toArray()).sort((a, b) => b.deletedAt! - a.deletedAt!);
    const personas = await db.personas.filter((p) => !!p.deletedAt).toArray();
    const books = await db.lorebooks.filter((b) => !!b.deletedAt && !b.characterId).toArray();
    return [
      ...characters.map((c) => ({ kind: 'character' as const, id: c.id, name: `🎭 ${c.name}`, label: 'Karakter (beserta chat-nya)', at: c.deletedAt! })),
      ...personas.map((p) => ({ kind: 'persona' as const, id: p.id, name: `👤 ${p.name}`, label: 'Persona', at: p.deletedAt! })),
      ...books.map((b) => ({ kind: 'lorebook' as const, id: b.id, name: `📖 ${b.name}`, label: 'Lorebook dunia', at: b.deletedAt! })),
    ].sort((a, b) => b.at - a.at);
  }, []);
  const [confirm, setConfirm] = useState<{ kind: 'page' | 'chat' | 'character' | 'persona' | 'lorebook'; id: string; name: string } | null>(null);

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
        {pages?.length === 0 && chats?.length === 0 && rp?.length === 0 && <p className="note pad">Sampah kosong.</p>}
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
              <small>
                {c.kind === 'roleplay' ? 'Chat roleplay' : 'Chat'} · {daysLeft(c.deletedAt!)} hari lagi
              </small>
            </span>
            <button
              className="btn btn-small"
              onClick={async () => {
                if (c.kind === 'roleplay') await restoreRpChat(c);
                else await restoreChat(c.id);
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
        {rp?.map((x) => (
          <div key={x.kind + x.id} className="trash-row">
            <span className="trash-text">
              <b>{x.name}</b>
              <small>
                {x.label} · {daysLeft(x.at)} hari lagi
              </small>
            </span>
            <button
              className="btn btn-small"
              onClick={async () => {
                if (x.kind === 'character') await restoreCharacter(x.id);
                else if (x.kind === 'persona') await restorePersona(x.id);
                else await restoreLorebook(x.id);
                toast('Dipulihkan');
              }}
            >
              Pulihkan
            </button>
            <button className="btn btn-small btn-danger" onClick={() => setConfirm({ kind: x.kind, id: x.id, name: x.name })}>
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
          else if (confirm.kind === 'character') await deleteCharacterHard(confirm.id);
          else if (confirm.kind === 'persona') await db.personas.delete(confirm.id);
          else if (confirm.kind === 'lorebook') await deleteLorebookHard(confirm.id);
          else await deleteChatPermanently(confirm.id);
          toast('Dihapus permanen');
        }}
      />
    </div>
  );
}
