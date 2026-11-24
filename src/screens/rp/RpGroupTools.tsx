import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db, type Character, type Chat } from '../../db';
import { IconDown, IconPlus, IconTrash, IconUp } from '../../components/Icons';
import { Avatar } from '../../components/rp/Avatar';
import { ConfirmSheet, Sheet, SheetItem, toast } from '../../components/ui';
import { addMember, moveMember, removeMember, toggleMute } from '../../lib/rp/data';
import { isGroupChat, MAX_MEMBERS } from '../../lib/rp/group';
import { markChanged } from '../../lib/settings';

export const TURN_LABEL = { auto: 'Otomatis', order: 'Berurutan', manual: 'Manual' } as const;

/** Avatar anggota bertumpuk (maks. 3 + "+n"). */
export function StackedAvatars({ members, size = 30 }: { members: Character[]; size?: number }) {
  const shown = members.slice(0, 3);
  const more = members.length - shown.length;
  return (
    <span className="rp-stack" style={{ height: size }}>
      {shown.map((c, i) => (
        <span key={c.id} className="rp-stack-item" style={{ marginLeft: i ? -size * 0.38 : 0, zIndex: 3 - i }}>
          <Avatar blob={c.avatar} name={c.name} size={size} />
        </span>
      ))}
      {more > 0 && (
        <span className="rp-stack-more" style={{ width: size, height: size, marginLeft: -size * 0.38 }}>
          +{more}
        </span>
      )}
    </span>
  );
}

/** Baris avatar di atas kolom ketik: cincin = yang bicara berikutnya; ketuk = pilih yang menjawab (sekali). */
export function MemberRow({ members, muted, next, forced, disabled, onPick }: { members: Character[]; muted: string[]; next: string | null; forced: string | null; disabled: boolean; onPick: (id: string | null) => void }) {
  const active = members.filter((m) => !muted.includes(m.id));
  return (
    <div className="rp-member-row" role="toolbar" aria-label="Pilih yang menjawab">
      {active.map((m) => (
        <button
          key={m.id}
          className={'rp-member' + (m.id === next ? ' next' : '') + (m.id === forced ? ' forced' : '')}
          aria-label={`${m.name} menjawab berikutnya`}
          aria-pressed={m.id === forced}
          disabled={disabled}
          onClick={() => onPick(m.id === forced ? null : m.id)}
        >
          <Avatar blob={m.avatar} name={m.name} size={30} />
          <small>{m.name.split(/\s+/)[0]}</small>
        </button>
      ))}
    </div>
  );
}

