import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { db, type Page } from '../db';
import type { Editor as TEditor } from '@tiptap/react';
import { StoryEditor, type StreamInfo } from '../components/Editor';
import { FindBar } from '../components/FindBar';
import { NotesSheet, SummariesSheet } from '../components/StoryTools';
import {
  IconArrowBottom,
  IconArrowTop,
  IconBack,
  IconChat,
  IconDown,
  IconHistory,
  IconList,
  IconMore,
  IconNotes,
  IconPage,
  IconSearch,
  IconSettings,
  IconShare,
  IconSparkle,
  IconStop,
  IconUp,
} from '../components/Icons';
import { ExportSheet, IconPicker, PageMenu } from '../components/PageMenu';
import { BottomBar, PromptSheet, Sheet, SheetItem, toast } from '../components/ui';
import { getBrief } from '../lib/context';
import { flushEditors, registerFlush } from '../lib/editors';
import { stopGeneration, useActiveGen } from '../lib/generate';
import { discardIfUntouched, displayTitle, getMainChat, moveChapter, renamePage } from '../lib/pages';
import { goBack, takeJump, takeRedirect, type NavState } from '../lib/nav';
import { markChanged, useSettings } from '../lib/settings';
import { debounce, formatNumber, formatRupiah, formatUsd } from '../lib/util';

