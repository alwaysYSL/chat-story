import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { db, type Attachment, type LengthPreset, type Message, type Page } from '../db';
import { MarkdownView } from '../components/Blocks';
import {
  IconArrowBottom,
  IconBack,
  IconBulb,
  IconCheck,
  IconChevronDown,
  IconClose,
  IconCopy,
  IconEdit,
  IconFile,
  IconFwd,
  IconHistory,
  IconImage,
  IconMore,
  IconPage,
  IconPlus,
  IconRetry,
  IconSend,
  IconSparkle,
  IconStop,
  IconText,
  IconTrash,
} from '../components/Icons';
import { ModelPicker } from '../components/Providers';
import { PromptSheet, Sheet, SheetItem, toast, useLongPress } from '../components/ui';
import {
  cancelMessage,
  continueMessage,
  retryMessage,
  selectVersion,
  sendMessage,
  stopGeneration,
  useActiveGen,
  UserError,
  type PendingAttachment,
} from '../lib/generate';
import { compressImage, IMAGE_TYPES, MAX_TEXT_BYTES, TEXT_EXT } from '../lib/images';
import { cleanOutput, segmentText } from '../lib/markdown';
import { setJump, type NavState } from '../lib/nav';
import { displayTitle } from '../lib/pages';
import { isPeak } from '../lib/pricing';
import { findModel, usableModels, type ModelRef } from '../lib/providers';
import { LENGTH_LABEL, targetRange } from '../lib/prompts';
import { useSettings, type Settings } from '../lib/settings';
import { copyText, debounce, formatNumber, formatRupiah } from '../lib/util';

const NEW_DRAFT_KEY = (scope: string) => `draft:new:${scope}`;

type Menu = { m: Message; pair: Message | undefined } | null;

type Row =
  | { type: 'user'; m: Message; reply: Message | undefined }
  | { type: 'ai'; m: Message; user: Message | undefined }
  | { type: 'canceled'; key: string; count: number; msgs: Message[] };

