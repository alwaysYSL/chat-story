import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, type Chat } from '../db';
import { IconEdit, IconMore, IconTrash } from '../components/Icons';
import { BottomBar, PromptSheet, Sheet, SheetItem, TopTabs, toast, useLongPress } from '../components/ui';
import { markChanged } from '../lib/settings';
import { displayTitle, trashChat } from '../lib/pages';
import { timeAgo } from '../lib/util';

const KIND_LABEL: Record<Chat['kind'], string> = {
  main: 'Chat utama',
  discuss: 'Diskusi',
  free: 'Chat',
};

export default function Chats() {
  const nav = useNavigate();
  const chats = useLiveQuery(() => db.chats.filter((c) => !c.deletedAt).toArray(), []);
  const pages = useLiveQuery(() => db.pages.filter((p) => !p.parentId).toArray(), []);
  const [menu, setMenuChat] = useState<Chat | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [rename, setRename] = useState(false);

  const groups = useMemo(() => {
    const list = [...(chats ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    const today = startToday.getTime();
    const week = today - 6 * 86400_000;
    const g: { label: string; items: Chat[] }[] = [
      { label: 'Hari ini', items: [] },
      { label: '7 hari terakhir', items: [] },
      { label: 'Lebih lama', items: [] },
    ];
    for (const c of list) {
      if (c.updatedAt >= today) g[0].items.push(c);
      else if (c.updatedAt >= week) g[1].items.push(c);
      else g[2].items.push(c);
    }
    return g.filter((x) => x.items.length);
  }, [chats]);

  const pageTitle = (id: string | null) => {
    if (!id) return null;
    const p = pages?.find((x) => x.id === id);
    return p && !p.deletedAt ? `${p.icon} ${displayTitle(p)}` : null;
  };

  return (
    <div className="screen tab-screen">
      <TopTabs />
      <div className="scroll-area">
        {chats && chats.length === 0 && (
          <div className="empty">
            <div className="empty-emoji">💬</div>
            <h2>Belum ada chat</h2>
            <p>Ketuk Ask AI untuk mulai menulis cerita baru atau berdiskusi.</p>
          </div>
        )}
        {groups.map((g) => (
          <section key={g.label}>
            <div className="section-head static">{g.label}</div>
            <ul className="chat-list">
              {g.items.map((c) => {
                const pt = pageTitle(c.pageId);
                return (
                  <ChatRow
                    key={c.id}
                    c={c}
                    sub={`${KIND_LABEL[c.kind]}${pt ? ` · ${pt}` : ''} · ${timeAgo(c.updatedAt)}`}
                    onOpen={() => nav(`/chat/${c.id}`)}
                    onMenu={() => {
                      setMenuChat(c);
                      setMenuOpen(true);
                    }}
                  />
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <BottomBar askHref="/chat/new" />
      {menu && (
        <>
          <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={menu.title}>
            <SheetItem
              icon={<IconEdit />}
              label="Ganti nama"
              onClick={() => {
                setMenuOpen(false);
                setRename(true);
              }}
            />
            <SheetItem
              icon={<IconTrash />}
              label="Hapus chat"
              hint={menu.kind === 'main' ? 'Chat utama hanya terhapus bersama ceritanya' : undefined}
              danger
              disabled={menu.kind === 'main'}
              onClick={async () => {
                await trashChat(menu.id);
                setMenuOpen(false);
                toast('Chat dipindah ke Sampah');
              }}
            />
          </Sheet>
          <PromptSheet
            open={rename}
            title="Nama chat"
            initial={menu.title}
            onClose={() => setRename(false)}
            onSubmit={(v) => {
              if (!v.trim()) return;
              void db.chats.update(menu.id, { title: v.trim(), titleAuto: false });
              markChanged();
            }}
          />
        </>
      )}
    </div>
  );
}

function ChatRow({ c, sub, onOpen, onMenu }: { c: Chat; sub: string; onOpen: () => void; onMenu: () => void }) {
  const lp = useLongPress(onMenu);
  return (
    <li className="chat-row">
      <button className="chat-main pressable" onClick={onOpen} {...lp}>
        <span className="chat-title">{c.title}</span>
        <small>{sub}</small>
      </button>
      <button className="icon-btn" aria-label="Menu chat" onClick={onMenu}>
        <IconMore size={20} />
      </button>
    </li>
  );
}