/** Jumlah tampilan yang sedang membuka tiap page (StrictMode memasang komponen dua kali). */
const openPages = new Map<string, number>();

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
  // "Jadikan cerita" dari roleplay sedang menulis ke page ini: kunci editor (tanpa widget aliran teks).
  const convertingHere = !!gen && gen.mode === 'convert' && gen.pageId === id;
  const lockedHere = streamingHere || convertingHere;

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
  const [findOpen, setFindOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState<null | { from?: string }>(null);
  const [summariesOpen, setSummariesOpen] = useState(false);
  const [editor, setEditor] = useState<TEditor | null>(null);
  const [title, setTitle] = useState('');
  const titleFocused = useRef(false);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);

  // Kembali dari chat lalu langsung pindah ke page tujuan (lihat lib/nav.ts).
  useEffect(() => {
    const to = takeRedirect(id);
    if (to && to !== id) nav(`/page/${to}`, { replace: true });
  }, [id, nav]);

  // Catat waktu dibuka. Saat ditinggal, page yang tidak pernah diisi dihapus.
  useEffect(() => {
    if (!id) return;
    void db.pages.update(id, { openedAt: Date.now() });
    restored.current = false;
    openPages.set(id, (openPages.get(id) ?? 0) + 1);
    return () => {
      openPages.set(id, (openPages.get(id) ?? 1) - 1);
      setTimeout(() => {
        if ((openPages.get(id) ?? 0) > 0) return;
        void flushEditors().then(() => discardIfUntouched(id));
      }, 400);
    };
  }, [id]);

  // Judul dari database (mis. usulan AI) hanya ditimpa kalau pengguna tidak sedang mengetik judul.
  useEffect(() => {
    if (page && !titleFocused.current) setTitle(page.title);
  }, [page?.id, page?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveTitle = useMemo(() => debounce((pid: string, t: string) => void renamePage(pid, t), 600), []);
  useEffect(() => {
    const off = registerFlush(() => saveTitle.flush());
    return () => {
      saveTitle.flush();
      off();
    };
  }, [saveTitle]);

  // Page baru: fokus ke judul sekali, lalu buang penanda ?new=1 supaya tidak fokus lagi saat kembali.
  useEffect(() => {
    if (!page || params.get('new') !== '1') return;
    titleRef.current?.focus();
    params.delete('new');
    setParams(params, { replace: true });
  }, [page?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const jump = takeJump(page.id);
      const seg = jump?.seg ?? params.get('seg');
      if (seg) {
        const target = el.querySelector(`[data-seg="${CSS.escape(seg)}"]`);
        if (target) {
          target.scrollIntoView({ block: 'start' });
          target.classList.add('flash');
          setTimeout(() => target.classList.remove('flash'), 1600);
        }
        if (params.get('seg')) {
          params.delete('seg');
          setParams(params, { replace: true });
        }
      } else if (jump?.end || params.get('end')) {
        el.scrollTop = el.scrollHeight;
      } else {
        el.scrollTop = page.scrollY;
      }
    });
  }, [page, params, setParams]);

  // Ikuti tulisan AI selama streaming (di posisinya di naskah), kecuali pengguna menggulir ke atas.
  useEffect(() => {
    if (!streamingHere || !follow.current) return;
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      const w = el.querySelector('.stream-widget');
      if (!w) return;
      const delta = w.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom + 140;
      if (delta > 0) el.scrollTop += delta;
    });
  }, [streamingHere, gen?.live, gen?.thinking]);

  const stream: StreamInfo | null = useMemo(
    () => (streamingHere && gen ? { seg: gen.messageId, text: gen.live, thinking: gen.thinking } : null),
    [streamingHere, gen?.messageId, gen?.live, gen?.thinking], // eslint-disable-line react-hooks/exhaustive-deps
  );

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
  const askState: NavState = { fromPage: page.id };

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
        <button className="icon-btn" aria-label="Kembali" onClick={() => goBack(nav)}>
          <IconBack />
        </button>
        <div className="crumb">
          {isChapter && root && (
            <Link to={`/page/${root.id}`} replace className="crumb-link">
              {root.icon} {displayTitle(root)} ›
            </Link>
          )}
        </div>
        <button className="icon-btn" aria-label="Cari & ganti" onClick={() => setFindOpen((v) => !v)}>
          <IconSearch />
        </button>
        <button className="icon-btn" aria-label="Ekspor" onClick={() => setExportOpen(true)}>
          <IconShare />
        </button>
        <button className="icon-btn" aria-label="Menu page" onClick={() => setMenuOpen(true)}>
          <IconMore />
        </button>
      </header>

      {findOpen && rootId && <FindBar key={page.id} editor={editor} rootId={rootId} pageId={page.id} onClose={() => setFindOpen(false)} />}

      <div
        className="scroll-area page-scroll"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          saveScroll(page.id, el.scrollTop);
          if (streamingHere) {
            const w = el.querySelector('.stream-widget');
            follow.current = !w || w.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom < 260;
          }
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
            onFocus={() => (titleFocused.current = true)}
            onBlur={() => {
              titleFocused.current = false;
              saveTitle.flush();
            }}
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
              titleRef.current = t;
              if (t) {
                t.style.height = 'auto';
                t.style.height = t.scrollHeight + 'px';
              }
            }}
          />

          {empty && !lockedHere && (
            <div className="page-hint">
              {mainChat || isChapter
                ? 'Halaman ini masih kosong. Ketik langsung, atau ketuk Ask AI untuk meminta AI menulis.'
                : 'Ketuk Ask AI dan tulis brief cerita (gambaran besar, karakter, gambaran pembukaan, aturan penulisan). AI akan menulis pembukaan di sini.'}
            </div>
          )}

          <StoryEditor
            key={page.id}
            page={page}
            editable={!lockedHere}
            stream={stream}
            onFocusChange={setEditing}
            onReady={onEditorReady}
            onEditor={setEditor}
          />

          <div className="page-foot">
            {!isChapter && (chapters?.length ?? 0) > 0 && (
              <div className="child-links">
                {chapters!.map((c) => (
                  <Link key={c.id} to={`/page/${c.id}`} replace className="child-link">
                    <IconPage size={18} /> {displayTitle(c)}
                    <small>{formatNumber(c.words)} kata</small>
                  </Link>
                ))}
              </div>
            )}
            {(prev || next) && (
              <div className="chapter-nav">
                {prev ? (
                  <Link to={`/page/${prev.id}`} replace className="btn">
                    ‹ {isChapter && prev.id === rootId ? 'Pembukaan' : 'Bab sebelumnya'}
                  </Link>
                ) : (
                  <span />
                )}
                {next ? (
                  <Link to={`/page/${next.id}`} replace className="btn">
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

      {convertingHere ? (
        <div className="gen-bar">
          <IconSparkle size={16} />
          <span className="gen-text">Menjadikan cerita · {gen.status ?? ''}</span>
          <button className="btn btn-small" onClick={() => nav(`/rp/chat/${gen.chatId}`)}>
            <IconChat size={16} /> Chat
          </button>
          <button className="btn btn-small btn-danger" onClick={stopGeneration}>
            <IconStop size={16} /> Stop
          </button>
        </div>
      ) : streamingHere ? (
        <div className="gen-bar">
          <IconSparkle size={16} />
          <span className="gen-text">
            {gen.status ?? (gen.thinking && !gen.live ? 'AI sedang berpikir…' : `AI sedang menulis · ${formatNumber(gen.words)} kata`)}
          </span>
          <button className="btn btn-small" onClick={() => nav(`/chat/${gen.chatId}`, { state: askState })}>
            <IconChat size={16} /> Chat
          </button>
          <button className="btn btn-small btn-danger" onClick={stopGeneration}>
            <IconStop size={16} /> Stop
          </button>
        </div>
      ) : (
        !editing && !findOpen && <BottomBar askHref={askHref} askState={askState} />
      )}

      <PageMenu
        page={page}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onOpenPage={(pid) => nav(`/page/${pid}`, { replace: true })}
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
              icon={<IconNotes />}
              label="Catatan cerita"
              hint="Fakta yang harus konsisten, selalu dibaca AI"
              onClick={() => {
                setMenuOpen(false);
                setNotesOpen({});
              }}
            />
            {!empty && mainChat && (
              <SheetItem
                icon={<IconSparkle />}
                label="Perbarui catatan dari bab ini"
                hint="AI mengusulkan, Anda yang memutuskan"
                onClick={() => {
                  setMenuOpen(false);
                  setNotesOpen({ from: page.id });
                }}
              />
            )}
            <SheetItem
              icon={<IconList />}
              label="Ringkasan bab lama"
              hint="Untuk cerita yang mendekati batas konteks model"
              onClick={() => {
                setMenuOpen(false);
                setSummariesOpen(true);
              }}
            />
            <SheetItem
              icon={<IconChat />}
              label="Chat baru untuk diskusi"
              hint="AI membaca cerita, tapi tidak menulis ke page"
              onClick={() => {
                setMenuOpen(false);
                nav(`/chat/new?page=${rootId}&kind=discuss&from=${page.id}`, { state: askState });
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
          if (!v.trim()) {
            toast('Brief tidak boleh kosong.');
            return;
          }
          if (b) await db.messages.update(b.id, { text: v.trim() });
          markChanged();
          toast('Brief disimpan');
        }}
      />
      {rootId && <NotesSheet rootId={rootId} open={!!notesOpen} fromPageId={notesOpen?.from} onClose={() => setNotesOpen(null)} />}
      {rootId && <SummariesSheet rootId={rootId} open={summariesOpen} onClose={() => setSummariesOpen(false)} />}
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
    for (const u of await db.usage.where('rootId').equals(rootId).toArray()) {
      if (u.costUsd === 0 && !u.costUnknown) continue;
      rows.push({ id: u.id, label: u.label, cost: u.costUsd, words: 0, at: u.at });
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