export default function ChatScreen() {
  const { id = 'new' } = useParams();
  const [params] = useSearchParams();
  const loc = useLocation();
  const nav = useNavigate();
  const settings = useSettings();
  const isNew = id === 'new';
  const chat = useLiveQuery(async () => (isNew ? null : ((await db.chats.get(id)) ?? null)), [id]);
  const messages = useLiveQuery(
    async () => (isNew ? [] : db.messages.where('chatId').equals(id).sortBy('seq')),
    [id],
  );
  const paramPage = params.get('page');
  const fromPage = params.get('from');
  /** page yang membuka chat ini; kembali ke page itu cukup dengan history.back */
  const cameFrom = (loc.state as NavState | null)?.fromPage ?? null;
  const rootId = chat?.pageId ?? paramPage ?? null;
  const kind = chat?.kind ?? (params.get('kind') === 'discuss' ? 'discuss' : rootId ? 'main' : 'free');
  const storyPages = useLiveQuery(async () => {
    if (!rootId) return [] as Page[];
    const root = await db.pages.get(rootId);
    if (!root || root.deletedAt) return [] as Page[];
    const ch = (await db.pages.where('parentId').equals(rootId).toArray())
      .filter((p) => !p.deletedAt)
      .sort((a, b) => a.order - b.order);
    return [root, ...ch];
  }, [rootId]);
  const attachmentMap = useLiveQuery(async () => {
    const ids = (messages ?? []).flatMap((m) => m.attachmentIds);
    const list = await db.attachments.bulkGet(ids);
    return new Map(list.filter(Boolean).map((a) => [a!.id, a!]));
  }, [messages]);
  const gen = useActiveGen();

  const draftScope = isNew ? NEW_DRAFT_KEY(rootId ?? kind) : null;
  const [text, setText] = useState('');
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [write, setWrite] = useState(true);
  const [target, setTarget] = useState<'last' | 'new'>('last');
  const [length, setLength] = useState<LengthPreset>('normal');
  const [model, setModel] = useState<ModelRef | null>(null);
  const [thinking, setThinking] = useState<boolean | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [menu, setMenu] = useState<Menu>(null);
  const [editMsg, setEditMsg] = useState<Message | null>(null);
  const [editBrief, setEditBrief] = useState<Message | null>(null);
  const [selectText, setSelectText] = useState<string | null>(null);
  const [briefOpen, setBriefOpen] = useState(false);
  const [showCanceled, setShowCanceled] = useState(false);
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});
  const [sending, setSending] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const loadedDraft = useRef(false);

  // Model aktif: pilihan barusan → model terakhir di chat ini → model default → model pertama yang punya API key.
  const usable = settings ? usableModels(settings.providers) : [];
  const pickRef = (r: ModelRef | null | undefined) =>
    r && usable.some((u) => u.provider.id === r.provider && u.model.id === r.model) ? r : null;
  const firstUsable = usable[0] ? { provider: usable[0].provider.id, model: usable[0].model.id } : null;
  const lastSent = [...(messages ?? [])].reverse().find((m) => m.role === 'user' && m.model);
  const lastUsed: ModelRef | null = lastSent ? { provider: lastSent.provider ?? 'deepseek', model: lastSent.model } : null;
  const effModel: ModelRef | null = pickRef(model) ?? pickRef(lastUsed) ?? pickRef(settings?.defaultModel) ?? firstUsable;
  const resolved = settings && effModel ? findModel(settings.providers, effModel) : null;
  const effThinking = thinking ?? settings?.thinking ?? false;

  // Muat draf
  useEffect(() => {
    if (loadedDraft.current) return;
    if (isNew) {
      setText(localStorage.getItem(draftScope!) ?? '');
      loadedDraft.current = true;
    } else if (chat) {
      setText(chat.draft ?? '');
      loadedDraft.current = true;
    }
  }, [isNew, chat, draftScope]);

  const saveDraft = useMemo(
    () =>
      debounce((value: string) => {
        if (isNew) localStorage.setItem(draftScope!, value);
        else void db.chats.update(id, { draft: value });
      }, 500),
    [isNew, id, draftScope],
  );
  useEffect(() => () => saveDraft.flush(), [saveDraft]);

  // Tinggi kolom ketik mengikuti isi (juga saat draf dimuat).
  useEffect(() => {
    const t = inputRef.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, window.innerHeight * 0.4) + 'px';
  }, [text]);

  // Ikuti pesan terbaru hanya kalau pengguna sedang di bawah.
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages?.length, gen?.live, gen?.words]);

  const rows = useMemo(() => buildRows(messages ?? [], kind === 'main'), [messages, kind]);

  if (!settings || (!isNew && chat === undefined)) return <div className="screen" />;
  if (!isNew && chat === null) {
    return (
      <div className="screen">
        <div className="empty">
          <h2>Chat tidak ditemukan</h2>
          <button className="btn" onClick={() => nav('/chats')}>
            Ke daftar chat
          </button>
        </div>
      </div>
    );
  }

  const list = messages ?? [];
  const root = storyPages?.[0];
  const lastPage = storyPages?.[storyPages.length - 1];
  const totalWords = (storyPages ?? []).reduce((n, p) => n + p.words, 0);
  const canWrite = kind !== 'discuss';
  const writeOn = canWrite && write;
  const isOpening = !root || totalWords === 0;
  const busy = !!gen;
  const genHere = !!gen && gen.chatId === id;
  const brief = kind === 'main' ? list.find((m) => m.role === 'user') : undefined;
  const lastAsst = [...list].reverse().find((m) => m.role === 'assistant' && m.status !== 'canceled');
  const lastUser = lastAsst ? list[list.findIndex((m) => m.id === lastAsst.id) - 1] : undefined;
  const hasImages =
    pending.some((p) => p.kind === 'image') || [...(attachmentMap?.values() ?? [])].some((a) => a.kind === 'image');
  const peak = settings.peakWarning && isPeak() && resolved?.provider.kind === 'deepseek';
  const empty = !text.trim() && !pending.length;
  const canContinue = writeOn && !isOpening && empty;

  /* ---------- Navigasi ke page tanpa menumpuk riwayat ---------- */
  const goToPage = (pageId: string, seg?: string) => {
    setJump(seg ? { pageId, seg } : { pageId, end: true });
    if (cameFrom === pageId) nav(-1);
    else nav(`/page/${pageId}`, { replace: true });
  };

  const handleError = (e: unknown) => {
    if (e instanceof UserError) {
      toast(e.message);
      if (e.code === 'nokey') nav('/settings#penyedia');
    } else toast('Terjadi kesalahan: ' + String(e));
  };

  const pickFiles = async (files: FileList | null) => {
    if (!files) return;
    const out: PendingAttachment[] = [];
    for (const f of Array.from(files)) {
      try {
        if (IMAGE_TYPES.includes(f.type)) {
          const { blob } = await compressImage(f);
          out.push({ kind: 'image', name: f.name, mime: 'image/jpeg', blob, text: null, previewUrl: URL.createObjectURL(blob) });
        } else if (TEXT_EXT.test(f.name) || f.type.startsWith('text/')) {
          if (f.size > MAX_TEXT_BYTES) {
            toast(`${f.name} terlalu besar (maks. 500 KB).`);
            continue;
          }
          out.push({ kind: 'text', name: f.name, mime: f.type || 'text/plain', blob: null, text: await f.text() });
        } else {
          toast(`${f.name}: format tidak didukung. Gunakan gambar (JPG, PNG, WebP, GIF) atau file .txt/.md.`);
        }
      } catch {
        toast(`Gagal membaca ${f.name}.`);
      }
    }
    setPending((p) => [...p, ...out]);
  };

  const doSend = async () => {
    const continueOnly = canContinue;
    if (!continueOnly && empty) return;
    if (sending) return;
    if (!effModel) {
      toast('Isi API key salah satu penyedia AI dulu di Pengaturan.');
      nav('/settings#penyedia');
      return;
    }
    setSending(true);
    try {
      const res = await sendMessage({
        chatId: isNew ? null : id,
        pageId: isNew ? paramPage : (chat?.pageId ?? null),
        kind,
        text: continueOnly ? '' : text,
        attachments: continueOnly ? [] : pending,
        write: writeOn,
        target,
        length,
        model: effModel,
        thinking: effThinking,
      });
      setText('');
      setPending([]);
      saveDraft.cancel();
      if (isNew) localStorage.removeItem(draftScope!);
      setTarget('last');
      stick.current = true;
      if (res.writePageId) goToPage(res.writePageId);
      else if (isNew) nav(`/chat/${res.chatId}`, { replace: true, state: loc.state });
    } catch (e) {
      handleError(e);
    } finally {
      setSending(false);
    }
  };

  /* ---------- Aksi pesan ---------- */
  const replyText = (m: Message): string => {
    if (m.mode !== 'write') return m.text;
    const p = storyPages?.find((x) => x.id === m.targetPageId);
    const cur = p ? segmentText(p.doc, m.id) : null;
    if (cur) return cur;
    const v = m.versions[m.active];
    return v ? cleanOutput(v.raw, m.expectTitle, true).body : '';
  };
  const copy = async (t: string) => toast((await copyText(t)) ? 'Disalin' : 'Gagal menyalin');
  const retry = async (asst: Message) => {
    try {
      await retryMessage(asst.id);
      if (asst.mode === 'write' && asst.targetPageId) goToPage(asst.targetPageId);
    } catch (e) {
      handleError(e);
    }
  };
  const resume = async (asst: Message) => {
    try {
      await continueMessage(asst.id);
      if (asst.targetPageId) goToPage(asst.targetPageId);
    } catch (e) {
      handleError(e);
    }
  };
  const cancel = async (asst: Message) => {
    try {
      await cancelMessage(asst.id);
      toast('Balasan dibatalkan');
    } catch (e) {
      handleError(e);
    }
  };

  /* ---------- Catatan di atas kolom ketik (maks. satu) ---------- */
  let note: ReactNode = null;
  if (!effModel) {
    note = (
      <div className="composer-note warn">
        <span>Belum ada penyedia AI dengan API key.</span>
        <button className="link-btn" onClick={() => nav('/settings#penyedia')}>
          Atur sekarang
        </button>
      </div>
    );
  } else if (resolved && !resolved.model.vision && hasImages && !dismissed.vision) {
    note = (
      <Note onClose={() => setDismissed((d) => ({ ...d, vision: true }))} warn>
        {resolved.model.label} tidak bisa membaca gambar, jadi gambar dilewati.
      </Note>
    );
  } else if (
    writeOn &&
    !isOpening &&
    target === 'last' &&
    !dismissed.chapter &&
    (lastPage?.words ?? 0) >= settings.chapterThreshold
  ) {
    note = (
      <Note onClose={() => setDismissed((d) => ({ ...d, chapter: true }))}>
        <span>Bab ini sudah {formatNumber(lastPage!.words)} kata.</span>
        <button className="link-btn" onClick={() => setTarget('new')}>
          Lanjut di bab baru
        </button>
      </Note>
    );
  } else if (writeOn && !isOpening && fromPage && lastPage && fromPage !== lastPage.id && !dismissed.old) {
    note = (
      <Note onClose={() => setDismissed((d) => ({ ...d, old: true }))}>
        AI menulis di akhir bab terakhir ({displayTitle(lastPage)}) atau di bab baru.
      </Note>
    );
  }

  const modeLabel = !canWrite
    ? null
    : !writeOn
      ? 'Diskusi'
      : isOpening
        ? 'Pembukaan'
        : target === 'new'
          ? `Bab baru · ${LENGTH_LABEL[length]}`
          : LENGTH_LABEL[length];
  const headerTitle = chat?.title ?? (kind === 'discuss' ? 'Diskusi baru' : 'Chat baru');

  return (
    <div className="screen chat-screen">
      <header className="page-header">
        <button className="icon-btn" aria-label="Kembali" onClick={() => (history.length > 1 ? nav(-1) : nav('/'))}>
          <IconBack />
        </button>
        <div className="chat-head-title">
          <span>{headerTitle}</span>
        </div>
        <button className="icon-btn" aria-label="Riwayat chat" onClick={() => nav('/chats')}>
          <IconHistory />
        </button>
        <button className="icon-btn" aria-label="Chat baru" onClick={() => nav('/chat/new', { replace: true })}>
          <IconEdit />
        </button>
      </header>

      {root && (
        <div className="chip-row">
          <button className="page-chip" onClick={() => goToPage(cameFrom ?? fromPage ?? root.id)}>
            {root.icon} {displayTitle(root)}
          </button>
          {kind === 'discuss' && <span className="kind-chip">Diskusi</span>}
        </div>
      )}

      <div
        className="scroll-area chat-list-area"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          stick.current = bottom;
          if (bottom !== atBottom) setAtBottom(bottom);
        }}
      >
        {brief && (
          <BriefPin
            m={brief}
            open={briefOpen}
            onToggle={() => setBriefOpen((v) => !v)}
            onMenu={() => setMenu({ m: brief, pair: list[list.indexOf(brief) + 1] })}
          />
        )}

        {list.length === 0 && (
          <div className="chat-empty">
            <div className="ai-face">
              <IconSparkle size={30} />
            </div>
            {kind === 'discuss' ? (
              <p>Tanyakan apa saja tentang cerita ini. AI sudah membaca brief dan seluruh naskah, tetapi tidak menulis ke page.</p>
            ) : root ? (
              <p>Tulis brief atau arahan. Dengan mode ✍ Tulis, AI langsung menulis di page cerita.</p>
            ) : (
              <p>
                Tulis brief cerita: gambaran besar, karakter, gambaran pembukaan, aturan penulisan pembukaan, dan aturan
                penulisan lanjutan. Dengan mode ✍ Tulis, AI menulis pembukaan di page baru.
              </p>
            )}
          </div>
        )}

        {rows.map((r) => {
          if (r.type === 'canceled') {
            return (
              <div key={r.key} className="canceled-group">
                <button className="canceled-line" onClick={() => setShowCanceled((v) => !v)}>
                  {r.count} balasan dibatalkan {showCanceled ? '· sembunyikan' : ''}
                </button>
                {showCanceled &&
                  r.msgs.map((m) =>
                    m.role === 'user' ? (
                      <div key={m.id} className="msg user canceled">
                        <div className="bubble">{m.text || <i>Lanjutkan saja</i>}</div>
                      </div>
                    ) : null,
                  )}
              </div>
            );
          }
          if (r.type === 'user') {
            if (r.m.id === brief?.id) return null;
            return (
              <UserBubble
                key={r.m.id}
                m={r.m}
                atts={r.m.attachmentIds.map((a) => attachmentMap?.get(a)).filter(Boolean) as Attachment[]}
                onMenu={() => setMenu({ m: r.m, pair: r.reply })}
              />
            );
          }
          const m = r.m;
          const streaming = genHere && gen!.messageId === m.id;
          const isLast = m.id === lastAsst?.id;
          const actions =
            isLast && !streaming ? (
              <ActionRow
                m={m}
                busy={busy}
                onCopy={() => void copy(replyText(m))}
                onRetry={() => void retry(m)}
                onResume={() => void resume(m)}
                onVersion={(i) => void selectVersion(m.id, i).catch(handleError)}
                onMore={() => setMenu({ m, pair: r.user })}
              />
            ) : null;
          return m.mode === 'write' ? (
            <WriteCard
              key={m.id}
              m={m}
              pages={storyPages ?? []}
              streaming={!!streaming}
              live={streaming ? gen!.words : 0}
              thinking={!!streaming && gen!.thinking && !gen!.live}
              rate={settings.usdToIdr}
              onOpen={() => m.targetPageId && goToPage(m.targetPageId, m.versions.length ? m.id : undefined)}
              onMenu={() => setMenu({ m, pair: r.user })}
              actions={actions}
            />
          ) : (
            <DiscussBubble
              key={m.id}
              m={m}
              live={streaming ? gen!.live : null}
              thinking={!!streaming && gen!.thinking && !gen!.live}
              rate={settings.usdToIdr}
              onMenu={() => setMenu({ m, pair: r.user })}
              actions={actions}
            />
          );
        })}
      </div>

      {!atBottom && (
        <button
          className="icon-btn small-float to-bottom"
          aria-label="Ke pesan terbaru"
          onClick={() => {
            stick.current = true;
            listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
          }}
        >
          <IconArrowBottom size={18} />
        </button>
      )}

      <div className="composer">
        {note}

        {pending.length > 0 && (
          <div className="pending-row">
            {pending.map((p, i) => (
              <div key={i} className="pending-item">
                {p.kind === 'image' ? (
                  <img src={p.previewUrl} alt={p.name} />
                ) : (
                  <span className="pending-file">
                    <IconFile size={18} />
                    {p.name}
                  </span>
                )}
                <button className="pending-x" aria-label="Hapus lampiran" onClick={() => setPending((arr) => arr.filter((_, j) => j !== i))}>
                  <IconClose size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="composer-box">
          <textarea
            ref={inputRef}
            className="composer-input"
            rows={1}
            placeholder={
              kind === 'discuss'
                ? 'Tanya tentang cerita…'
                : writeOn
                  ? isOpening
                    ? 'Tulis brief cerita…'
                    : 'Arahan lanjutan…'
                  : 'Diskusi dengan AI…'
            }
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              saveDraft(e.target.value);
            }}
          />
          <div className="composer-bar">
            <button className="icon-btn" aria-label="Lampirkan" onClick={() => setPlusOpen(true)}>
              <IconPlus size={20} />
            </button>
            {modeLabel && (
              <button className={'chip mode-chip' + (writeOn ? ' write' : '')} aria-label="Mode menulis" onClick={() => setModeOpen(true)}>
                <span className="chip-ico">{writeOn ? '✍' : '💬'}</span>
                <span className="chip-text">{modeLabel}</span>
                <IconChevronDown size={14} />
              </button>
            )}
            <button className="chip model-chip" aria-label="Ganti model" onClick={() => setPickerOpen(true)}>
              {effThinking && <IconBulb size={14} aria-label="Mode berpikir nyala" />}
              <span className="chip-text">{resolved ? resolved.model.label : 'Pilih model'}</span>
              {peak && <span className="peak-dot" aria-label="Jam peak" />}
              <IconChevronDown size={14} />
            </button>
            <span className="fmt-spacer" />
            {genHere ? (
              <button className="send-btn stop" aria-label="Stop" onClick={stopGeneration}>
                <IconStop size={18} />
              </button>
            ) : canContinue ? (
              <button className="send-btn wide" aria-label="Lanjutkan" disabled={busy || sending} onClick={() => void doSend()}>
                <IconFwd size={16} /> Lanjutkan
              </button>
            ) : (
              <button className="send-btn" aria-label="Kirim" disabled={busy || sending || empty} onClick={() => void doSend()}>
                <IconSend size={18} />
              </button>
            )}
          </div>
        </div>
        <input
          ref={imageRef}
          type="file"
          hidden
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={(e) => {
            void pickFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={fileRef}
          type="file"
          hidden
          multiple
          accept=".txt,.md,text/plain,text/markdown"
          onChange={(e) => {
            void pickFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {/* ---------- Sheet ---------- */}

      <Sheet open={plusOpen} onClose={() => setPlusOpen(false)} title="Lampirkan">
        <SheetItem
          icon={<IconImage />}
          label="Foto"
          hint={resolved && !resolved.model.vision ? `${resolved.model.label} tidak bisa membaca gambar` : 'Referensi karakter, lokasi, suasana'}
          onClick={() => {
            setPlusOpen(false);
            imageRef.current?.click();
          }}
        />
        <SheetItem
          icon={<IconFile />}
          label="File teks"
          hint=".txt atau .md"
          onClick={() => {
            setPlusOpen(false);
            fileRef.current?.click();
          }}
        />
      </Sheet>

      <ModeSheet
        open={modeOpen}
        onClose={() => setModeOpen(false)}
        settings={settings}
        write={write}
        setWrite={setWrite}
        isOpening={isOpening}
        target={target}
        setTarget={setTarget}
        length={length}
        setLength={setLength}
        lastPage={lastPage}
        nextChapter={(storyPages?.length ?? 1) + 1}
      />

      <ModelPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        value={effModel ?? { provider: '', model: '' }}
        onPick={setModel}
        thinking={effThinking}
        onThinking={setThinking}
        peak={peak}
      />

      <MessageMenu
        menu={menu}
        onClose={() => setMenu(null)}
        busy={busy}
        brief={brief}
        lastAsst={lastAsst}
        lastUser={lastUser}
        replyText={replyText}
        onCopy={(t) => void copy(t)}
        onSelect={setSelectText}
        onEdit={setEditMsg}
        onEditBrief={setEditBrief}
        onRetry={(a) => void retry(a)}
        onResume={(a) => void resume(a)}
        onCancel={(a) => void cancel(a)}
        onOpen={(a) => a.targetPageId && goToPage(a.targetPageId, a.versions.length ? a.id : undefined)}
      />

      <Sheet open={selectText !== null} onClose={() => setSelectText(null)} title="Pilih teks">
        <textarea className="input textarea-lg select-text" readOnly value={selectText ?? ''} />
        <div className="row-buttons">
          <button
            className="btn btn-primary"
            onClick={() => {
              void copy(selectText ?? '');
              setSelectText(null);
            }}
          >
            Salin semua
          </button>
        </div>
      </Sheet>

      <PromptSheet
        open={!!editMsg}
        title={editMsg?.id === brief?.id ? 'Edit brief & tulis ulang pembukaan' : 'Edit pesan & tulis ulang'}
        initial={editMsg?.text ?? ''}
        multiline
        confirmLabel="Tulis ulang"
        note="AI menulis ulang balasan terakhir dengan pesan ini. Versi lama tetap tersimpan (maks. 3 versi)."
        onClose={() => setEditMsg(null)}
        onSubmit={async (v) => {
          if (!editMsg) return;
          const reply = list[list.findIndex((x) => x.id === editMsg.id) + 1];
          if (!reply) return;
          try {
            await retryMessage(reply.id, v);
            if (reply.mode === 'write' && reply.targetPageId) goToPage(reply.targetPageId);
          } catch (e) {
            handleError(e);
          }
        }}
      />

      <PromptSheet
        open={!!editBrief}
        title="Edit brief"
        initial={editBrief?.text ?? ''}
        multiline
        note="Perubahan brief berlaku untuk tulisan AI berikutnya. Tulisan yang sudah ada tidak berubah."
        onClose={() => setEditBrief(null)}
        onSubmit={async (v) => {
          if (!editBrief) return;
          await db.messages.update(editBrief.id, { text: v.trim() });
          toast('Brief disimpan');
        }}
      />
    </div>
  );
}

/* ---------- Susun baris: pasangan yang dibatalkan dilipat jadi satu baris ---------- */

function buildRows(list: Message[], hasBrief: boolean): Row[] {
  const rows: Row[] = [];
  const briefId = hasBrief ? list.find((m) => m.role === 'user')?.id : undefined;
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (m.status === 'canceled' && m.id !== briefId) {
      const prev = rows[rows.length - 1];
      const isUser = m.role === 'user';
      if (prev?.type === 'canceled') {
        prev.msgs.push(m);
        if (isUser) prev.count++;
      } else rows.push({ type: 'canceled', key: 'c' + m.id, count: isUser ? 1 : 0, msgs: [m] });
      continue;
    }
    if (m.role === 'user') rows.push({ type: 'user', m, reply: list[i + 1]?.role === 'assistant' ? list[i + 1] : undefined });
    else rows.push({ type: 'ai', m, user: list[i - 1]?.role === 'user' ? list[i - 1] : undefined });
  }
  return rows.filter((r) => r.type !== 'canceled' || r.count > 0);
}

function costLabel(m: Message, rate: number): string {
  if (m.costUsd > 0) return formatRupiah(m.costUsd * rate) + (m.costUnknown ? '+' : '');
  return m.costUnknown ? 'biaya tidak diketahui' : '';
}

function shortModel(id: string): string {
  return id.split('/').pop() ?? id;
}

function Note({ children, onClose, warn }: { children: ReactNode; onClose: () => void; warn?: boolean }) {
  return (
    <div className={'composer-note' + (warn ? ' warn' : '')}>
      <span className="note-body">{children}</span>
      <button className="note-x" aria-label="Tutup" onClick={onClose}>
        <IconClose size={14} />
      </button>
    </div>
  );
}

/* ---------- Brief tersemat ---------- */

function BriefPin({ m, open, onToggle, onMenu }: { m: Message; open: boolean; onToggle: () => void; onMenu: () => void }) {
  const lp = useLongPress(onMenu);
  return (
    <div className={'brief-pin' + (open ? ' open' : '')}>
      <button className="brief-head" onClick={onToggle} {...lp}>
        <span className="brief-label">Brief</span>
        <span className="brief-preview">{open ? '' : m.text.replace(/\s+/g, ' ').slice(0, 90)}</span>
        <IconChevronDown size={16} className={open ? 'rot180' : ''} />
      </button>
      {open && (
        <div className="brief-body" {...lp}>
          {m.text}
        </div>
      )}
    </div>
  );
}

/* ---------- Bubble pengguna ---------- */

function UserBubble({ m, atts, onMenu }: { m: Message; atts: Attachment[]; onMenu: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const lp = useLongPress(onMenu);
  const long = m.text.length > 400;
  const urls = useMemo(() => atts.map((a) => (a.kind === 'image' && a.blob ? URL.createObjectURL(a.blob) : null)), [atts]);
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls]);
  return (
    <div className="msg user">
      <div className={'bubble pressable' + (long && !expanded ? ' clamp' : '')} {...lp}>
        {m.text ? m.text : <i>{m.mode === 'write' ? 'Lanjutkan saja' : '(lampiran)'}</i>}
      </div>
      {long && (
        <button className="link-btn" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Ringkas' : 'Lihat semua'}
        </button>
      )}
      {atts.length > 0 && (
        <div className="att-row">
          {atts.map((a, i) =>
            a.kind === 'image' && urls[i] ? (
              <img key={a.id} src={urls[i]!} alt={a.name} className="att-thumb" />
            ) : (
              <span key={a.id} className="pending-file">
                <IconFile size={16} />
                {a.name}
              </span>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Deretan ikon di balasan terakhir ---------- */

function ActionRow({
  m,
  busy,
  onCopy,
  onRetry,
  onResume,
  onVersion,
  onMore,
}: {
  m: Message;
  busy: boolean;
  onCopy: () => void;
  onRetry: () => void;
  onResume: () => void;
  onVersion: (i: number) => void;
  onMore: () => void;
}) {
  const hasText = m.mode === 'write' ? m.versions.length > 0 : !!m.text.trim();
  const resumable = m.mode === 'write' && (m.status === 'interrupted' || m.status === 'stopped') && hasText;
  return (
    <div className="action-row">
      {hasText && (
        <button className="act-btn" aria-label="Salin" onClick={onCopy}>
          <IconCopy size={17} />
        </button>
      )}
      <button className="act-btn" aria-label="Coba lagi" disabled={busy} onClick={onRetry}>
        <IconRetry size={17} />
      </button>
      {m.versions.length > 1 && m.mode === 'write' && (
        <span className="versions">
          <button className="act-btn" aria-label="Versi sebelumnya" disabled={busy || m.active === 0} onClick={() => onVersion(m.active - 1)}>
            ‹
          </button>
          {m.active + 1}/{m.versions.length}
          <button
            className="act-btn"
            aria-label="Versi berikutnya"
            disabled={busy || m.active >= m.versions.length - 1}
            onClick={() => onVersion(m.active + 1)}
          >
            ›
          </button>
        </span>
      )}
      {resumable && (
        <button className="act-text" disabled={busy} onClick={onResume}>
          Lanjutkan dari sini
        </button>
      )}
      <button className="act-btn" aria-label="Aksi lain" onClick={onMore}>
        <IconMore size={17} />
      </button>
    </div>
  );
}

function ErrorLine({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button className={'error-line' + (open ? ' open' : '')} onClick={() => setOpen((v) => !v)}>
      Gagal: {text}
    </button>
  );
}

/* ---------- Kartu balasan yang menulis ke page ---------- */

function WriteCard({
  m,
  pages,
  streaming,
  live,
  thinking,
  rate,
  onOpen,
  onMenu,
  actions,
}: {
  m: Message;
  pages: Page[];
  streaming: boolean;
  live: number;
  thinking: boolean;
  rate: number;
  onOpen: () => void;
  onMenu: () => void;
  actions: ReactNode;
}) {
  const lp = useLongPress(onMenu);
  const target = pages.find((p) => p.id === m.targetPageId);
  const v = m.versions[m.active];
  const status = streaming ? 'streaming' : m.status;
  const meta = streaming
    ? thinking
      ? 'AI sedang berpikir…'
      : `${formatNumber(live)} kata…`
    : [
        v ? `${formatNumber(v.words)} kata` : '',
        costLabel(m, rate),
        shortModel(m.model),
        status === 'stopped' ? 'dihentikan' : '',
        status === 'interrupted' ? 'terputus' : '',
      ]
        .filter(Boolean)
        .join(' · ');
  return (
    <div className="msg ai">
      <button className="write-line pressable" onClick={onOpen} disabled={!target} {...lp}>
        <span className="write-ico">✍</span>
        <span className="write-text">
          <span className="write-title">
            <small>{streaming ? 'Menulis di' : v ? 'Ditulis di' : 'Untuk'}</small> {target ? displayTitle(target) : 'page terhapus'}
          </span>
          {meta && <small>{meta}</small>}
        </span>
      </button>
      {status === 'error' && m.error && <ErrorLine text={m.error} />}
      {status === 'interrupted' && m.error && <div className="soft-line">{m.error}</div>}
      {actions}
    </div>
  );
}

/* ---------- Jawaban diskusi ---------- */

function DiscussBubble({
  m,
  live,
  thinking,
  rate,
  onMenu,
  actions,
}: {
  m: Message;
  live: string | null;
  thinking: boolean;
  rate: number;
  onMenu: () => void;
  actions: ReactNode;
}) {
  const lp = useLongPress(onMenu);
  const text = live ?? m.text;
  const meta = [costLabel(m, rate), shortModel(m.model), m.status === 'stopped' ? 'dihentikan' : '', m.status === 'interrupted' ? 'terputus' : '']
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="msg ai">
      <div className="bubble ai-bubble pressable" {...lp}>
        {text ? (
          <MarkdownView text={text} />
        ) : thinking ? (
          <i className="muted">AI sedang berpikir…</i>
        ) : live !== null ? (
          <span className="typing">
            <span />
            <span />
            <span />
          </span>
        ) : null}
      </div>
      {m.status === 'error' && m.error && <ErrorLine text={m.error} />}
      {live === null && meta && <div className="msg-meta">{meta}</div>}
      {actions}
    </div>
  );
}

/* ---------- Sheet mode menulis ---------- */

function ModeSheet({
  open,
  onClose,
  settings,
  write,
  setWrite,
  isOpening,
  target,
  setTarget,
  length,
  setLength,
  lastPage,
  nextChapter,
}: {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  write: boolean;
  setWrite: (v: boolean) => void;
  isOpening: boolean;
  target: 'last' | 'new';
  setTarget: (v: 'last' | 'new') => void;
  length: LengthPreset;
  setLength: (v: LengthPreset) => void;
  lastPage: Page | undefined;
  nextChapter: number;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Mode">
      <SheetItem
        icon={write ? <IconCheck /> : <span />}
        label="✍ Tulis ke page"
        hint="AI langsung menulis di naskah"
        onClick={() => setWrite(true)}
      />
      <SheetItem
        icon={!write ? <IconCheck /> : <span />}
        label="💬 Diskusi"
        hint="AI menjawab di chat, naskah tidak berubah"
        onClick={() => setWrite(false)}
      />
      {write && isOpening && (
        <p className="note pad">
          Pesan pertama ditulis sebagai pembukaan ({targetRange(settings, 'opening')}). Ubah targetnya di Pengaturan.
        </p>
      )}
      {write && !isOpening && (
        <>
          <div className="sheet-group">Tulis di</div>
          <SheetItem
            icon={target === 'last' ? <IconCheck /> : <span />}
            label={`Akhir ${displayTitle(lastPage)}`}
            hint="Bab terakhir"
            onClick={() => setTarget('last')}
          />
          <SheetItem
            icon={target === 'new' ? <IconCheck /> : <span />}
            label="Bab baru"
            hint={`Bagian ${nextChapter}`}
            onClick={() => setTarget('new')}
          />
          <div className="sheet-group">Panjang</div>
          <div className="segmented sheet-seg">
            {(['short', 'normal', 'long'] as LengthPreset[]).map((l) => (
              <button key={l} className={length === l ? 'active' : ''} onClick={() => setLength(l)}>
                {LENGTH_LABEL[l]}
                <small>{targetRange(settings, l).replace('sekitar ', '±')}</small>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="row-buttons pad">
        <button className="btn btn-primary" onClick={onClose}>
          Selesai
        </button>
      </div>
    </Sheet>
  );
}

/* ---------- Sheet aksi saat bubble ditahan ---------- */

function MessageMenu({
  menu,
  onClose,
  busy,
  brief,
  lastAsst,
  lastUser,
  replyText,
  onCopy,
  onSelect,
  onEdit,
  onEditBrief,
  onRetry,
  onResume,
  onCancel,
  onOpen,
}: {
  menu: Menu;
  onClose: () => void;
  busy: boolean;
  brief: Message | undefined;
  lastAsst: Message | undefined;
  lastUser: Message | undefined;
  replyText: (m: Message) => string;
  onCopy: (t: string) => void;
  onSelect: (t: string) => void;
  onEdit: (m: Message) => void;
  onEditBrief: (m: Message) => void;
  onRetry: (asst: Message) => void;
  onResume: (asst: Message) => void;
  onCancel: (asst: Message) => void;
  onOpen: (asst: Message) => void;
}) {
  const m = menu?.m;
  const pair = menu?.pair;
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  let items: ReactNode = null;
  let title = '';

  if (m?.role === 'user') {
    const isBrief = m.id === brief?.id;
    const isLast = m.id === lastUser?.id && !!pair && pair.id === lastAsst?.id;
    const t = m.text;
    title = isBrief ? 'Brief' : 'Pesan Anda';
    items = (
      <>
        {t && <SheetItem icon={<IconCopy />} label="Salin" onClick={run(() => onCopy(t))} />}
        {isLast && (
          <SheetItem
            icon={<IconEdit />}
            label={isBrief ? 'Edit & tulis ulang pembukaan' : 'Edit & tulis ulang'}
            disabled={busy}
            onClick={run(() => onEdit(m))}
          />
        )}
        {isBrief && <SheetItem icon={<IconPage />} label="Edit brief saja" hint="Berlaku untuk tulisan berikutnya" onClick={run(() => onEditBrief(m))} />}
        {isLast && pair && <SheetItem icon={<IconRetry />} label="Kirim ulang" hint="Tulis ulang balasannya" disabled={busy} onClick={run(() => onRetry(pair))} />}
        {t && <SheetItem icon={<IconText />} label="Pilih teks" onClick={run(() => onSelect(t))} />}
        {isLast && pair && pair.length !== 'opening' && (
          <SheetItem icon={<IconTrash />} label="Hapus" hint="Pesan dan balasannya dibatalkan" danger disabled={busy} onClick={run(() => onCancel(pair))} />
        )}
        {!isLast && !isBrief && <p className="note pad">Pesan lama tidak bisa diedit karena tulisan sesudahnya dibuat berdasarkan pesan ini.</p>}
      </>
    );
  } else if (m) {
    const isLast = m.id === lastAsst?.id;
    const t = replyText(m);
    const resumable = m.mode === 'write' && (m.status === 'interrupted' || m.status === 'stopped') && m.versions.length > 0;
    title = m.mode === 'write' ? 'Balasan AI (ditulis ke page)' : 'Balasan AI';
    items = (
      <>
        {t && <SheetItem icon={<IconCopy />} label="Salin" onClick={run(() => onCopy(t))} />}
        {m.mode === 'write' && <SheetItem icon={<IconPage />} label="Buka di page" onClick={run(() => onOpen(m))} />}
        {isLast && resumable && <SheetItem icon={<IconFwd />} label="Lanjutkan dari sini" disabled={busy} onClick={run(() => onResume(m))} />}
        {isLast && <SheetItem icon={<IconRetry />} label="Coba lagi" hint={m.mode === 'write' ? 'Versi lama tetap tersimpan' : undefined} disabled={busy} onClick={run(() => onRetry(m))} />}
        {t && m.mode !== 'write' && <SheetItem icon={<IconText />} label="Pilih teks" onClick={run(() => onSelect(t))} />}
        {isLast && m.length !== 'opening' && (
          <SheetItem
            icon={<IconTrash />}
            label="Batalkan"
            hint={m.mode === 'write' ? 'Tulisan ini dihapus dari naskah' : 'Pesan dan jawaban ini disembunyikan'}
            danger
            disabled={busy}
            onClick={run(() => onCancel(m))}
          />
        )}
      </>
    );
  }

  return (
    <Sheet open={!!menu} onClose={onClose} title={title}>
      {items}
    </Sheet>
  );
}
