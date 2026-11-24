import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, type Character } from '../../db';
import { IconBook, IconChevron, IconCopy, IconEdit, IconImport, IconMore, IconPen, IconPin, IconPlus, IconSearch, IconShare, IconSparkle, IconTrash, IconUser } from '../../components/Icons';
import { Avatar } from '../../components/rp/Avatar';
import { ConfirmSheet, Sheet, SheetItem, toast, useLongPress } from '../../components/ui';
import { cardFileName, cardJsonBlob, cardPngBlob, makeAvatar, readCardFile } from '../../lib/rp/cards';
import { duplicateCharacter, importCard, ownLorebook, saveCharacter, trashCharacter } from '../../lib/rp/data';
import { downloadFile, shareFile, timeAgo } from '../../lib/util';

function snippet(t: string): string {
  const s = t.trim().replace(/\s+/g, ' ');
  return s.length > 90 ? '…' + s.slice(-90) : s;
}

export async function exportCard(c: Character, kind: 'png' | 'json') {
  try {
    const book = (await ownLorebook(c.id)) ?? null;
    const blob = kind === 'png' ? await cardPngBlob(c, book) : cardJsonBlob(c, book);
    const name = cardFileName(c.name, kind);
    const r = await shareFile(name, blob, c.name);
    if (r === 'unsupported') toast(`Disimpan: ${await downloadFile(name, blob)}`);
  } catch (e) {
    toast('Gagal mengekspor: ' + ((e as Error).message || e));
  }
}

