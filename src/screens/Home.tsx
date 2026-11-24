import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, type Page } from '../db';
import { IconChevron, IconChevronDown, IconMore, IconPlus } from '../components/Icons';
import { PageMenu } from '../components/PageMenu';
import { BottomBar, TopTabs } from '../components/ui';
import { useTabSwipe } from '../components/TabSwipe';
import { createChapter, displayTitle } from '../lib/pages';
import { getLastChangeAt, useSettings } from '../lib/settings';
import { formatNumber, timeAgo } from '../lib/util';

const BACKUP_DAYS = 7;
const PAGE_SIZE = 10;

function excerpt(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > 110 ? '…' + t.slice(-110) : t;
}

export default function Home() {
  const nav = useNavigate();
  const settings = useSettings();
  const swipeRef = useTabSwipe('home');
  const pages = useLiveQuery(() => db.pages.filter((p) => !p.deletedAt).toArray(), []);
  const lastChange = useLiveQuery(getLastChangeAt, []);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showAll, setShowAll] = useState(false);
  const [recentsOpen, setRecentsOpen] = useState(true);
  const [storiesOpen, setStoriesOpen] = useState(true);
  const [menu, setMenuPage] = useState<Page | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const setMenu = (p: Page) => {
    setMenuPage(p);
    setMenuOpen(true);
  };

  const { roots, chaptersOf, recents, byId } = useMemo(() => {
    const list = pages ?? [];
    const byId = new Map(list.map((p) => [p.id, p]));
    const roots = list
      .filter((p) => !p.parentId)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
    const chaptersOf = new Map<string, Page[]>();
    for (const p of list) {
      if (!p.parentId || !byId.has(p.parentId)) continue;
      const arr = chaptersOf.get(p.parentId) ?? [];
      arr.push(p);
      chaptersOf.set(p.parentId, arr);
    }
    chaptersOf.forEach((arr) => arr.sort((a, b) => a.order - b.order));
    const recents = list
      .filter((p) => !p.parentId || byId.has(p.parentId))
      .sort((a, b) => b.openedAt - a.openedAt)
      .slice(0, 8);
    return { roots, chaptersOf, recents, byId };
  }, [pages]);

  const needBackup =
    settings &&
    lastChange !== undefined &&
    (pages?.length ?? 0) > 0 &&
    lastChange > Math.max(settings.lastBackupAt, settings.lastAutoBackupAt) &&
    Date.now() - Math.max(settings.lastBackupAt, settings.lastAutoBackupAt, firstUse(pages)) > BACKUP_DAYS * 86400_000;

  const visibleRoots = showAll ? roots : roots.slice(0, PAGE_SIZE);

  return (
    <div className="screen tab-screen" ref={swipeRef}>
      <TopTabs />
      <div className="scroll-area">
        {needBackup && (
          <button className="banner" onClick={() => nav('/settings#backup')}>
            Sudah lebih dari {BACKUP_DAYS} hari sejak backup terakhir. Ketuk untuk backup sekarang.
          </button>
        )}

        {pages && pages.length === 0 && (
          <div className="empty">
            <div className="empty-emoji">📖</div>
            <h2>Belum ada cerita</h2>
            <p>Mulai dengan menulis brief cerita di chat AI: gambaran besar, karakter, gambaran pembukaan, dan aturan penulisan.</p>
            <button className="btn btn-primary" onClick={() => nav('/chat/new')}>
              Mulai cerita pertama
            </button>
          </div>
        )}

        {recents.length > 0 && (
          <section>
            <button className="section-head" onClick={() => setRecentsOpen((v) => !v)}>
              Terbaru <IconChevronDown size={16} className={recentsOpen ? '' : 'rot-90'} />
            </button>
            {recentsOpen && (
              <div className="recents">
                {recents.map((p) => {
                  const parent = p.parentId ? byId.get(p.parentId) : undefined;
                  return (
                    <button key={p.id} className="recent-card" onClick={() => nav(`/page/${p.id}`)}>
                      <div className="recent-top">
                        <span className="recent-excerpt">{excerpt(p.text)}</span>
                      </div>
                      <div className="recent-bottom">
                        <span className="recent-icon">{parent ? parent.icon : p.icon}</span>
                        <span className="recent-title">
                          {parent && <small>{displayTitle(parent)}</small>}
                          {displayTitle(p)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {roots.length > 0 && (
          <section>
            <div className="section-row">
              <button className="section-head" onClick={() => setStoriesOpen((v) => !v)}>
                Cerita <IconChevronDown size={16} className={storiesOpen ? '' : 'rot-90'} />
              </button>
              <button className="icon-btn" aria-label="Cerita baru" onClick={() => nav('/chat/new')}>
                <IconPlus size={20} />
              </button>
            </div>
            {storiesOpen && (
              <ul className="tree">
                {visibleRoots.map((p) => {
                  const chapters = chaptersOf.get(p.id) ?? [];
                  const open = !!expanded[p.id];
                  const total = p.words + chapters.reduce((n, c) => n + c.words, 0);
                  return (
                    <li key={p.id}>
                      <div className="tree-row">
                        <button
                          className="icon-btn tree-toggle"
                          aria-label={open ? 'Tutup bab' : 'Buka bab'}
                          onClick={() => setExpanded((e) => ({ ...e, [p.id]: !open }))}
                        >
                          <IconChevron size={18} className={open ? 'rot90' : ''} />
                        </button>
                        <button className="tree-main" onClick={() => nav(`/page/${p.id}`)}>
                          <span className="tree-icon">{p.icon}</span>
                          <span className="tree-text">
                            <span className="tree-title">
                              {p.pinned && <span className="pin-dot" aria-label="Di-pin">📌</span>}
                              {displayTitle(p)}
                            </span>
                            <small>
                              {formatNumber(total)} kata · {timeAgo(p.updatedAt)}
                            </small>
                          </span>
                        </button>
                        <button className="icon-btn" aria-label="Menu" onClick={() => setMenu(p)}>
                          <IconMore size={20} />
                        </button>
                        <button
                          className="icon-btn"
                          aria-label="Bab baru"
                          onClick={async () => {
                            const ch = await createChapter(p.id);
                            nav(`/page/${ch.id}`);
                          }}
                        >
                          <IconPlus size={20} />
                        </button>
                      </div>
                      {open && (
                        <ul className="tree-children">
                          {chapters.length === 0 && <li className="tree-empty">Belum ada bab</li>}
                          {chapters.map((c) => (
                            <li key={c.id} className="tree-row">
                              <button className="tree-main" onClick={() => nav(`/page/${c.id}`)}>
                                <span className="tree-icon">📄</span>
                                <span className="tree-text">
                                  <span className="tree-title">{displayTitle(c)}</span>
                                  <small>{formatNumber(c.words)} kata</small>
                                </span>
                              </button>
                              <button className="icon-btn" aria-label="Menu bab" onClick={() => setMenu(c)}>
                                <IconMore size={20} />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {storiesOpen && roots.length > PAGE_SIZE && !showAll && (
              <button className="more-link" onClick={() => setShowAll(true)}>
                <IconMore size={18} /> Lihat lainnya
              </button>
            )}
          </section>
        )}
      </div>
      <BottomBar askHref="/chat/new" />
      {menu && (
        <PageMenu
          page={byId.get(menu.id) ?? menu}
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          onOpenPage={(id) => nav(`/page/${id}`)}
        />
      )}
    </div>
  );
}

function firstUse(pages: Page[] | undefined): number {
  if (!pages?.length) return Date.now();
  return pages.reduce((m, p) => Math.min(m, p.createdAt), Infinity);
}
