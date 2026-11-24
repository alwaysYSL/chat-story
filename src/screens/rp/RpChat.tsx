import { useLiveQuery } from 'dexie-react-hooks';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db, type Message, type RpLength } from '../../db';
import { MarkdownView } from '../../components/Blocks';
import {
  IconArrowBottom,
  IconBack,
  IconBook,
  IconBulb,
  IconChevronDown,
  IconClose,
  IconCopy,
  IconEdit,
  IconFwd,
  IconHistory,
  IconList,
  IconMore,
  IconNotes,
  IconPage,
  IconPen,
  IconPin,
  IconChat,
  IconSearch,
  IconRetry,
  IconSend,
  IconSparkle,
  IconStop,
  IconText,
  IconTrash,
  IconUser,
} from '../../components/Icons';
import { ModelPicker } from '../../components/Providers';
import { Avatar } from '../../components/rp/Avatar';
import { ConfirmSheet, PromptSheet, Sheet, SheetItem, toast, useLongPress } from '../../components/ui';
import { stopGeneration, useActiveGen, UserError } from '../../lib/generate';
import { goBack } from '../../lib/nav';
import { trashChat } from '../../lib/pages';
import { isPeak } from '../../lib/pricing';
import { estimateTokens, findModel, usableModels, type ModelRef } from '../../lib/providers';
import { polishTurn } from '../../lib/rp/assist';
import { PinnedSheet, PreviewSheet, SearchSheet, StyleSheet, SuggestBar, ToStorySheet } from './RpChatTools';
import { fillMacros } from '../../lib/rp/cards';
import { blockHash, historyOf, messageText, RP_CONTEXT_OPTIONS, RP_DEFAULT_CONTEXT, RP_KEEP_FULL, rpAutoThreshold, summaryBlocks } from '../../lib/rp/context';
import { branchRpChat, ensureOwnLorebook, listPersonas, resolvePersona, togglePin } from '../../lib/rp/data';
import {
  continueRp,
  deleteRpMessages,
  dismissMemoryOffer,
  editRpMessage,
  impersonate,
  MEMORY_EVERY,
  proposeMemory,
  retryRp,
  saveMemory,
  selectRpVersion,
  sendRp,
  suggestReplies,
  summarizeNow,
} from '../../lib/rp/engine';
import { DEFAULT_STYLE, RP_LENGTH } from '../../lib/rp/prompts';
import type { RpStyle } from '../../db';
import { markChanged, useSettings } from '../../lib/settings';
import { copyText, debounce, formatNumber, formatRupiah, formatUsd } from '../../lib/util';

type Menu = Message | null;
type TurnAction = 'menu' | 'copy' | 'retry' | 'resume' | 'version';
/** jumlah pesan terakhir yang digambar; pesan lebih lama dimuat lewat tombol */
const WINDOW = 120;

