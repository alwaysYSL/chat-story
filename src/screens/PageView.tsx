import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { db, type Page } from '../db';
import { MarkdownView } from '../components/Blocks';
import { StoryEditor } from '../components/Editor';
import {
  IconArrowBottom,
  IconArrowTop,
  IconBack,
  IconChat,
  IconDown,
  IconHistory,
  IconMore,
  IconPage,
  IconSettings,
  IconShare,
  IconSparkle,
  IconStop,
  IconUp,
} from '../components/Icons';
import { ExportSheet, IconPicker, PageMenu } from '../components/PageMenu';
import { BottomBar, PromptSheet, Sheet, SheetItem, toast } from '../components/ui';
import { getBrief } from '../lib/context';
import { stopGeneration, useActiveGen } from '../lib/generate';
import { displayTitle, getMainChat, moveChapter, renamePage } from '../lib/pages';
import { useSettings } from '../lib/settings';
import { debounce, formatNumber, formatRupiah, formatUsd } from '../lib/util';

export default function PageView() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const settings = useSettings();
  const page = useLiveQuery(() => db.pages.get(id), [id]);
  const rootId = page ? (page.parentId ?? page.id) : null;
  const root = useLiveQuery(async () => (rootId ? db.pages.get(rootId) : undefined), [rootId]);
  const chapters = useLiveQuery(
    async () =>
      rootId
        ? (await db.pages.where('parentId').equals(rootId).toArray())
            .filter((p) => !p.deletedAt)
            .sort((a, b) => a.order - b.order)
        : [],
    [rootId],
  );
  const mainChat = useLiveQuery(async () => (rootId ? ((await getMainChat(rootId)) ?? null) : null), [rootId]);
  const gen = useActiveGen();
  const streamingHere = !!gen && gen.mode === 'write' && gen.pageId === id;

  const scrollRef = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const restored = useRef(false);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [iconOpen, setIconOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [briefText, setBriefText] = useState('');
  const [costOpen, setCostOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [title, setTitle] = useState('');

  // Catat waktu dibuka.
  useEffect(() => {
    if (id) void db.pages.update(id, { openedAt: Date.now() });
    restored.current = false;
  }, [id]);

  useEffect(() => {
    if (page) setTitle(page.title);
  }, [page?.id, page?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveTitle = useMemo(() => debounce((pid: string, t: string) => void renamePage(pid, t), 600), []);
  useEffect(() => () => saveTitle.flush(), [saveTitle]);

  const saveScroll = useMemo(
    () => debounce((pid: string, y: number) => void db.pages.update(pid, { scrollY: y }), 400),
    [],
  );
  useEffect(() => () => saveScroll.flush(), [saveScroll]);

  const onEditorReady = useCallback(() => {
    if (restored.current || !page) return;
    restored.current = true;
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      const seg = params.get('seg');
      if (seg) {
        const target = el.querySelector(`[data-seg="${CSS.escape(seg)}"]`);
        if (target) {
          target.scrollIntoView({ block: 'start' });
          target.classList.add('flash');
          setTimeout(() => target.classList.remove('flash'), 1600);
        }
        params.delete('seg');
        setParams(params, { replace: true });
      } else if (params.get('end')) {
        el.scrollTop = el.scrollHeight;
      } else {
        el.scrollTop = page.scrollY;
      }
    });
  }, [page, params, setParams]);

  // Ikuti tulisan AI selama streaming, kecuali pengguna menggulir ke atas.
  useEffect(() => {
    if (!streamingHere || !follow.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [streamingHere, gen?.live]);

  useEffect(() => {
    if (streamingHere) follow.current = true;
  }, [streamingHere]);

  if (page === undefined || !settings) return <div className="screen" />;
  if (!page || page.deletedAt) {
    return (
      <div className="screen">
        <div className="empty">
          <h2>Page tidak ditemukan</h2>
          <p>Page ini mungkin sudah dihapus.</p>
          <button className="btn" onClick={() => nav('/')}>
            Ke Beranda
          </button>
        </div>
      </div>
    );
  }

  const isChapter = !!page.parentId;
  const storyPages: Page[] = root ? [root, ...(chapters ?? [])] : [page];
  const idx = storyPages.findIndex((p) => p.id === page.id);
  const prev = idx > 0 ? storyPages[idx - 1] : null;
  const next = idx >= 0 && idx < storyPages.length - 1 ? storyPages[idx + 1] : null;
  const totalWords = storyPages.reduce((n, p) => n + p.words, 0);
  const askHref = mainChat
    ? `/chat/${mainChat.id}?from=${page.id}`
    : `/chat/new?page=${rootId}&from=${page.id}`;
  const empty = !page.text.trim();

  const openBrief = async () => {
    if (!mainChat) {
      toast('Cerita ini belum punya chat utama. Ketuk Ask AI untuk menulis brief.');
      return;
    }
    const b = await getBrief(mainChat.id);
    if (!b) {
      toast('Brief belum ada.');
      return;
    }
    setBriefText(b.text);
    setBriefOpen(true);
  };

  return (
    <div className="screen page-screen">
      <header className="page-header">
        <button className="icon-btn" aria-label="Kembali" onClick={() => (history.length > 1 ? nav(-1) : nav('/'))}>
          <IconBack />
        </button>
        <div className="crumb">
          {isChapter && root && (
            <Link to={`/page/${root.id}`} className="crumb-link">
              {root.icon} {displayTitle(root)} ›
            </Link>
          )}
        </div>
        <button className="icon-btn" aria-label="Ekspor" onClick={() => setExportOpen(true)}>
          <IconShare />
        </button>
        <button className="icon-btn" aria-label="Menu page" onClick={() => setMenuOpen(true)}>
          <IconMore />
        </button>
      </header>

      <div
        className="scroll-area page-scroll"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          saveScroll(page.id, el.scrollTop);
          if (streamingHere) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
        }}
      >
        <div className="page-body">
          {!isChapter && (
            <button className="page-icon" aria-label="Ganti ikon" onClick={() => setIconOpen(true)}>
              {page.icon}
            </button>
          )}
          <textarea
            className="page-title"
            rows={1}
            value={title}
            placeholder={isChapter ? 'Nama bab' : 'Tanpa judul'}
            autoFocus={params.get('new') === '1'}
            onChange={(e) => {
              setTitle(e.target.value);
              saveTitle(page.id, e.target.value);
            }}
            onInput={(e) => {
              const t = e.currentTarget;
              t.style.height = 'auto';
              t.style.height = t.scrollHeight + 'px';
            }}
            ref={(t) => {
              if (t) {
                t.style.height = 'auto';
                t.style.height = t.scrollHeight + 'px';
              }
            }}
          />

          {empty && !streamingHere && (
            <div className="page-hint">
              {mainChat || isChapter
                ? 'Halaman ini masih kosong. Ketik langsung, atau ketuk Ask AI untuk meminta AI menulis.'
                : 'Ketuk Ask AI dan tulis brief cerita (gambaran besar, karakter, gambaran pembukaan, aturan penulisan). AI akan menulis pembukaan di sini.'}
            </div>
          )}

          <StoryEditor
            key={page.id}
            page={page}
            editable={!streamingHere}
            onFocusChange={setEditing}
            onReady={onEditorReady}
          />

          {streamingHere && (
            <div className="stream-preview" aria-live="polite">
              {gen.live ? <MarkdownView text={gen.live} className="story-text" /> : null}
              <div className="typing">
                <span />
                <span />
                <span />
                {gen.thinking ? ' AI sedang berpikir…' : ''}
              </div>
            </div>
          )}

          <div className="page-foot">
            {!isChapter && (chapters?.length ?? 0) > 0 && (
              <div className="child-links">
                {chapters!.map((c) => (
                  <Link key={c.id} to={`/page/${c.id}`} className="child-link">
                    <IconPage size={18} /> {displayTitle(c)}
                    <small>{formatNumber(c.words)} kata</small>
                  </Link>
                ))}
              </div>
            )}
            {(prev || next) && (
              <div className="chapter-nav">
                {prev ? (
                  <Link to={`/page/${prev.id}`} className="btn">
                    ‹ {isChapter && prev.id === rootId ? 'Pembukaan' : 'Bab sebelumnya'}
                  </Link>
                ) : (
                  <span />
                )}
                {next ? (
                  <Link to={`/page/${next.id}`} className="btn">
                    Bab berikutnya ›
                  </Link>
                ) : (
                  <span />
                )}
              </div>
            )}
            <div className="page-stats">
              {formatNumber(page.words)} kata di page ini
              {storyPages.length > 1 && ` · ${formatNumber(totalWords)} kata total`}
            </div>
          </div>
        </div>
      </div>

      {!editing && page.words > 400 && !streamingHere && (
        <div className="jump-btns">
          <button className="icon-btn small-float" aria-label="Ke awal" onClick={() => scrollRef.current?.scrollTo({ top: 0 })}>
            <IconArrowTop size={18} />
          </button>
          <button
            className="icon-btn small-float"
            aria-label="Ke akhir"
            onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })}
          >
            <IconArrowBottom size={18} />
          </button>
        </div>
      )}

      {streamingHere ? (
        <div className="gen-bar">
          <IconSparkle size={16} />
          <span className="gen-text">
            {gen.thinking && !gen.live ? 'AI sedang berpikir…' : `AI sedang menulis · ${formatNumber(gen.words)} kata`}
          </span>
          <button className="btn btn-small" onClick={() => nav(`/chat/${gen.chatId}`)}>
            <IconChat size={16} /> Chat
          </button>
          <button className="btn btn-small btn-danger" onClick={stopGeneration}>
            <IconStop size={16} /> Stop
          </button>
        </div>
      ) : (
        !editing && <BottomBar askHref={askHref} />
      )}

      <PageMenu
        page={page}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onOpenPage={(pid) => nav(`/page/${pid}`)}
        onDeleted={() => nav(isChapter && rootId ? `/page/${rootId}` : '/', { replace: true })}
        extra={
          <>
            <SheetItem
              icon={<IconPage />}
              label="Lihat / edit brief"
              onClick={() => {
                setMenuOpen(false);
                void openBrief();
              }}
            />
            <SheetItem
              icon={<IconChat />}
              label="Chat baru untuk diskusi"
              hint="AI membaca cerita, tapi tidak menulis ke page"
              onClick={() => {
                setMenuOpen(false);
                nav(`/chat/new?page=${rootId}&kind=discuss`);
              }}
            />
            <SheetItem
              icon={<IconHistory />}
              label="Riwayat biaya"
              onClick={() => {
                setMenuOpen(false);
                setCostOpen(true);
              }}
            />
            {(chapters?.length ?? 0) > 1 && (
              <SheetItem
                icon={<IconDown />}
                label="Atur urutan bab"
                onClick={() => {
                  setMenuOpen(false);
                  setOrderOpen(true);
                }}
              />
            )}
            <SheetItem
              icon={<IconSettings />}
              label="Pengaturan baca"
              onClick={() => {
                setMenuOpen(false);
                nav('/settings#baca');
              }}
            />
          </>
        }
      />
      <ExportSheet page={page} open={exportOpen} onClose={() => setExportOpen(false)} />
      <IconPicker open={iconOpen} onClose={() => setIconOpen(false)} onPick={(i) => void db.pages.update(page.id, { icon: i })} />
      <PromptSheet
        open={briefOpen}
        title="Brief cerita"
        initial={briefText}
        multiline
        note="Perubahan brief berlaku untuk tulisan AI berikutnya. Tulisan yang sudah ada tidak berubah."
        onClose={() => setBriefOpen(false)}
        onSubmit={async (v) => {
          if (!mainChat) return;
          const b = await getBrief(mainChat.id);
          if (b) await db.messages.update(b.id, { text: v.trim() });
          toast('Brief disimpan');
        }}
      />
      {rootId && <CostSheet open={costOpen} onClose={() => setCostOpen(false)} rootId={rootId} rate={settings.usdToIdr} />}
      <Sheet open={orderOpen} onClose={() => setOrderOpen(false)} title="Urutan bab">
        <p className="note">Urutan ini juga dipakai AI saat membaca cerita.</p>
        {(chapters ?? []).map((c, i, arr) => (
          <div key={c.id} className="order-row">
            <span>{displayTitle(c)}</span>
            <button className="icon-btn" aria-label="Naik" disabled={i === 0} onClick={() => void moveChapter(c.id, -1)}>
              <IconUp size={18} />
            </button>
            <button
              className="icon-btn"
              aria-label="Turun"
              disabled={i === arr.length - 1}
              onClick={() => void moveChapter(c.id, 1)}
            >
              <IconDown size={18} />
            </button>
          </div>
        ))}
      </Sheet>
    </div>
  );
}

