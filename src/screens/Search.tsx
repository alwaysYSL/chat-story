import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBack } from '../lib/nav';
import { db } from '../db';
import { IconBack, IconChat, IconPage } from '../components/Icons';
import { displayTitle } from '../lib/pages';

function snippet(text: string, q: string): string {
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return text.slice(0, 120);
  const start = Math.max(0, i - 50);
  return (start > 0 ? '…' : '') + text.slice(start, i + q.length + 70).replace(/\s+/g, ' ') + '…';
}

export default function Search() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const pages = useLiveQuery(() => db.pages.filter((p) => !p.deletedAt).toArray(), []);
  const chats = useLiveQuery(() => db.chats.filter((c) => !c.deletedAt).toArray(), []);
  const query = q.trim().toLowerCase();

  const results = useMemo(() => {
    if (!query) return { pages: [], chats: [] };
    const byId = new Map((pages ?? []).map((p) => [p.id, p]));
    return {
      pages: (pages ?? [])
        .filter((p) => !p.parentId || byId.has(p.parentId))
        .filter((p) => p.title.toLowerCase().includes(query) || p.text.toLowerCase().includes(query))
        .slice(0, 30)
        .map((p) => ({ p, parent: p.parentId ? byId.get(p.parentId) : undefined })),
      chats: (chats ?? []).filter((c) => c.title.toLowerCase().includes(query)).slice(0, 20),
    };
  }, [query, pages, chats]);

  return (
    <div className="screen">
      <header className="page-header">
        <button className="icon-btn" aria-label="Kembali" onClick={() => goBack(nav)}>
          <IconBack />
        </button>
        <input
          className="search-input"
          autoFocus
          placeholder="Cari cerita, isi naskah, atau chat…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </header>
      <div className="scroll-area">
        {query && results.pages.length === 0 && results.chats.length === 0 && <p className="note pad">Tidak ditemukan.</p>}
        {results.pages.length > 0 && <div className="section-head static">Page</div>}
        {results.pages.map(({ p, parent }) => (
          <button key={p.id} className="search-row" onClick={() => nav(`/page/${p.id}`)}>
            <IconPage size={18} />
            <span>
              <b>
                {parent ? `${displayTitle(parent)} › ` : ''}
                {displayTitle(p)}
              </b>
              <small>{snippet(p.text, query)}</small>
            </span>
          </button>
        ))}
        {results.chats.length > 0 && <div className="section-head static">Chat</div>}
        {results.chats.map((c) => (
          <button key={c.id} className="search-row" onClick={() => nav(`/chat/${c.id}`)}>
            <IconChat size={18} />
            <span>
              <b>{c.title}</b>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