/** Menu chat → Anggota & giliran. Chat 1:1 bisa dijadikan grup dengan menambah karakter. */
export function MembersSheet({ chat, members, onClose }: { chat: Chat; members: Character[]; onClose: () => void }) {
  const group = isGroupChat(chat);
  const others = useLiveQuery(async () => {
    const ids = new Set(chat.memberIds ?? (chat.characterId ? [chat.characterId] : []));
    return (await db.characters.filter((c) => !c.deletedAt && !ids.has(c.id)).toArray()).sort((a, b) => a.name.localeCompare(b.name));
  }, [chat.memberIds, chat.characterId]);
  const [adding, setAdding] = useState(false);
  const [remove, setRemove] = useState<Character | null>(null);
  const muted = chat.muted ?? [];
  const set = async (patch: Partial<Chat>) => {
    await db.chats.update(chat.id, patch);
    markChanged();
  };
  const full = members.length >= MAX_MEMBERS;
  return (
    <>
      <Sheet open={!adding && !remove} onClose={onClose} title={group ? 'Anggota & giliran' : 'Anggota'}>
        {!group && <p className="note pad">Tambah karakter untuk menjadikan chat ini group chat. Pesan lama tetap ada.</p>}
        {members.map((m, i) => (
          <div key={m.id} className="rp-member-item">
            <Avatar blob={m.avatar} view={m.photo ?? m.avatar} name={m.name} size={36} />
            <span className="rp-member-name">
              <b>{m.name}</b>
              <small>{muted.includes(m.id) ? 'Dibisukan: tidak mendapat giliran otomatis' : i === 0 ? 'Anggota pertama' : ''}</small>
            </span>
            {group && (
              <>
                <button className="icon-btn small" aria-label={`${m.name} naik`} disabled={i === 0} onClick={() => void moveMember(chat.id, m.id, -1)}>
                  <IconUp size={16} />
                </button>
                <button className="icon-btn small" aria-label={`${m.name} turun`} disabled={i === members.length - 1} onClick={() => void moveMember(chat.id, m.id, 1)}>
                  <IconDown size={16} />
                </button>
                <button className={'btn btn-small' + (muted.includes(m.id) ? ' btn-primary' : '')} onClick={() => void toggleMute(chat.id, m.id)}>
                  {muted.includes(m.id) ? 'Bunyikan' : 'Bisukan'}
                </button>
                <button className="icon-btn small" aria-label={`Keluarkan ${m.name}`} onClick={() => setRemove(m)}>
                  <IconTrash size={16} />
                </button>
              </>
            )}
          </div>
        ))}
        <SheetItem icon={<IconPlus />} label="Tambah karakter" hint={full ? `Maksimal ${MAX_MEMBERS} karakter` : undefined} disabled={full} onClick={() => setAdding(true)} />
        {group && (
          <>
            <div className="style-group">
              <small>Giliran bicara</small>
              <div className="segmented sheet-seg">
                {(['auto', 'order', 'manual'] as const).map((k) => (
                  <button key={k} className={(chat.turnMode ?? 'auto') === k ? 'active' : ''} onClick={() => void set({ turnMode: k })}>
                    {TURN_LABEL[k]}
                  </button>
                ))}
              </div>
            </div>
            <p className="note pad">
              {(chat.turnMode ?? 'auto') === 'auto'
                ? 'Otomatis: karakter yang Anda sebut namanya, lalu yang disebut di balasan terakhir, lalu yang paling lama diam. Tanpa biaya tambahan.'
                : chat.turnMode === 'order'
                  ? 'Berurutan: bergiliran sesuai urutan anggota.'
                  : 'Manual: ketuk avatar di atas kolom ketik untuk memilih siapa yang menjawab.'}
            </p>
            <div className="style-group">
              <small>Balasan per giliran</small>
              <div className="segmented sheet-seg">
                {([1, 2, 3] as const).map((k) => (
                  <button key={k} className={(chat.chain ?? 1) === k ? 'active' : ''} disabled={chat.turnMode === 'manual' && k > 1} onClick={() => void set({ chain: k })}>
                    {k === 1 ? '1' : `hingga ${k}`}
                  </button>
                ))}
              </div>
            </div>
            <p className="note pad">Lebih dari 1: karakter lain ikut menanggapi berantai. Setiap balasan dihitung satu permintaan.</p>
          </>
        )}
      </Sheet>
      <Sheet open={adding} onClose={() => setAdding(false)} title="Tambah karakter">
        {(others ?? []).length === 0 && <p className="note pad">Tidak ada karakter lain. Buat karakter dulu di tab Roleplay.</p>}
        {(others ?? []).map((c) => (
          <SheetItem
            key={c.id}
            icon={<Avatar blob={c.avatar} name={c.name} size={28} />}
            label={c.name}
            hint={c.tags.join(', ')}
            onClick={async () => {
              try {
                await addMember(chat.id, c.id);
                toast(group ? `${c.name} bergabung` : `${c.name} bergabung. Chat ini sekarang group chat.`);
              } catch (e) {
                toast((e as Error).message);
              }
              setAdding(false);
            }}
          />
        ))}
      </Sheet>
      <ConfirmSheet
        open={!!remove}
        title={`Keluarkan ${remove?.name}?`}
        message="Pesan lamanya tetap ada dan tetap dibaca AI; kartunya tidak dikirim lagi."
        confirmLabel="Keluarkan"
        danger
        onClose={() => setRemove(null)}
        onConfirm={async () => {
          if (!remove) return;
          try {
            await removeMember(chat.id, remove.id);
          } catch (e) {
            toast((e as Error).message);
          }
        }}
      />
    </>
  );
}

/** Menu balasan → Tulis ulang sebagai… */
export function RewriteAsSheet({ members, current, onPick, onClose }: { members: Character[]; current: string | null; onPick: (id: string) => void; onClose: () => void }) {
  return (
    <Sheet open onClose={onClose} title="Tulis ulang sebagai">
      {members.map((m) => (
        <SheetItem
          key={m.id}
          icon={<Avatar blob={m.avatar} name={m.name} size={28} />}
          label={m.name + (m.id === current ? ' (sekarang)' : '')}
          hint={m.id === current ? 'Sama dengan Coba lagi' : 'Jadi versi baru'}
          onClick={() => {
            onClose();
            onPick(m.id);
          }}
        />
      ))}
    </Sheet>
  );
}
