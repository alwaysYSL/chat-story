import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { db, type Attachment, type LengthPreset, type Message, type ModelId, type Page } from '../db';
import { MarkdownView } from '../components/Blocks';
import {
  IconBack,
  IconChevronDown,
  IconClose,
  IconEdit,
  IconFile,
  IconHistory,
  IconPlus,
  IconRetry,
  IconSend,
  IconSparkle,
  IconStop,
} from '../components/Icons';
import { PromptSheet, Sheet, SheetItem, Toggle, toast } from '../components/ui';
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
import { displayTitle } from '../lib/pages';
import { isPeak, MODEL_LABEL } from '../lib/pricing';
import { LENGTH_LABEL, targetRange } from '../lib/prompts';
import { useSettings } from '../lib/settings';
import { debounce, formatNumber, formatRupiah } from '../lib/util';

const NEW_DRAFT_KEY = (scope: string) => `draft:new:${scope}`;

export default function ChatScreen() {
  const { id = 'new' } = useParams();
  const [params] = useSearchParams();
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
  const [model, setModel] = useState<ModelId | null>(null);
  const [thinking, setThinking] = useState<boolean | null>(null);
  const [targetOpen, setTargetOpen] = useState(false);
  const [editMsg, setEditMsg] = useState<Message | null>(null);
  const [dismissSuggest, setDismissSuggest] = useState(false);
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const loadedDraft = useRef(false);

  const effModel: ModelId = model ?? settings?.model ?? 'deepseek-flash';
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

  // Gulir ke bawah saat ada pesan baru / teks diskusi mengalir.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages?.length, gen?.live]);

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

  const root = storyPages?.[0];
  const lastPage = storyPages?.[storyPages.length - 1];
  const totalWords = (storyPages ?? []).reduce((n, p) => n + p.words, 0);
  const canWrite = kind !== 'discuss';
  const writeOn = canWrite && write;
  const isOpening = !root || totalWords === 0;
  const busy = !!gen;
  const genHere = gen && gen.chatId === id;
  const suggestChapter =
    writeOn && !isOpening && target === 'last' && !dismissSuggest && (lastPage?.words ?? 0) >= settings.chapterThreshold;
  const fromOld = writeOn && fromPage && lastPage && fromPage !== lastPage.id && !isOpening;
  const hasImages =
    pending.some((p) => p.kind === 'image') ||
    [...(attachmentMap?.values() ?? [])].some((a) => a.kind === 'image');
  const lastWriteAsst = [...(messages ?? [])]
    .reverse()
    .find((m) => m.role === 'assistant' && m.status !== 'canceled');
  const peak = settings.peakWarning && isPeak();

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

  const handleError = (e: unknown) => {
    if (e instanceof UserError) {
      toast(e.message);
      if (e.code === 'nokey') nav('/settings');
    } else toast('Terjadi kesalahan: ' + String(e));
  };

  const doSend = async (opts?: { continueOnly?: boolean }) => {
    const body = opts?.continueOnly ? '' : text;
    if (!opts?.continueOnly && !body.trim() && !pending.length) return;
    if (sending) return;
    setSending(true);
    try {
      const res = await sendMessage({
        chatId: isNew ? null : id,
        pageId: isNew ? paramPage : (chat?.pageId ?? null),
        kind,
        text: body,
        attachments: opts?.continueOnly ? [] : pending,
        write: writeOn,
        target,
        length,
        model: effModel,
        thinking: effThinking,
      });
      if (!opts?.continueOnly) {
        setText('');
        setPending([]);
        saveDraft.cancel();
        if (isNew) localStorage.removeItem(draftScope!);
      }
      setTarget('last');
      setDismissSuggest(false);
      if (isNew) nav(`/chat/${res.chatId}`, { replace: true });
      if (res.writePageId) nav(`/page/${res.writePageId}?end=1`);
    } catch (e) {
      handleError(e);
    } finally {
      setSending(false);
    }
  };

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
        <button className="icon-btn" aria-label="Chat baru" onClick={() => nav('/chat/new')}>
          <IconEdit />
        </button>
      </header>

      {root && (
        <div className="chip-row">
          <Link className="page-chip" to={`/page/${fromPage ?? root.id}`}>
            {root.icon} {displayTitle(root)}
          </Link>
          {kind === 'discuss' && <span className="kind-chip">Diskusi</span>}
        </div>
      )}

      <div className="scroll-area chat-list-area" ref={listRef}>
        {(messages ?? []).length === 0 && (
          <div className="chat-empty">
            <div className="ai-face">
              <IconSparkle size={30} />
            </div>
            {kind === 'discuss' ? (
              <p>Tanyakan apa saja tentang cerita ini. AI sudah membaca brief dan seluruh naskah, tetapi tidak akan menulis ke page.</p>
            ) : root ? (
              <p>Tulis brief atau arahan. Dengan "Tulis ke page" menyala, AI langsung menulis di page cerita.</p>
            ) : (
              <p>
                Tulis brief cerita: gambaran besar, karakter, gambaran pembukaan, aturan penulisan pembukaan, dan aturan
                penulisan lanjutan. Dengan "Tulis ke page" menyala, AI menulis pembukaan di page baru.
              </p>
            )}
          </div>
        )}

        {(messages ?? []).map((m, i, arr) => {
          if (m.role === 'user') {
            const isBrief = kind !== 'discuss' && arr.findIndex((x) => x.role === 'user') === i;
            const reply = arr[i + 1]?.role === 'assistant' ? arr[i + 1] : undefined;
            const canEdit =
              !busy &&
              m.mode === 'write' &&
              reply &&
              reply.id === lastWriteAsst?.id &&
              reply.status !== 'canceled' &&
              m.length !== 'opening';
            return (
              <UserBubble
                key={m.id}
                m={m}
                isBrief={isBrief}
                atts={m.attachmentIds.map((a) => attachmentMap?.get(a)).filter(Boolean) as Attachment[]}
                onEdit={canEdit ? () => setEditMsg(m) : undefined}
              />
            );
          }
          const streaming = genHere && gen!.messageId === m.id;
          const isLast = m.id === lastWriteAsst?.id;
          return m.mode === 'write' ? (
            <WriteCard
              key={m.id}
              m={m}
              pages={storyPages ?? []}
              streaming={!!streaming}
              live={streaming ? gen!.words : 0}
              isLast={isLast}
              busy={busy}
              rate={settings.usdToIdr}
              onError={handleError}
              onOpen={(seg) => nav(`/page/${m.targetPageId}${seg ? `?seg=${m.id}` : '?end=1'}`)}
              onWriting={() => m.targetPageId && nav(`/page/${m.targetPageId}?end=1`)}
            />
          ) : (
            <DiscussBubble
              key={m.id}
              m={m}
              live={streaming ? gen!.live : null}
              thinking={!!streaming && gen!.thinking && !gen!.live}
              isLast={isLast}
              busy={busy}
              rate={settings.usdToIdr}
              onError={handleError}
            />
          );
        })}
      </div>

      <div className="composer">
        {peak && <div className="composer-note warn">Sekarang jam peak DeepSeek (harga 2×).</div>}
        {suggestChapter && (
          <div className="composer-note">
            Bab ini sudah {formatNumber(lastPage!.words)} kata. Lanjutkan di bab baru?
            <span className="note-actions">
              <button className="link-btn" onClick={() => setTarget('new')}>
                Ya, bab baru
              </button>
              <button className="link-btn" onClick={() => setDismissSuggest(true)}>
                Tidak
              </button>
            </span>
          </div>
        )}
        {fromOld && (
          <div className="composer-note">AI hanya menulis di akhir bab terakhir ({displayTitle(lastPage)}) atau di bab baru.</div>
        )}
        {effModel !== 'deepseek-flash' && hasImages && (
          <div className="composer-note warn">Model Pro tidak bisa membaca gambar. Gambar akan dilewati; pakai Flash kalau gambar penting.</div>
        )}

        {canWrite && (
          <div className="composer-options">
            <label className="opt-toggle">
              <Toggle checked={write} onChange={setWrite} label="Tulis ke page" />
              <span>Tulis ke page</span>
            </label>
            {writeOn && !isOpening && (
              <button className="chip" onClick={() => setTargetOpen(true)}>
                {target === 'new' ? '+ Bab baru' : `Ke: ${displayTitle(lastPage)}`} <IconChevronDown size={14} />
              </button>
            )}
            {writeOn && isOpening && <span className="chip static">Pembukaan · {targetRange(settings, 'opening')}</span>}
          </div>
        )}
        {writeOn && !isOpening && (
          <div className="composer-options">
            {(['short', 'normal', 'long'] as LengthPreset[]).map((l) => (
              <button key={l} className={'chip' + (length === l ? ' active' : '')} onClick={() => setLength(l)}>
                {LENGTH_LABEL[l]}
              </button>
            ))}
            <button className="chip accent" disabled={busy || sending} onClick={() => void doSend({ continueOnly: true })}>
              Lanjutkan saja
            </button>
          </div>
        )}

        {pending.length > 0 && (
          <div className="pending-row">
            {pending.map((p, i) => (
              <div key={i} className="pending-item">
                {p.kind === 'image' ? <img src={p.previewUrl} alt={p.name} /> : <span className="pending-file"><IconFile size={18} />{p.name}</span>}
                <button className="pending-x" aria-label="Hapus lampiran" onClick={() => setPending((arr) => arr.filter((_, j) => j !== i))}>
                  <IconClose size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="composer-box">
          <textarea
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
              const t = e.currentTarget;
              t.style.height = 'auto';
              t.style.height = Math.min(t.scrollHeight, window.innerHeight * 0.4) + 'px';
            }}
          />
          <div className="composer-bar">
            <button className="icon-btn" aria-label="Lampirkan file" onClick={() => fileRef.current?.click()}>
              <IconPlus size={20} />
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              multiple
              accept="image/jpeg,image/png,image/webp,image/gif,.txt,.md,text/plain,text/markdown"
              onChange={(e) => {
                void pickFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              className="chip"
              aria-label="Ganti model"
              onClick={() => setModel(effModel === 'deepseek-flash' ? 'deepseek-v4-pro' : 'deepseek-flash')}
            >
              {MODEL_LABEL[effModel]}
            </button>
            <button
              className={'chip' + (effThinking ? ' active' : '')}
              aria-pressed={effThinking}
              onClick={() => setThinking(!effThinking)}
            >
              Berpikir {effThinking ? 'nyala' : 'mati'}
            </button>
            <span className="fmt-spacer" />
            {genHere ? (
              <button className="send-btn stop" aria-label="Stop" onClick={stopGeneration}>
                <IconStop size={18} />
              </button>
            ) : (
              <button
                className="send-btn"
                aria-label="Kirim"
                disabled={busy || sending || (!text.trim() && !pending.length)}
                onClick={() => void doSend()}
              >
                <IconSend size={18} />
              </button>
            )}
          </div>
        </div>
      </div>

      <Sheet open={targetOpen} onClose={() => setTargetOpen(false)} title="Tulis ke">
        <SheetItem
          label={`Akhir ${displayTitle(lastPage)}`}
          hint="Bab terakhir"
          onClick={() => {
            setTarget('last');
            setTargetOpen(false);
          }}
        />
        <SheetItem
          icon={<IconPlus />}
          label="+ Bab baru"
          hint={`Bagian ${(storyPages?.length ?? 1) + 1}`}
          onClick={() => {
            setTarget('new');
            setTargetOpen(false);
          }}
        />
      </Sheet>

      <PromptSheet
        open={!!editMsg}
        title="Edit arahan terakhir"
        initial={editMsg?.text ?? ''}
        multiline
        confirmLabel="Tulis ulang"
        note="AI akan menulis ulang balasan terakhir dengan arahan ini (disimpan sebagai versi baru)."
        onClose={() => setEditMsg(null)}
        onSubmit={async (v) => {
          if (!editMsg) return;
          const list = messages ?? [];
          const i = list.findIndex((x) => x.id === editMsg.id);
          const reply = list[i + 1];
          if (!reply) return;
          try {
            await retryMessage(reply.id, v);
            if (reply.targetPageId) nav(`/page/${reply.targetPageId}?end=1`);
          } catch (e) {
            handleError(e);
          }
        }}
      />
    </div>
  );
}

function UserBubble({
  m,
  isBrief,
  atts,
  onEdit,
}: {
  m: Message;
  isBrief: boolean;
  atts: Attachment[];
  onEdit?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = m.text.length > 400;
  const urls = useMemo(
    () => atts.map((a) => (a.kind === 'image' && a.blob ? URL.createObjectURL(a.blob) : null)),
    [atts],
  );
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls]);
  return (
    <div className={'msg user' + (m.status === 'canceled' ? ' canceled' : '')}>
      {isBrief && <div className="msg-label">Brief</div>}
      <div className={'bubble' + (long && !expanded ? ' clamp' : '')}>
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
      <div className="msg-meta">
        {m.status === 'canceled' && <span>Dibatalkan</span>}
        {onEdit && (
          <button className="link-btn" onClick={onEdit}>
            Edit &amp; tulis ulang
          </button>
        )}
      </div>
    </div>
  );
}

function WriteCard({
  m,
  pages,
  streaming,
  live,
  isLast,
  busy,
  rate,
  onError,
  onOpen,
  onWriting,
}: {
  m: Message;
  pages: Page[];
  streaming: boolean;
  live: number;
  isLast: boolean;
  busy: boolean;
  rate: number;
  onError: (e: unknown) => void;
  onOpen: (seg: boolean) => void;
  onWriting: () => void;
}) {
  const target = pages.find((p) => p.id === m.targetPageId);
  const v = m.versions[m.active];
  const status = streaming ? 'streaming' : m.status;
  const act = (fn: () => Promise<void>) => () => void fn().catch(onError);

  if (m.status === 'canceled') {
    return <div className="msg ai"><div className="write-card muted">Balasan dibatalkan</div></div>;
  }

  return (
    <div className="msg ai">
      <div className="write-card">
        <button className="write-main" onClick={() => onOpen(!streaming && !!v)} disabled={!target}>
          <span className="write-ico">✍</span>
          <span className="write-text">
            <span>
              {status === 'streaming' ? 'Menulis di ' : 'Menulis di '}«{target ? displayTitle(target) : 'page terhapus'}»
            </span>
            <small>
              {status === 'streaming'
                ? `${formatNumber(live)} kata…`
                : v
                  ? `${formatNumber(v.words)} kata · ${formatRupiah(m.costUsd * rate)}`
                  : m.costUsd
                    ? formatRupiah(m.costUsd * rate)
                    : ''}
              {status === 'stopped' && ' · dihentikan'}
              {status === 'interrupted' && ' · terputus'}
            </small>
          </span>
        </button>
        {status === 'error' && <div className="card-error">{m.error}</div>}
        {status === 'interrupted' && m.error && <div className="card-error soft">{m.error}</div>}
        {!streaming && (
          <div className="card-actions">
            {m.versions.length > 1 && (
              <span className="versions">
                <button
                  className="link-btn"
                  aria-label="Versi sebelumnya"
                  disabled={busy || m.active === 0}
                  onClick={act(() => selectVersion(m.id, m.active - 1))}
                >
                  ‹
                </button>
                {m.active + 1}/{m.versions.length}
                <button
                  className="link-btn"
                  aria-label="Versi berikutnya"
                  disabled={busy || m.active >= m.versions.length - 1}
                  onClick={act(() => selectVersion(m.id, m.active + 1))}
                >
                  ›
                </button>
              </span>
            )}
            {(status === 'interrupted' || status === 'stopped') && v && isLast && (
              <button
                className="link-btn"
                disabled={busy}
                onClick={act(async () => {
                  await continueMessage(m.id);
                  onWriting();
                })}
              >
                Lanjutkan dari sini
              </button>
            )}
            {isLast && (
              <button
                className="link-btn"
                disabled={busy}
                onClick={act(async () => {
                  await retryMessage(m.id);
                  onWriting();
                })}
              >
                <IconRetry size={14} /> Coba lagi
              </button>
            )}
            {isLast && (
              <button className="link-btn danger" disabled={busy} onClick={act(() => cancelMessage(m.id))}>
                Batalkan
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DiscussBubble({
  m,
  live,
  thinking,
  isLast,
  busy,
  rate,
  onError,
}: {
  m: Message;
  live: string | null;
  thinking: boolean;
  isLast: boolean;
  busy: boolean;
  rate: number;
  onError: (e: unknown) => void;
}) {
  if (m.status === 'canceled') return null;
  const text = live ?? m.text;
  return (
    <div className="msg ai">
      <div className="bubble ai-bubble">
        {text ? <MarkdownView text={text} /> : thinking ? <i>AI sedang berpikir…</i> : live !== null ? <span className="typing"><span /><span /><span /></span> : null}
        {m.status === 'error' && <div className="card-error">{m.error}</div>}
      </div>
      {live === null && (
        <div className="msg-meta">
          {m.costUsd > 0 && <span>{formatRupiah(m.costUsd * rate)}</span>}
          {m.status === 'interrupted' && <span>terputus</span>}
          {m.status === 'stopped' && <span>dihentikan</span>}
          {isLast && (m.status === 'error' || m.status === 'interrupted' || m.status === 'stopped' || m.status === 'done') && (
            <button className="link-btn" disabled={busy} onClick={() => void retryMessage(m.id).catch(onError)}>
              <IconRetry size={14} /> Coba lagi
            </button>
          )}
        </div>
      )}
    </div>
  );
}
