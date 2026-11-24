import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db, type Chat } from '../../db';
import { IconBack, IconBook, IconChat, IconCopy, IconEdit, IconMore, IconPin, IconShare, IconTrash } from '../../components/Icons';
import { Avatar } from '../../components/rp/Avatar';
import { ConfirmSheet, PromptSheet, Sheet, SheetItem, toast, useLongPress } from '../../components/ui';
import { goBack } from '../../lib/nav';
import { fillMacros } from '../../lib/rp/cards';
import { duplicateCharacter, duplicateRpChat, emptyPersona, ensureOwnLorebook, listPersonas, saveCharacter, savePersona, trashCharacter } from '../../lib/rp/data';
import { startRpChat } from '../../lib/rp/engine';
import { markChanged } from '../../lib/settings';
import { trashChat } from '../../lib/pages';
import { timeAgo } from '../../lib/util';
import { ExportSheet } from './RoleplayTab';

export default function CharacterView() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const c = useLiveQuery(() => db.characters.get(id), [id]);
  const chats = useLiveQuery(async () => {
    const list = (await db.chats.where('characterId').equals(id).toArray()).filter((x) => !x.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt);
    const out = [];
    for (const ch of list) {
      const last = await db.messages.where('[chatId+seq]').between([ch.id, -Infinity], [ch.id, Infinity]).last();
      out.push({ chat: ch, last: last?.text ?? '' });
    }
    return out;
  }, [id]);
  const personas = useLiveQuery(listPersonas, []);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickGreeting, setPickGreeting] = useState(false);
  const [askName, setAskName] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [chatMenu, setChatMenu] = useState<Chat | null>(null);
  const [rename, setRename] = useState<Chat | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);

  if (c === undefined) return <div className="screen" />;
  if (!c || c.deletedAt) {
    return (
      <div className="screen">
        <div className="empty">
          <h2>Karakter tidak ditemukan</h2>
          <button className="btn" onClick={() => nav('/roleplay')}>
            Ke Roleplay
          </button>
        </div>
      </div>
    );
  }
  const greetings = [c.firstMes, ...c.altGreetings].filter((g) => g.trim());
  const userName = personas?.find((p) => p.isDefault)?.name ?? 'Anda';

  const begin = async (greeting?: number) => {
    try {
      const chatId = await startRpChat(c.id, { greeting });
      nav(`/rp/chat/${chatId}`);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const onStart = () => {
    // Belum ada persona: tanya nama dulu, supaya {{user}} punya nama.
    if (!personas?.length) setAskName(true);
    else if (greetings.length > 1) setPickGreeting(true);
    else void begin(0);
  };

  return (
    <div className="screen">
      <header className="page-header">
        <button className="icon-btn" aria-label="Kembali" onClick={() => goBack(nav)}>
          <IconBack />
        </button>
        <div className="chat-head-title">{c.name}</div>
        <button className="icon-btn" aria-label="Edit karakter" onClick={() => nav(`/rp/c/${c.id}/edit`)}>
          <IconEdit />
        </button>
        <button className="icon-btn" aria-label="Menu karakter" onClick={() => setMenuOpen(true)}>
          <IconMore />
        </button>
      </header>
      <div className="scroll-area">
        <div className="rp-profile">
          <Avatar blob={c.avatar} name={c.name} size={112} />
          <h1>{c.name}</h1>
          {c.tags.length > 0 && (
            <div className="tag-row center">
              {c.tags.map((t) => (
                <span key={t} className="chip static">
                  {t}
                </span>
              ))}
            </div>
          )}
          {c.creatorNotes.trim() && (
            <button className={'rp-notes' + (notesOpen ? ' open' : '')} onClick={() => setNotesOpen((v) => !v)}>
              {c.creatorNotes.trim()}
            </button>
          )}
          <button className="btn btn-primary rp-start" onClick={onStart}>
            <IconChat size={18} /> Mulai chat
          </button>
        </div>

        <section>
          <div className="section-head static">Chat dengan {c.name}</div>
          {chats?.length === 0 && <p className="note pad">Belum ada chat.</p>}
          <ul className="chat-list">
            {chats?.map(({ chat, last }) => (
              <ChatRow key={chat.id} chat={chat} last={last} onOpen={() => nav(`/rp/chat/${chat.id}`)} onMenu={() => setChatMenu(chat)} />
            ))}
          </ul>
        </section>
      </div>

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={c.name}>
        <SheetItem icon={<IconEdit />} label="Edit karakter" onClick={() => { setMenuOpen(false); nav(`/rp/c/${c.id}/edit`); }} />
        <SheetItem
          icon={<IconBook />}
          label="Lorebook karakter"
          hint="Ikut kartu saat diekspor"
          onClick={async () => {
            setMenuOpen(false);
            const b = await ensureOwnLorebook(c);
            nav(`/rp/lore/${b.id}`);
          }}
        />
        <SheetItem icon={<IconPin />} label={c.pinned ? 'Lepas pin' : 'Pin di atas'} onClick={async () => { await saveCharacter({ ...c, pinned: !c.pinned }); setMenuOpen(false); }} />
        <SheetItem icon={<IconShare />} label="Ekspor kartu" onClick={() => { setMenuOpen(false); setExportOpen(true); }} />
        <SheetItem
          icon={<IconCopy />}
          label="Duplikat"
          onClick={async () => {
            setMenuOpen(false);
            const d = await duplicateCharacter(c.id);
            if (d) nav(`/rp/c/${d.id}`, { replace: true });
          }}
        />
        <SheetItem icon={<IconTrash />} label="Hapus karakter" hint="Chat-chatnya ikut ke Sampah" danger onClick={() => { setMenuOpen(false); setConfirmDel(true); }} />
      </Sheet>

      <Sheet open={pickGreeting} onClose={() => setPickGreeting(false)} title="Pilih pembuka">
        <p className="note pad">Bisa diganti lagi di chat sebelum Anda membalas.</p>
        {greetings.map((g, i) => (
          <button
            key={i}
            className="rp-greeting-pick"
            onClick={() => {
              setPickGreeting(false);
              void begin(i);
            }}
          >
            <small>Pembuka {i + 1}</small>
            <span className="clamp3">{fillMacros(g, c.name, userName)}</span>
          </button>
        ))}
      </Sheet>

      <PromptSheet
        open={askName}
        title="Nama Anda di roleplay"
        initial=""
        placeholder="mis. Dimas"
        note="Nama ini dipakai sebagai {{user}}. Deskripsi persona bisa dilengkapi nanti di Persona saya."
        confirmLabel="Lanjut"
        onClose={() => setAskName(false)}
        onSubmit={async (v) => {
          if (!v.trim()) {
            toast('Nama tidak boleh kosong.');
            return;
          }
          await savePersona({ ...emptyPersona(v.trim()), isDefault: true });
          if (greetings.length > 1) setPickGreeting(true);
          else void begin(0);
        }}
      />

      <ExportSheet c={exportOpen ? c : null} onClose={() => setExportOpen(false)} />
      <ConfirmSheet
        open={confirmDel}
        title="Hapus karakter?"
        message={`${c.name} dan semua chat-nya dipindah ke Sampah (30 hari).`}
        confirmLabel="Hapus"
        danger
        onClose={() => setConfirmDel(false)}
        onConfirm={async () => {
          await trashCharacter(c.id);
          toast('Dipindah ke Sampah');
          goBack(nav);
        }}
      />

      <Sheet open={!!chatMenu} onClose={() => setChatMenu(null)} title={chatMenu?.title}>
        {chatMenu && (
          <>
            <SheetItem icon={<IconEdit />} label="Ganti nama" onClick={() => { setRename(chatMenu); setChatMenu(null); }} />
            <SheetItem
              icon={<IconCopy />}
              label="Duplikat"
              hint="Untuk mencoba alur lain dari titik yang sama"
              onClick={async () => {
                await duplicateRpChat(chatMenu.id);
                setChatMenu(null);
                toast('Chat diduplikat');
              }}
            />
            <SheetItem
              icon={<IconTrash />}
              label="Hapus chat"
              danger
              onClick={async () => {
                await trashChat(chatMenu.id);
                setChatMenu(null);
                toast('Chat dipindah ke Sampah');
              }}
            />
          </>
        )}
      </Sheet>
      <PromptSheet
        open={!!rename}
        title="Nama chat"
        initial={rename?.title ?? ''}
        onClose={() => setRename(null)}
        onSubmit={(v) => {
          if (!rename || !v.trim()) return;
          void db.chats.update(rename.id, { title: v.trim(), titleAuto: false });
          markChanged();
        }}
      />
    </div>
  );
}

function ChatRow({ chat, last, onOpen, onMenu }: { chat: Chat; last: string; onOpen: () => void; onMenu: () => void }) {
  const lp = useLongPress(onMenu);
  const s = last.trim().replace(/\s+/g, ' ');
  return (
    <li className="chat-row">
      <button className="chat-main pressable" onClick={onOpen} {...lp}>
        <span className="chat-title">{chat.title}</span>
        <small>
          {timeAgo(chat.updatedAt)}
          {s ? ` · ${s.length > 70 ? '…' + s.slice(-70) : s}` : ''}
        </small>
      </button>
      <button className="icon-btn" aria-label="Menu chat" onClick={onMenu}>
        <IconMore size={20} />
      </button>
    </li>
  );
}