export default function RpChat() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const settings = useSettings();
  const chat = useLiveQuery(async () => (await db.chats.get(id)) ?? null, [id]);
  const character = useLiveQuery(async () => (chat?.characterId ? ((await db.characters.get(chat.characterId)) ?? null) : null), [chat?.characterId]);
  // Persona yang sudah dihapus tidak dipakai lagi (jatuh ke persona bawaan); ikut diperbarui saat daftar persona berubah.
  const personas = useLiveQuery(listPersonas, []);
  const persona = useLiveQuery(async () => (chat ? resolvePersona(chat.personaId) : null), [chat?.personaId, personas]);
  const messages = useLiveQuery(() => db.messages.where('chatId').equals(id).sortBy('seq'), [id]);
  const gen = useActiveGen();

  const [text, setText] = useState('');
  const [model, setModel] = useState<ModelRef | null>(null);
  const [thinking, setThinking] = useState<boolean | null>(null);
  const [sending, setSending] = useState(false);
  const [menu, setMenu] = useState<Menu>(null);
  const [chatMenu, setChatMenu] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [lengthOpen, setLengthOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState<null | { propose: boolean }>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  const [editMsg, setEditMsg] = useState<Message | null>(null);
  const [info, setInfo] = useState<Message | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState<null | { q: string; ids: string[]; i: number }>(null);
  const [storyOpen, setStoryOpen] = useState(false);
  const [suggest, setSuggest] = useState<null | { items: string[]; loading: boolean }>(null);
  const [polish, setPolish] = useState<null | { msgId: string | null; source: string; result: string | null }>(null);
  const [confirmDel, setConfirmDel] = useState<null | { msg?: Message; chat?: boolean }>(null);
  const [atBottom, setAtBottom] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const loadedDraft = useRef(false);
  const [windowSize, setWindowSize] = useState(WINDOW);
  const [dismissedCtx, setDismissedCtx] = useState(false);
  /** Aksi pesan lewat satu fungsi tetap, supaya baris pesan yang tidak berubah tidak digambar ulang. */
  const actionsRef = useRef<(kind: TurnAction, m: Message, arg?: number) => void>(() => {});
  const onAction = useCallback((kind: TurnAction, m: Message, arg?: number) => actionsRef.current(kind, m, arg), []);

  useEffect(() => {
    if (chat && !loadedDraft.current) {
      setText(chat.draft ?? '');
      loadedDraft.current = true;
    }
  }, [chat]);
  const saveDraft = useMemo(() => debounce((v: string) => void db.chats.update(id, { draft: v }), 500), [id]);
  useEffect(() => () => saveDraft.flush(), [saveDraft]);

  useEffect(() => {
    const t = inputRef.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, window.innerHeight * 0.4) + 'px';
  }, [text]);

  const genHere = !!gen && gen.chatId === id;
  const impersonating = genHere && gen!.mode === 'impersonate';
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages?.length, gen?.live]);

  const list = messages ?? [];
  const history = useMemo(() => historyOf(list), [list]);
  const ctxTokens = useMemo(() => {
    if (!character) return 0;
    const card = [character.description, character.personality, character.scenario, character.mesExample, persona?.description ?? ''].reduce((n, t) => n + t.length, 0);
    return estimateTokens(card + 1500 + history.reduce((n, m) => n + messageText(m).length, 0));
  }, [character, persona, history]);

  if (!settings || chat === undefined || character === undefined) return <div className="screen" />;
  if (!chat || chat.deletedAt || !character) {
    return (
      <div className="screen">
        <div className="empty">
          <h2>Chat tidak ditemukan</h2>
          <button className="btn" onClick={() => nav('/roleplay')}>
            Ke Roleplay
          </button>
        </div>
      </div>
    );
  }

  const userName = persona?.name.trim() || 'Pengguna';
  const fill = (t: string) => fillMacros(t, character.name, userName);
  const usable = usableModels(settings.providers);
  const pickRef = (r: ModelRef | null | undefined) => (r && usable.some((u) => u.provider.id === r.provider && u.model.id === r.model) ? r : null);
  const lastSent = [...list].reverse().find((m) => m.role === 'user' && m.model);
  const lastUsed: ModelRef | null = lastSent ? { provider: lastSent.provider ?? 'deepseek', model: lastSent.model } : null;
  const firstUsable = usable[0] ? { provider: usable[0].provider.id, model: usable[0].model.id } : null;
  // Pilihan barusan → model terakhir di chat → model bawaan karakter → model default → yang pertama punya API key.
  const effModel = pickRef(model) ?? pickRef(lastUsed) ?? pickRef(character.modelRef) ?? pickRef(settings.defaultModel) ?? firstUsable;
  const resolved = effModel ? findModel(settings.providers, effModel) : null;
  const effThinking = thinking ?? settings.thinking;
  const busy = !!gen;
  const lastAsst = [...list].reverse().find((m) => m.role === 'assistant');
  const greetingOnly = list.length > 0 && list.every((m) => m.greeting);
  const empty = !text.trim();
  const length: RpLength = chat.rpLength ?? 'normal';
  const ctxLimit = resolved?.model.context ?? 0;
  const peak = settings.peakWarning && isPeak() && resolved?.provider.kind === 'deepseek';

  const handleError = (e: unknown) => {
    if (e instanceof UserError) {
      toast(e.message);
      if (e.code === 'nokey') nav('/settings#penyedia');
    } else toast('Gagal: ' + ((e as Error).message || String(e)));
  };
  const needModel = (): ModelRef | null => {
    if (!effModel) {
      toast('Isi API key salah satu penyedia AI dulu di Pengaturan.');
      nav('/settings#penyedia');
      return null;
    }
    return effModel;
  };

  const doSend = async () => {
    const m = needModel();
    if (!m || sending || busy) return;
    setSending(true);
    try {
      await sendRp({ chatId: id, text, model: m, thinking: effThinking });
      setText('');
      saveDraft.cancel();
      stick.current = true;
    } catch (e) {
      handleError(e);
    } finally {
      setSending(false);
    }
  };

  const doImpersonate = async (hint: string) => {
    const m = needModel();
    if (!m || busy) return;
    const before = text;
    try {
      const r = await impersonate(id, hint, m, (t) => setText(t));
      setText(r || before);
      saveDraft(r || before);
      inputRef.current?.focus();
    } catch (e) {
      setText(before);
      handleError(e);
    }
  };

  const doSuggest = async () => {
    const m = needModel();
    if (!m || busy) return;
    setSuggest({ items: [], loading: true });
    try {
      setSuggest({ items: await suggestReplies(id, m), loading: false });
    } catch (e) {
      setSuggest(null);
      handleError(e);
    }
  };

  /** Lompat ke pesan: pesan lama dimuat dulu kalau tersembunyi, lalu disorot sebentar. */
  const jumpTo = (msgId: string) => {
    const idx = list.findIndex((x) => x.id === msgId);
    if (idx < 0) return;
    const need = list.length - idx + 5;
    if (need > windowSize) setWindowSize(need);
    stick.current = false;
    setTimeout(() => {
      const el = listRef.current?.querySelector(`[data-mid="${CSS.escape(msgId)}"]`);
      if (!el) return;
      el.scrollIntoView({ block: 'center' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1600);
    }, 60);
  };

  const doPolish = async (msgId: string | null, source: string) => {
    setPolish({ msgId, source, result: null });
    try {
      const r = await polishTurn(id, source);
      setPolish({ msgId, source, result: r });
    } catch (e) {
      setPolish(null);
      handleError(e);
    }
  };

  const copy = async (t: string) => toast((await copyText(t)) ? 'Disalin' : 'Gagal menyalin');
  const hidden = Math.max(0, list.length - windowSize);
  actionsRef.current = (kind, m, arg) => {
    if (kind === 'menu') setMenu(m);
    else if (kind === 'copy') void copy(fill(m.text));
    else if (kind === 'version') void selectRpVersion(m.id, arg ?? 0);
    else if (kind === 'retry' || kind === 'resume') {
      const md = needModel();
      if (!md) return;
      if (kind === 'retry') void retryRp(m.id, md, effThinking).catch(handleError);
      else void continueRp(m.id, md).catch(handleError);
    }
  };

  /* ---------- Catatan di atas kolom ketik (maks. satu) ---------- */
  const sinceMemory = list.length - (chat.memoryAtCount ?? 0);
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
  } else if (ctxLimit > 0 && ctxTokens > ctxLimit * 0.85) {
    note = (
      <div className="composer-note warn">
        <span className="note-body">Chat ini mendekati batas konteks {resolved?.model.label}. Nyalakan ringkasan atau pilih model berkonteks lebih besar.</span>
        <button className="link-btn" onClick={() => setSummaryOpen(true)}>
          Atur
        </button>
      </div>
    );
  } else if ((chat.summaryMode ?? 'auto') === 'off' && ctxTokens > rpAutoThreshold(chat, ctxLimit) && !dismissedCtx) {
    note = (
      <div className="composer-note">
        <span className="note-body">Chat ini sudah ±{formatNumber(Math.round(ctxTokens / 1000))} ribu token. Nyalakan ringkasan pesan lama supaya lebih hemat.</span>
        <button className="link-btn" onClick={() => setSummaryOpen(true)}>
          Atur
        </button>
        <button className="note-x" aria-label="Tutup" onClick={() => setDismissedCtx(true)}>
          <IconClose size={14} />
        </button>
      </div>
    );
  } else if (list.length >= MEMORY_EVERY && sinceMemory >= MEMORY_EVERY && !busy) {
    note = (
      <div className="composer-note">
        <span className="note-body">Sudah {sinceMemory} pesan sejak memori chat diperbarui.</span>
        <button className="link-btn" onClick={() => setMemoryOpen({ propose: true })}>
          Perbarui memori
        </button>
        <button className="note-x" aria-label="Tutup" onClick={() => void dismissMemoryOffer(id)}>
          <IconClose size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="screen chat-screen rp-chat">
      <header className="page-header">
        <button className="icon-btn" aria-label="Kembali" onClick={() => goBack(nav)}>
          <IconBack />
        </button>
        <button className="rp-head" onClick={() => nav(`/rp/c/${character.id}`)}>
          <Avatar blob={character.avatar} view={character.photo ?? character.avatar} name={character.name} size={32} />
          <span>
            <b>{character.name}</b>
            <small>
              {chat.branchOf ? `↳ cabang dari ${chat.branchOf.title}` : chat.title !== character.name ? chat.title : `Balasan ${RP_LENGTH[length].label.toLowerCase()}`}
            </small>
          </span>
        </button>
        <button className="chip rp-persona-chip" aria-label="Ganti persona" onClick={() => setPersonaOpen(true)}>
          <Avatar blob={persona?.avatar} view={persona?.photo ?? persona?.avatar} name={userName} size={20} />
          <span className="chip-text">{userName}</span>
        </button>
        <button className="icon-btn" aria-label="Menu chat" onClick={() => setChatMenu(true)}>
          <IconMore />
        </button>
      </header>

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
        {list.length === 0 && (
          <div className="chat-empty">
            <Avatar blob={character.avatar} name={character.name} size={72} />
            <p>Kartu {character.name} belum punya pesan pembuka. Tulis giliran pertama Anda.</p>
          </div>
        )}
        {hidden > 0 && (
          <button
            className="btn btn-small rp-older"
            onClick={() => {
              // Pertahankan posisi baca saat pesan lama ditambahkan di atas.
              const el = listRef.current;
              const h = el?.scrollHeight ?? 0;
              setWindowSize((n) => n + WINDOW);
              requestAnimationFrame(() => {
                if (el) el.scrollTop += el.scrollHeight - h;
              });
            }}
          >
            Tampilkan {Math.min(WINDOW, hidden)} pesan sebelumnya ({hidden} tersembunyi)
          </button>
        )}
        {list.slice(hidden).map((m) => {
          if (m.role === 'user') {
            if (!m.text.trim()) return <div key={m.id} className="rp-continue-mark">⋯ lanjutkan</div>;
            return <UserTurn key={m.id} m={m} name={userName} avatar={persona?.avatar} photo={persona?.photo ?? persona?.avatar} onAction={onAction} />;
          }
          const streaming = genHere && gen!.mode === 'roleplay' && gen!.messageId === m.id;
          const isLast = m.id === lastAsst?.id;
          return (
            <AiTurn
              key={m.id}
              m={m}
              name={character.name}
              avatar={character.avatar}
              photo={character.photo ?? character.avatar}
              text={fill(streaming ? gen!.live : m.text)}
              streaming={streaming}
              status={streaming ? (gen!.status ?? (gen!.thinking && !gen!.live ? 'Sedang berpikir…' : null)) : null}
              canSwipe={!busy && m.versions.length > 1 && (m.greeting ? greetingOnly : isLast)}
              showActions={isLast && !streaming && !m.greeting}
              busy={busy}
              rate={settings.usdToIdr}
              onAction={onAction}
            />
          );
        })}
      </div>

      <div className="composer">
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
        {search && (
          <div className="rp-search-pill">
            <span>
              “{search.q}” {search.i + 1}/{search.ids.length}
            </span>
            <button className="act-btn" aria-label="Hasil sebelumnya" disabled={search.i <= 0} onClick={() => { const i = search.i - 1; setSearch({ ...search, i }); jumpTo(search.ids[i]); }}>
              ‹
            </button>
            <button className="act-btn" aria-label="Hasil berikutnya" disabled={search.i >= search.ids.length - 1} onClick={() => { const i = search.i + 1; setSearch({ ...search, i }); jumpTo(search.ids[i]); }}>
              ›
            </button>
            <button className="act-btn" aria-label="Tutup pencarian" onClick={() => setSearch(null)}>
              <IconClose size={14} />
            </button>
          </div>
        )}
        {suggest ? (
          <SuggestBar
            items={suggest.items}
            loading={suggest.loading}
            onPick={(t) => {
              setText(t);
              saveDraft(t);
              setSuggest(null);
              inputRef.current?.focus();
            }}
            onRefresh={() => void doSuggest()}
            onClose={() => setSuggest(null)}
          />
        ) : (
          note
        )}
        <div className="composer-box">
          <textarea
            ref={inputRef}
            className="composer-input"
            rows={1}
            readOnly={impersonating}
            placeholder={`Giliran ${userName}… (kosong = ${character.name} melanjutkan)`}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              saveDraft(e.target.value);
            }}
          />
          <div className="composer-bar">
            <button className="chip model-chip" aria-label="Ganti model" onClick={() => setPickerOpen(true)}>
              {effThinking && <IconBulb size={14} aria-label="Mode berpikir nyala" />}
              <span className="chip-text">{resolved ? resolved.model.label : 'Pilih model'}</span>
              {peak && <span className="peak-dot" aria-label="Jam peak" />}
              <IconChevronDown size={14} />
            </button>
            <button
              className="chip rp-help-chip"
              aria-label="Bantu persona"
              disabled={busy}
              onClick={() => setHelpOpen(true)}
            >
              <IconSparkle size={14} /> <span className="chip-text">Bantu</span>
            </button>
            <span className="fmt-spacer" />
            {genHere ? (
              <button className="send-btn stop" aria-label="Stop" onClick={stopGeneration}>
                <IconStop size={18} />
              </button>
            ) : empty ? (
              <button className="send-btn wide" aria-label="Lanjutkan" disabled={busy || sending || !list.length} onClick={() => void doSend()}>
                <IconFwd size={16} /> Lanjutkan
              </button>
            ) : (
              <button className="send-btn" aria-label="Kirim" disabled={busy || sending} onClick={() => void doSend()}>
                <IconSend size={18} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ---------- Sheet ---------- */}

      <Sheet open={helpOpen} onClose={() => setHelpOpen(false)} title="Bantu AI">
        <SheetItem
          icon={<IconSparkle />}
          label={empty ? 'Tulis giliranku' : 'Kembangkan jadi giliran utuh'}
          hint={empty ? `AI menulis giliran ${userName} ke kolom ketik` : 'Isi kolom ketik dipakai sebagai arahan Bantu persona'}
          onClick={() => {
            setHelpOpen(false);
            void doImpersonate(text);
          }}
        />
        <SheetItem
          icon={<IconList />}
          label="Saran balasan"
          hint="3 pilihan giliran singkat, pilih lalu edit"
          onClick={() => {
            setHelpOpen(false);
            void doSuggest();
          }}
        />
        <SheetItem
          icon={<IconText />}
          disabled={empty}
          label="Perhalus pesanku"
          hint="Maksud sama, kalimat lebih enak"
          onClick={() => {
            setHelpOpen(false);
            void doPolish(null, text);
          }}
        />
      </Sheet>

      <Sheet open={!!polish} onClose={() => setPolish(null)} title="Perhalus pesan">
        {polish && (
          <>
            <div className="rewrite-original">
              <small>Pesan asli</small>
              <div className="clamp3">{polish.source}</div>
            </div>
            <div className="assist-live">
              {polish.result === null ? (
                <span className="typing">
                  <span />
                  <span />
                  <span />
                </span>
              ) : (
                <MarkdownView text={polish.result} />
              )}
            </div>
            <div className="row-buttons pad">
              <button className="btn" onClick={() => setPolish(null)}>
                Batal
              </button>
              <button className="btn" disabled={polish.result === null} onClick={() => void doPolish(polish.msgId, polish.source)}>
                <IconRetry size={16} /> Coba lagi
              </button>
              <button
                className="btn btn-primary"
                disabled={!polish.result?.trim()}
                onClick={async () => {
                  if (polish.msgId) await editRpMessage(polish.msgId, polish.result!);
                  else {
                    setText(polish.result!);
                    saveDraft(polish.result!);
                  }
                  setPolish(null);
                }}
              >
                Ganti
              </button>
            </div>
          </>
        )}
      </Sheet>

      <MessageMenu
        m={menu}
        isLastAsst={!!menu && menu.id === lastAsst?.id}
        isLastUser={!!menu && menu.role === 'user' && list[list.length - 1]?.id === menu.id}
        busy={busy}
        onClose={() => setMenu(null)}
        onCopy={(m) => void copy(fill(m.text))}
        onEdit={setEditMsg}
        onRetry={(m) => {
          const md = needModel();
          if (md) void retryRp(m.id, md, effThinking).catch(handleError);
        }}
        onPolish={(m) => void doPolish(m.id, m.text)}
        onInfo={setInfo}
        onDelete={(m) => setConfirmDel({ msg: m })}
        onPin={async (m) => toast((await togglePin(m.id)) ? 'Disematkan' : 'Semat dilepas')}
        onBranch={async (m) => {
          const nid = await branchRpChat(id, m.id);
          if (nid) {
            toast('Cabang dibuat');
            nav(`/rp/chat/${nid}`);
          }
        }}
      />

      <PromptSheet
        open={!!editMsg}
        title={editMsg?.role === 'user' ? 'Edit pesan Anda' : `Edit balasan ${character.name}`}
        initial={editMsg?.text ?? ''}
        multiline
        note="Mengedit pesan lama tidak menulis ulang pesan sesudahnya. AI membaca versi yang sudah diedit."
        onClose={() => setEditMsg(null)}
        onSubmit={(v) => {
          if (editMsg) void editRpMessage(editMsg.id, v);
        }}
      />

      <ConfirmSheet
        open={!!confirmDel?.chat}
        title="Hapus chat?"
        message="Chat ini dipindah ke Sampah (30 hari)."
        confirmLabel="Hapus chat"
        danger
        onClose={() => setConfirmDel(null)}
        onConfirm={async () => {
          await trashChat(id);
          toast('Chat dipindah ke Sampah');
          goBack(nav);
        }}
      />
      <Sheet open={!!confirmDel?.msg} onClose={() => setConfirmDel(null)} title="Hapus pesan">
        {confirmDel?.msg && (
          <>
            <SheetItem
              icon={<IconTrash />}
              label="Hapus pesan ini saja"
              danger
              onClick={async () => {
                await deleteRpMessages(confirmDel.msg!.id, false);
                setConfirmDel(null);
              }}
            />
            <SheetItem
              icon={<IconTrash />}
              label="Hapus dari sini ke bawah"
              hint={`${list.filter((x) => x.seq >= confirmDel.msg!.seq).length} pesan`}
              danger
              onClick={async () => {
                const n = await deleteRpMessages(confirmDel.msg!.id, true);
                setConfirmDel(null);
                toast(`${n} pesan dihapus`);
              }}
            />
          </>
        )}
      </Sheet>

      <Sheet open={chatMenu} onClose={() => setChatMenu(false)} title={chat.title}>
        <SheetItem icon={<IconSearch />} label="Cari di chat ini" onClick={() => { setChatMenu(false); setSearchOpen(true); }} />
        <SheetItem icon={<IconPin />} label="Pesan tersemat" hint={`${list.filter((m) => m.pinned).length} pesan`} onClick={() => { setChatMenu(false); setPinnedOpen(true); }} />
        <SheetItem icon={<IconNotes />} label="Memori chat" hint={chat.memory?.trim() ? 'Terisi' : 'Belum diisi'} onClick={() => { setChatMenu(false); setMemoryOpen({ propose: false }); }} />
        <SheetItem icon={<IconList />} label="Ringkasan pesan lama" hint={summaryHint(chat.summaryMode)} onClick={() => { setChatMenu(false); setSummaryOpen(true); }} />
        <SheetItem
          icon={<IconBook />}
          label="Lorebook karakter"
          onClick={async () => {
            setChatMenu(false);
            const b = await ensureOwnLorebook(character);
            nav(`/rp/lore/${b.id}`);
          }}
        />
        <SheetItem icon={<IconEdit />} label="Pengingat aturan chat" hint={chat.reminder?.trim() ? 'Terisi' : 'Dikirim di akhir setiap permintaan'} onClick={() => { setChatMenu(false); setReminderOpen(true); }} />
        <SheetItem icon={<IconPen />} label="Gaya cerita" hint={styleHint(chat.rpStyle)} onClick={() => { setChatMenu(false); setStyleOpen(true); }} />
        <SheetItem icon={<IconList />} label="Lihat yang dikirim ke AI" hint="Pratinjau permintaan berikutnya dan tokennya" onClick={() => { setChatMenu(false); setPreviewOpen(true); }} />
        <SheetItem icon={<IconPage />} label="Jadikan cerita" hint="Tulis ulang sesi ini menjadi prosa di modul cerita" onClick={() => { setChatMenu(false); setStoryOpen(true); }} />
        {chat.branchOf && <SheetItem icon={<IconChat />} label="Buka chat asal" hint={chat.branchOf.title} onClick={() => { setChatMenu(false); nav(`/rp/chat/${chat.branchOf!.chatId}`); }} />}
        <SheetItem icon={<IconText />} label="Panjang balasan" hint={`${RP_LENGTH[length].label} (${RP_LENGTH[length].min}–${RP_LENGTH[length].max} kata)`} onClick={() => { setChatMenu(false); setLengthOpen(true); }} />
        <SheetItem icon={<IconUser />} label="Persona" hint={userName} onClick={() => { setChatMenu(false); setPersonaOpen(true); }} />
        <SheetItem icon={<IconEdit />} label="Ganti nama chat" onClick={() => { setChatMenu(false); setRenameOpen(true); }} />
        <SheetItem icon={<IconHistory />} label="Riwayat biaya" onClick={() => { setChatMenu(false); setCostOpen(true); }} />
        <SheetItem icon={<IconTrash />} label="Hapus chat" danger onClick={() => { setChatMenu(false); setConfirmDel({ chat: true }); }} />
      </Sheet>

      <Sheet open={lengthOpen} onClose={() => setLengthOpen(false)} title="Panjang balasan">
        {(Object.keys(RP_LENGTH) as RpLength[]).map((l) => (
          <SheetItem
            key={l}
            icon={l === length ? <span className="check-dot">✓</span> : <span className="check-dot" />}
            label={RP_LENGTH[l].label}
            hint={`±${RP_LENGTH[l].min}–${RP_LENGTH[l].max} kata`}
            onClick={async () => {
              await db.chats.update(id, { rpLength: l });
              markChanged();
              setLengthOpen(false);
            }}
          />
        ))}
      </Sheet>

      <Sheet open={personaOpen} onClose={() => setPersonaOpen(false)} title="Main sebagai">
        <p className="note pad">Berlaku mulai pesan berikutnya.</p>
        {(personas ?? []).map((p) => (
          <SheetItem
            key={p.id}
            icon={<Avatar blob={p.avatar} name={p.name} size={28} />}
            label={p.name + (p.id === persona?.id ? ' ✓' : '')}
            hint={p.description.slice(0, 70) || (p.isDefault ? 'Persona bawaan' : '')}
            onClick={async () => {
              await db.chats.update(id, { personaId: p.id });
              markChanged();
              setPersonaOpen(false);
            }}
          />
        ))}
        <SheetItem icon={<IconUser />} label="Kelola persona" onClick={() => { setPersonaOpen(false); nav('/rp/personas'); }} />
      </Sheet>

      <PromptSheet
        open={reminderOpen}
        title="Pengingat aturan chat"
        initial={chat.reminder ?? ''}
        multiline
        placeholder={'mis. Jaga suasana tetap tegang. {{char}} belum tahu rahasia {{user}}.'}
        note="Dikirim di akhir setiap permintaan (bersama pengingat dari kartu), jadi tidak mereset cache. Kosongkan untuk mematikan."
        onClose={() => setReminderOpen(false)}
        onSubmit={async (v) => {
          await db.chats.update(id, { reminder: v.trim() });
          markChanged();
          toast(v.trim() ? 'Pengingat disimpan' : 'Pengingat dimatikan');
        }}
      />
      <PromptSheet
        open={renameOpen}
        title="Nama chat"
        initial={chat.title}
        onClose={() => setRenameOpen(false)}
        onSubmit={(v) => {
          if (!v.trim()) return;
          void db.chats.update(id, { title: v.trim(), titleAuto: false });
          markChanged();
        }}
      />

      {memoryOpen && <MemorySheet chatId={id} initial={chat.memory ?? ''} propose={memoryOpen.propose} onClose={() => setMemoryOpen(null)} />}
      {summaryOpen && (
        <RpSummariesSheet
          chatId={id}
          messages={list}
          mode={chat.summaryMode ?? 'auto'}
          budget={chat.rpContext ?? RP_DEFAULT_CONTEXT}
          ctxTokens={ctxTokens}
          modelLimit={ctxLimit}
          onClose={() => setSummaryOpen(false)}
          fill={fill}
        />
      )}
      {costOpen && <RpCostSheet chatId={id} messages={list} rate={settings.usdToIdr} onClose={() => setCostOpen(false)} />}

      <Sheet open={!!info} onClose={() => setInfo(null)} title="Info balasan">
        {info && (
          <div className="form-pad rp-info">
            <p>
              Model: <b>{info.model || '-'}</b>
            </p>
            <p>
              Biaya: <b>{formatRupiah(info.costUsd * settings.usdToIdr)}</b> ({formatUsd(info.costUsd)}){info.costUnknown ? ' · sebagian tidak diketahui' : ''}
            </p>
            {info.versions[info.active] && (
              <p>
                Token: {formatNumber(info.versions[info.active].usage.hit)} cache · {formatNumber(info.versions[info.active].usage.miss)} baru ·{' '}
                {formatNumber(info.versions[info.active].usage.out)} keluar · {formatNumber(info.versions[info.active].words)} kata
              </p>
            )}
            <p>Versi: {info.versions.length ? `${info.active + 1}/${info.versions.length}` : '-'}</p>
            <p>Lorebook aktif: {info.lore?.length ? info.lore.join(', ') : 'tidak ada'}</p>
            {info.guardCut && <p>Dipotong otomatis: AI mulai menulis giliran {userName}.</p>}
          </div>
        )}
      </Sheet>

      {previewOpen && <PreviewSheet chatId={id} text={text} model={effModel} onClose={() => setPreviewOpen(false)} />}
      {styleOpen && <StyleSheet chat={chat} onClose={() => setStyleOpen(false)} />}
      {pinnedOpen && (
        <PinnedSheet
          messages={list}
          fill={fill}
          names={{ char: character.name, user: userName }}
          onJump={(m) => {
            setPinnedOpen(false);
            jumpTo(m.id);
          }}
          onUnpin={(m) => void togglePin(m.id)}
          onClose={() => setPinnedOpen(false)}
        />
      )}
      {searchOpen && (
        <SearchSheet
          messages={list}
          fill={fill}
          initial={search?.q ?? ''}
          onPick={(q, res, i) => {
            setSearchOpen(false);
            setSearch({ q, ids: res.map((m) => m.id), i });
            jumpTo(res[i].id);
          }}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {storyOpen && <ToStorySheet chat={chat} messages={list} model={effModel} onClose={() => setStoryOpen(false)} onOpenPage={(pid) => { setStoryOpen(false); nav(`/page/${pid}`); }} />}

      <ModelPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        value={effModel ?? { provider: '', model: '' }}
        onPick={setModel}
        thinking={effThinking}
        onThinking={setThinking}
        peak={peak}
        contextTokens={ctxTokens}
      />
    </div>
  );
}

function styleHint(st: RpStyle | undefined): string {
  const x = { ...DEFAULT_STYLE, ...st };
  const pov = { third: 'Orang ketiga', second: 'Orang kedua', first: 'Orang pertama' }[x.pov];
  return [pov, x.role === 'narrator' ? 'narator' : '', x.pace !== 'medium' ? (x.pace === 'slow' ? 'lambat' : 'cepat') : '', x.register !== 'santai' ? x.register : ''].filter(Boolean).join(' · ');
}

function summaryHint(mode: string | undefined): string {
  return mode === 'always' ? 'Selalu' : mode === 'off' ? 'Mati' : 'Otomatis';
}

/* ---------- Pesan ---------- */

const UserTurn = memo(
  function UserTurn({ m, name, avatar, photo, onAction }: { m: Message; name: string; avatar: Blob | null | undefined; photo?: Blob | null; onAction: (k: TurnAction, m: Message) => void }) {
    const lp = useLongPress(() => onAction('menu', m));
    return (
      <div className="msg user rp-turn" data-mid={m.id}>
        <div className="rp-turn-row">
          {m.pinned && <span className="rp-pin" aria-label="Disematkan">📌</span>}
          <div className="bubble pressable rp-user-bubble" {...lp}>
            <Md text={m.text} />
          </div>
          <Avatar blob={avatar} view={photo} name={name} size={28} />
        </div>
      </div>
    );
  },
  (a, b) => a.m.id === b.m.id && a.m.text === b.m.text && a.m.pinned === b.m.pinned && a.name === b.name && a.avatar === b.avatar && a.photo === b.photo,
);

/** MarkdownView dengan hasil parse yang diingat. */
const Md = memo(function Md({ text }: { text: string }) {
  return <MarkdownView text={text} />;
});

const AiTurn = memo(
  function AiTurn({
    m,
    name,
    avatar,
    photo,
    text,
    streaming,
    status,
    canSwipe,
    showActions,
    busy,
    rate,
    onAction,
  }: {
    m: Message;
    name: string;
    avatar: Blob | null;
    photo?: Blob | null;
    text: string;
    streaming: boolean;
    status: string | null;
    canSwipe: boolean;
    showActions: boolean;
    busy: boolean;
    rate: number;
    onAction: (k: TurnAction, m: Message, arg?: number) => void;
  }) {
    const lp = useLongPress(() => onAction('menu', m));
    const touch = useRef<{ x: number; y: number } | null>(null);
    const n = m.versions.length;
    const go = (d: 1 | -1) => {
      const i = m.active + d;
      if (i >= 0 && i < n) onAction('version', m, i);
    };
    const meta = [
      m.status === 'stopped' ? 'dihentikan' : '',
      m.status === 'interrupted' ? 'terputus' : '',
      !m.greeting && m.costUsd > 0 ? formatRupiah(m.costUsd * rate) + (m.costUnknown ? '+' : '') : '',
      m.lore?.length ? `📖 ${m.lore.length}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <div className="msg ai rp-turn" data-mid={m.id}>
        <div className="rp-turn-head">
          <Avatar blob={avatar} view={photo} name={name} size={28} />
          <span>{name}</span>
          {m.pinned && <span className="rp-pin" aria-label="Disematkan">📌</span>}
          {m.greeting && <small>pembuka</small>}
        </div>
        <div
          className={'rp-ai-text pressable' + (streaming ? ' streaming' : '')}
          {...lp}
          onTouchStart={(e) => {
            touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          }}
          onTouchEnd={(e) => {
            const s = touch.current;
            touch.current = null;
            if (!s || !canSwipe) return;
            const dx = e.changedTouches[0].clientX - s.x;
            const dy = e.changedTouches[0].clientY - s.y;
            // Geser mendatar di balasan = ganti versi.
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
          }}
        >
          {text.trim() ? <Md text={text} /> : null}
          {streaming && (
            <span className="typing">
              <span />
              <span />
              <span />
              {status ? ` ${status}` : ''}
            </span>
          )}
          {!streaming && !text.trim() && m.error && <div className="error-line">Gagal: {m.error}</div>}
        </div>
        {!streaming && text.trim() && m.error && m.status !== 'done' && <div className="soft-line">{m.error}</div>}
        {(canSwipe || meta) && (
          <div className="msg-meta">
            {canSwipe && (
              <span className="versions">
                <button className="act-btn" aria-label="Versi sebelumnya" disabled={m.active === 0} onClick={() => go(-1)}>
                  ‹
                </button>
                {m.active + 1}/{n}
                <button className="act-btn" aria-label="Versi berikutnya" disabled={m.active >= n - 1} onClick={() => go(1)}>
                  ›
                </button>
              </span>
            )}
            {meta && <span>{meta}</span>}
          </div>
        )}
        {showActions && (
          <div className="action-row">
            <button className="act-btn" aria-label="Salin" onClick={() => onAction('copy', m)}>
              <IconCopy size={17} />
            </button>
            <button className="act-btn" aria-label="Coba lagi" disabled={busy} onClick={() => onAction('retry', m)}>
              <IconRetry size={17} />
            </button>
            {(m.status === 'stopped' || m.status === 'interrupted') && m.text.trim() && (
              <button className="act-text" disabled={busy} onClick={() => onAction('resume', m)}>
                Sambung balasan
              </button>
            )}
            <button className="act-btn" aria-label="Aksi lain" onClick={() => onAction('menu', m)}>
              <IconMore size={17} />
            </button>
          </div>
        )}
      </div>
    );
  },
  (a, b) =>
    a.m.id === b.m.id &&
    a.m.text === b.m.text &&
    a.m.active === b.m.active &&
    a.m.versions.length === b.m.versions.length &&
    a.m.status === b.m.status &&
    a.m.error === b.m.error &&
    a.m.costUsd === b.m.costUsd &&
    (a.m.lore?.length ?? 0) === (b.m.lore?.length ?? 0) &&
    a.name === b.name &&
    a.avatar === b.avatar &&
    a.photo === b.photo &&
    a.m.pinned === b.m.pinned &&
    a.text === b.text &&
    a.streaming === b.streaming &&
    a.status === b.status &&
    a.canSwipe === b.canSwipe &&
    a.showActions === b.showActions &&
    a.busy === b.busy &&
    a.rate === b.rate,
);

function MessageMenu({
  m,
  isLastAsst,
  isLastUser,
  busy,
  onClose,
  onCopy,
  onEdit,
  onRetry,
  onPolish,
  onInfo,
  onDelete,
  onPin,
  onBranch,
}: {
  m: Menu;
  isLastAsst: boolean;
  isLastUser: boolean;
  busy: boolean;
  onClose: () => void;
  onCopy: (m: Message) => void;
  onEdit: (m: Message) => void;
  onRetry: (m: Message) => void;
  onPolish: (m: Message) => void;
  onInfo: (m: Message) => void;
  onDelete: (m: Message) => void;
  onPin: (m: Message) => void;
  onBranch: (m: Message) => void;
}) {
  const act = (fn: (m: Message) => void) => () => {
    if (!m) return;
    onClose();
    fn(m);
  };
  return (
    <Sheet open={!!m} onClose={onClose} title={m?.role === 'user' ? 'Pesan Anda' : 'Balasan'}>
      {m && (
        <>
          <SheetItem icon={<IconCopy />} label="Salin" onClick={act(onCopy)} />
          <SheetItem icon={<IconEdit />} label="Edit" disabled={busy} onClick={act(onEdit)} />
          {isLastAsst && !m.greeting && <SheetItem icon={<IconRetry />} label="Coba lagi" hint="Versi baru (maks. 10)" disabled={busy} onClick={act(onRetry)} />}
          {isLastUser && <SheetItem icon={<IconSparkle />} label="Perhalus dengan AI" disabled={busy} onClick={act(onPolish)} />}
          <SheetItem icon={<IconPin />} label={m.pinned ? 'Lepas semat' : 'Sematkan'} hint={m.pinned ? undefined : 'Mudah ditemukan; tetap dibaca AI walau sudah lama'} onClick={act(onPin)} />
          <SheetItem icon={<IconCopy />} label="Buat cabang dari sini" hint="Chat baru sampai pesan ini, untuk mencoba alur lain" disabled={busy} onClick={act(onBranch)} />
          {m.role === 'assistant' && !m.greeting && <SheetItem icon={<IconList />} label="Info" hint="Model, biaya, lorebook aktif" onClick={act(onInfo)} />}
          <SheetItem icon={<IconTrash />} label="Hapus…" danger disabled={busy} onClick={act(onDelete)} />
        </>
      )}
    </Sheet>
  );
}

/* ---------- Memori chat ---------- */

function MemorySheet({ chatId, initial, propose, onClose }: { chatId: string; initial: string; propose: boolean; onClose: () => void }) {
  const [text, setText] = useState(initial);
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState('');
  const [proposal, setProposal] = useState<string | null>(null);
  const started = useRef(false);
  const run = async () => {
    setRunning(true);
    setLive('');
    setProposal(null);
    try {
      // Memori yang sedang diedit dipakai sebagai memori lama.
      await db.chats.update(chatId, { memory: text.trim() });
      setProposal(await proposeMemory(chatId, setLive));
    } catch (e) {
      toast('Gagal: ' + ((e as Error).message || e));
    } finally {
      setRunning(false);
    }
  };
  useEffect(() => {
    if (propose && !started.current) {
      started.current = true;
      void run();
    }
  }, [propose]); // eslint-disable-line react-hooks/exhaustive-deps
  if (running || proposal !== null) {
    return (
      <Sheet open onClose={onClose} title="Usulan memori baru">
        {running ? (
          <div className="assist-live">
            {live && <MarkdownView text={live} />}
            <span className="typing">
              <span />
              <span />
              <span />
            </span>
          </div>
        ) : (
          <>
            <p className="note pad">Periksa dan ubah kalau perlu. Memori lama diganti.</p>
            <textarea className="input textarea-md" value={proposal ?? ''} onChange={(e) => setProposal(e.target.value)} />
          </>
        )}
        <div className="row-buttons pad">
          <button className="btn" onClick={() => setProposal(null)} disabled={running}>
            Batal
          </button>
          <button className="btn" onClick={() => void run()} disabled={running}>
            <IconRetry size={16} /> Coba lagi
          </button>
          <button
            className="btn btn-primary"
            disabled={running || !proposal?.trim()}
            onClick={async () => {
              await saveMemory(chatId, proposal!);
              toast('Memori diperbarui');
              onClose();
            }}
          >
            Terima
          </button>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet open onClose={onClose} title="Memori chat">
      <p className="note pad">Hubungan, situasi sekarang, fakta yang sudah pasti, dan tujuan yang belum selesai. Dibaca AI di setiap giliran (ditempel di akhir, jadi tidak mereset cache).</p>
      <textarea className="input textarea-md" value={text} placeholder={'mis.\n- Rika dan Dimas baru berbaikan setelah bertengkar di studio.\n- Malam ini mereka di atap sekolah.'} onChange={(e) => setText(e.target.value)} />
      <div className="row-buttons pad">
        <button className="btn" onClick={() => void run()}>
          <IconSparkle size={16} /> Perbarui dengan AI
        </button>
        <button
          className="btn btn-primary"
          onClick={async () => {
            await saveMemory(chatId, text);
            toast('Memori disimpan');
            onClose();
          }}
        >
          Simpan
        </button>
      </div>
    </Sheet>
  );
}

/* ---------- Ringkasan pesan lama ---------- */

function RpSummariesSheet({
  chatId,
  messages,
  mode,
  budget,
  ctxTokens,
  modelLimit,
  onClose,
  fill,
}: {
  chatId: string;
  messages: Message[];
  mode: 'auto' | 'always' | 'off';
  budget: number;
  ctxTokens: number;
  modelLimit: number;
  onClose: () => void;
  fill: (t: string) => string;
}) {
  const stored = useLiveQuery(() => db.rpSummaries.where('chatId').equals(chatId).toArray(), [chatId]);
  const [busy, setBusy] = useState<number | null>(null);
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null);
  const blocks = summaryBlocks(historyOf(messages), stored ?? []);
  const total = historyOf(messages).filter((m) => !m.greeting).length;
  return (
    <>
      <Sheet open={!edit} onClose={onClose} title="Ringkasan pesan lama">
        <p className="note pad">
          Untuk chat panjang, pesan lama dikirim ke AI sebagai ringkasan per {RP_KEEP_FULL} pesan. Pesan pembuka dan {RP_KEEP_FULL} pesan terakhir selalu dikirim utuh.
        </p>
        <div className="segmented sheet-seg">
          {(['auto', 'always', 'off'] as const).map((m) => (
            <button
              key={m}
              className={mode === m ? 'active' : ''}
              onClick={async () => {
                await db.chats.update(chatId, { summaryMode: m });
                markChanged();
              }}
            >
              {summaryHint(m)}
            </button>
          ))}
        </div>
        {mode === 'auto' && (
          <>
            <p className="note pad">Batas konteks roleplay (chat ini ±{formatNumber(Math.round(ctxTokens / 1000))} ribu token):</p>
            <div className="segmented sheet-seg">
              {RP_CONTEXT_OPTIONS.map((v) => (
                <button
                  key={v}
                  className={budget === v ? 'active' : ''}
                  onClick={async () => {
                    await db.chats.update(chatId, { rpContext: v });
                    markChanged();
                  }}
                >
                  {v ? `${v / 1000}rb` : 'Model'}
                </button>
              ))}
            </div>
          </>
        )}
        <p className="note pad">
          {mode === 'auto'
            ? `Otomatis: pesan lama diringkas kalau chat melewati ${budget ? `${formatNumber(budget / 1000)} ribu token` : `60% batas konteks model${modelLimit ? ` (±${formatNumber(Math.round((modelLimit * 0.6) / 1000))} ribu)` : ''}`}. Lebih kecil = lebih hemat dan AI lebih fokus pada kartu; lebih besar = AI membaca lebih banyak detail.`
            : mode === 'always'
              ? 'Selalu: pesan lama selalu dikirim sebagai ringkasan (lebih hemat).'
              : 'Mati: semua pesan dikirim utuh.'}
        </p>
        {blocks.length === 0 && (
          <p className="note pad">Belum ada pesan yang bisa diringkas ({total} pesan; ringkasan mulai setelah {RP_KEEP_FULL * 2} pesan).</p>
        )}
        {blocks.map((b, i) => {
          const s = stored?.find((x) => x.fromSeq === b.fromSeq);
          const status = !s ? 'belum diringkas' : s.hash !== blockHash(b.msgs) ? 'perlu diperbarui (ada pesan diubah)' : 'diringkas';
          return (
            <div key={b.fromSeq} className="summary-row">
              <button className="summary-main" disabled={!s} onClick={() => s && setEdit({ id: s.id, text: s.text })}>
                <b>
                  Bagian {i + 1} · {b.msgs.length} pesan
                </b>
                <small>
                  {status}
                  {s ? ` · ${fill(s.text).slice(0, 60)}…` : ''}
                </small>
              </button>
              <button
                className="btn btn-small"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy(b.fromSeq);
                  try {
                    await summarizeNow(chatId, b.fromSeq);
                  } catch (e) {
                    toast('Gagal: ' + ((e as Error).message || e));
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {busy === b.fromSeq ? 'Meringkas…' : s ? 'Perbarui' : 'Buat'}
              </button>
            </div>
          );
        })}
      </Sheet>
      {edit && (
        <Sheet open onClose={() => setEdit(null)} title="Edit ringkasan">
          <textarea className="input textarea-md" value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} />
          <div className="row-buttons pad">
            <button className="btn" onClick={() => setEdit(null)}>
              Batal
            </button>
            <button
              className="btn btn-primary"
              disabled={!edit.text.trim()}
              onClick={async () => {
                await db.rpSummaries.update(edit.id, { text: edit.text.trim() });
                markChanged();
                setEdit(null);
                toast('Ringkasan disimpan');
              }}
            >
              Simpan
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}

/* ---------- Riwayat biaya ---------- */

function RpCostSheet({ chatId, messages, rate, onClose }: { chatId: string; messages: Message[]; rate: number; onClose: () => void }) {
  const usage = useLiveQuery(() => db.usage.where('rootId').equals(chatId).toArray(), [chatId]);
  const rows = [
    ...messages.filter((m) => m.role === 'assistant' && m.costUsd > 0).map((m) => ({ id: m.id, label: firstLine(m.text) || 'Balasan', cost: m.costUsd, at: m.createdAt })),
    ...(usage ?? []).filter((u) => u.costUsd > 0).map((u) => ({ id: u.id, label: u.label, cost: u.costUsd, at: u.at })),
  ].sort((a, b) => b.at - a.at);
  const total = rows.reduce((n, r) => n + r.cost, 0);
  return (
    <Sheet open onClose={onClose} title="Riwayat biaya">
      <div className="cost-total">
        Total chat ini: <b>{formatRupiah(total * rate)}</b> <small>({formatUsd(total)})</small>
      </div>
      {rows.length === 0 && <p className="note">Belum ada pemakaian AI.</p>}
      {rows.map((r) => (
        <div key={r.id} className="cost-row">
          <span className="cost-label">{r.label}</span>
          <span className="cost-val">{formatRupiah(r.cost * rate)}</span>
        </div>
      ))}
    </Sheet>
  );
}

function firstLine(t: string): string {
  return t.trim().split('\n')[0].slice(0, 60);
}