function CostSheet({ open, onClose, rootId, rate }: { open: boolean; onClose: () => void; rootId: string; rate: number }) {
  const data = useLiveQuery(async () => {
    if (!open) return null;
    const chats = await db.chats.where('pageId').equals(rootId).toArray();
    const rows: { id: string; label: string; cost: number; words: number; at: number }[] = [];
    for (const c of chats) {
      const msgs = await db.messages.where('chatId').equals(c.id).sortBy('seq');
      msgs.forEach((m, i) => {
        if (m.role !== 'assistant' || m.costUsd === 0) return;
        const u = msgs[i - 1];
        const label = u?.text ? u.text.slice(0, 60) : m.length === 'opening' ? 'Pembukaan' : 'Lanjutkan';
        const v = m.versions[m.active];
        rows.push({ id: m.id, label: (c.kind === 'discuss' ? 'Diskusi: ' : '') + label, cost: m.costUsd, words: v?.words ?? 0, at: m.createdAt });
      });
    }
    rows.sort((a, b) => b.at - a.at);
    return rows;
  }, [open, rootId]);
  const total = (data ?? []).reduce((n, r) => n + r.cost, 0);
  return (
    <Sheet open={open} onClose={onClose} title="Riwayat biaya">
      <div className="cost-total">
        Total cerita ini: <b>{formatRupiah(total * rate)}</b> <small>({formatUsd(total)})</small>
      </div>
      {(data ?? []).length === 0 && <p className="note">Belum ada pemakaian AI.</p>}
      {(data ?? []).map((r) => (
        <div key={r.id} className="cost-row">
          <span className="cost-label">{r.label}</span>
          <span className="cost-val">{formatRupiah(r.cost * rate)}</span>
        </div>
      ))}
    </Sheet>
  );
}