export default function RoleplayTab() {
  const nav = useNavigate();
  const chars = useLiveQuery(() => db.characters.filter((c) => !c.deletedAt).toArray(), []);
  const recent = useLiveQuery(async () => {
    const chats = (await db.chats.filter((c) => c.kind === 'roleplay' && !c.deletedAt).toArray()).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
    const out = [];
    for (const c of chats) {
      const ch = c.characterId ? await db.characters.get(c.characterId) : undefined;
      if (!ch || ch.deletedAt) continue;
      const last = await db.messages.where('[chatId+seq]').between([c.id, -Infinity], [c.id, Infinity]).last();
      out.push({ chat: c, character: ch, last: last?.text ?? '' });
    }
    return out;
  }, []);
  const counts = useLiveQuery(async () => {
    const m = new Map<string, number>();
    for (const c of await db.chats.filter((x) => x.kind === 'roleplay' && !x.deletedAt).toArray()) if (c.characterId) m.set(c.characterId, (m.get(c.characterId) ?? 0) + 1);
    return m;
  }, []);
  const [tag, setTag] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [menu, setMenu] = useState<Character | null>(null);
  const [exportFor, setExportFor] = useState<Character | null>(null);
  const [confirmDel, setConfirmDel] = useState<Character | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const tags = useMemo(() => [...new Set((chars ?? []).flatMap((c) => c.tags.map((t) => t.trim()).filter(Boolean)))].sort(), [chars]);
  const list = useMemo(
    () =>
      [...(chars ?? [])]
        .filter((c) => !tag || c.tags.includes(tag))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || Math.max(b.usedAt, b.updatedAt) - Math.max(a.usedAt, a.updatedAt)),
    [chars, tag],
  );

  const doImport = async (f: File | undefined) => {
    if (!f) return;
    try {
      const card = await readCardFile(f);
      const avatar = card.image ? await makeAvatar(card.image).catch(() => null) : null;
      const c = await importCard(card, avatar);
      toast(`${c.name} diimpor${card.lorebook ? ` dengan ${card.lorebook.entries.length} entri lorebook` : ''}`);
      nav(`/rp/c/${c.id}/edit?imported=1`);
    } catch (e) {
      toast((e as Error).message || 'Gagal membaca kartu.');
    }
  };

  return (
    <div className="screen tab-screen">
      <div className="scroll-area">
        {chars && chars.length === 0 && (
          <div className="empty">
            <div className="empty-emoji">🎭</div>
            <h2>Belum ada karakter</h2>
            <p>Buat karakter untuk roleplay: tulis sendiri, minta AI membuatkan dari ide singkat, atau impor kartu dari Chub/SillyTavern.</p>
            <div className="row-buttons center">
              <button className="btn" onClick={() => nav('/rp/c/new/edit')}>
                <IconPen size={16} /> Tulis sendiri
              </button>
              <button className="btn" onClick={() => nav('/rp/c/new/edit?ai=1')}>
                <IconSparkle size={16} /> Buat dengan AI
              </button>
              <button className="btn" onClick={() => fileRef.current?.click()}>
                <IconImport size={16} /> Impor kartu
              </button>
            </div>
          </div>
        )}

        {(recent?.length ?? 0) > 0 && (
          <section>
            <div className="section-head static">Lanjutkan</div>
            <div className="recents">
              {recent!.map(({ chat, character, last }) => (
                <button key={chat.id} className="recent-card rp-recent" onClick={() => nav(`/rp/chat/${chat.id}`)}>
                  <div className="rp-recent-top">
                    <Avatar blob={character.avatar} name={character.name} size={36} />
                    <span className="rp-recent-name">
                      <b>{character.name}</b>
                      <small>{timeAgo(chat.updatedAt)}</small>
                    </span>
                  </div>
                  <span className="recent-excerpt">{snippet(last) || chat.title}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {(chars?.length ?? 0) > 0 && (
          <section>
            <div className="section-head static">Karakter</div>
            {tags.length > 0 && (
              <div className="tag-row">
                <button className={'chip' + (!tag ? ' active' : '')} onClick={() => setTag(null)}>
                  Semua
                </button>
                {tags.map((t) => (
                  <button key={t} className={'chip' + (tag === t ? ' active' : '')} onClick={() => setTag(tag === t ? null : t)}>
                    {t}
                  </button>
                ))}
              </div>
            )}
            <ul className="chat-list">
              {list.map((c) => (
                <CharRow key={c.id} c={c} count={counts?.get(c.id) ?? 0} onOpen={() => nav(`/rp/c/${c.id}`)} onMenu={() => setMenu(c)} />
              ))}
            </ul>
          </section>
        )}

        <section>
          <button className="settings-link rp-link" onClick={() => nav('/rp/personas')}>
            <IconUser size={18} /> Persona saya <IconChevron size={16} />
          </button>
          <button className="settings-link rp-link" onClick={() => nav('/rp/lore')}>
            <IconBook size={18} /> Lorebook dunia <IconChevron size={16} />
          </button>
        </section>
      </div>

      <div className="bottom-bar">
        <button className="round-btn" aria-label="Cari" onClick={() => nav('/search')}>
          <IconSearch />
        </button>
        <button className="ask-ai" onClick={() => setNewOpen(true)}>
          <span className="ask-ai-icon">
            <IconPlus size={16} />
          </span>
          Karakter baru
        </button>
        <button className="round-btn" aria-label="Persona saya" onClick={() => nav('/rp/personas')}>
          <IconUser />
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        hidden
        accept=".png,.json,image/png,application/json"
        onChange={(e) => {
          void doImport(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      <Sheet open={newOpen} onClose={() => setNewOpen(false)} title="Karakter baru">
        <SheetItem icon={<IconPen />} label="Tulis sendiri" hint="Isi kolom kartu karakter" onClick={() => { setNewOpen(false); nav('/rp/c/new/edit'); }} />
        <SheetItem icon={<IconSparkle />} label="Buat dengan AI" hint="Dari ide singkat, lalu Anda periksa" onClick={() => { setNewOpen(false); nav('/rp/c/new/edit?ai=1'); }} />
        <SheetItem icon={<IconImport />} label="Impor kartu" hint="PNG atau JSON (Chub, SillyTavern)" onClick={() => { setNewOpen(false); fileRef.current?.click(); }} />
      </Sheet>

      <Sheet open={!!menu} onClose={() => setMenu(null)} title={menu?.name}>
        {menu && (
          <>
            <SheetItem icon={<IconEdit />} label="Edit karakter" onClick={() => { setMenu(null); nav(`/rp/c/${menu.id}/edit`); }} />
            <SheetItem
              icon={<IconPin />}
              label={menu.pinned ? 'Lepas pin' : 'Pin di atas'}
              onClick={async () => {
                await saveCharacter({ ...menu, pinned: !menu.pinned });
                setMenu(null);
              }}
            />
            <SheetItem
              icon={<IconCopy />}
              label="Duplikat"
              onClick={async () => {
                await duplicateCharacter(menu.id);
                setMenu(null);
                toast('Karakter diduplikat');
              }}
            />
            <SheetItem icon={<IconShare />} label="Ekspor kartu" hint="PNG atau JSON" onClick={() => { setExportFor(menu); setMenu(null); }} />
            <SheetItem icon={<IconTrash />} label="Hapus" hint="Chat-chatnya ikut ke Sampah" danger onClick={() => { setConfirmDel(menu); setMenu(null); }} />
          </>
        )}
      </Sheet>
      <ExportSheet c={exportFor} onClose={() => setExportFor(null)} />
      <ConfirmSheet
        open={!!confirmDel}
        title="Hapus karakter?"
        message={`${confirmDel?.name} dan semua chat-nya dipindah ke Sampah (30 hari).`}
        confirmLabel="Hapus"
        danger
        onClose={() => setConfirmDel(null)}
        onConfirm={async () => {
          if (!confirmDel) return;
          await trashCharacter(confirmDel.id);
          toast('Dipindah ke Sampah');
        }}
      />
    </div>
  );
}

export function ExportSheet({ c, onClose }: { c: Character | null; onClose: () => void }) {
  return (
    <Sheet open={!!c} onClose={onClose} title="Ekspor kartu">
      {c && (
        <>
          <SheetItem icon={<IconShare />} label="PNG (kartu bergambar)" hint="Bisa dibuka di SillyTavern, Chub, dan aplikasi ini" onClick={() => { onClose(); void exportCard(c, 'png'); }} />
          <SheetItem icon={<IconShare />} label="JSON" hint="Character Card V2" onClick={() => { onClose(); void exportCard(c, 'json'); }} />
        </>
      )}
    </Sheet>
  );
}

function CharRow({ c, count, onOpen, onMenu }: { c: Character; count: number; onOpen: () => void; onMenu: () => void }) {
  const lp = useLongPress(onMenu);
  return (
    <li className="chat-row">
      <button className="chat-main pressable rp-char-main" onClick={onOpen} {...lp}>
        <Avatar blob={c.avatar} name={c.name} size={44} />
        <span className="rp-char-text">
          <span className="chat-title">
            {c.pinned ? '📌 ' : ''}
            {c.name}
          </span>
          <small>
            {[c.tags.slice(0, 3).join(', '), count ? `${count} chat` : 'belum ada chat'].filter(Boolean).join(' · ')}
          </small>
        </span>
      </button>
      <button className="icon-btn" aria-label="Menu karakter" onClick={onMenu}>
        <IconMore size={20} />
      </button>
    </li>
  );
}
