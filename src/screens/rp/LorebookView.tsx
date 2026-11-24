import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db, type LoreEntry, type LoreLogic, type Lorebook } from '../../db';
import { IconBack, IconBook, IconChevron, IconMore, IconPlus, IconTrash } from '../../components/Icons';
import { ConfirmSheet, PromptSheet, Sheet, SheetItem, Toggle, toast } from '../../components/ui';
import { goBack } from '../../lib/nav';
import { estimateTokens } from '../../lib/providers';
import { emptyLorebook, saveLorebook, trashLorebook } from '../../lib/rp/data';
import { uid } from '../../lib/util';

/** Daftar lorebook dunia (dipakai bersama beberapa karakter). */
export function WorldLorebooks() {
  const nav = useNavigate();
  const books = useLiveQuery(async () => (await db.lorebooks.filter((b) => !b.characterId && !b.deletedAt).toArray()).sort((a, b) => a.name.localeCompare(b.name)), []);
  const usedBy = useLiveQuery(async () => {
    const m = new Map<string, number>();
    for (const c of await db.characters.filter((x) => !x.deletedAt).toArray()) for (const w of c.worldIds) m.set(w, (m.get(w) ?? 0) + 1);
    return m;
  }, []);
  const [naming, setNaming] = useState(false);
  return (
    <div className="screen">
      <header className="page-header">
        <button className="icon-btn" aria-label="Kembali" onClick={() => goBack(nav)}>
          <IconBack />
        </button>
        <div className="chat-head-title">Lorebook dunia</div>
        <button className="icon-btn" aria-label="Lorebook baru" onClick={() => setNaming(true)}>
          <IconPlus />
        </button>
      </header>
      <div className="scroll-area">
        <p className="note pad">Lorebook dunia bisa dipasang ke beberapa karakter (Edit karakter → Lanjutan), mis. satu dunia fantasi untuk banyak karakter.</p>
        {books?.length === 0 && (
          <div className="empty">
            <p>Belum ada lorebook dunia.</p>
            <button className="btn" onClick={() => setNaming(true)}>
              <IconPlus size={16} /> Lorebook baru
            </button>
          </div>
        )}
        <ul className="chat-list">
          {books?.map((b) => (
            <li key={b.id} className="chat-row">
              <button className="chat-main pressable" onClick={() => nav(`/rp/lore/${b.id}`)}>
                <span className="chat-title">
                  <IconBook size={16} /> {b.name}
                </span>
                <small>
                  {b.entries.length} entri · dipasang di {usedBy?.get(b.id) ?? 0} karakter
                </small>
              </button>
              <IconChevron size={18} />
            </li>
          ))}
        </ul>
      </div>
      <PromptSheet
        open={naming}
        title="Nama lorebook"
        initial=""
        placeholder="mis. Kota Arunika"
        onClose={() => setNaming(false)}
        onSubmit={async (v) => {
          if (!v.trim()) return;
          const b = emptyLorebook(null, v.trim());
          await saveLorebook(b);
          nav(`/rp/lore/${b.id}`);
        }}
      />
    </div>
  );
}

export default function LorebookView() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const book = useLiveQuery(() => db.lorebooks.get(id), [id]);
  const owner = useLiveQuery(async () => (book?.characterId ? db.characters.get(book.characterId) : undefined), [book?.characterId]);
  const [entry, setEntry] = useState<LoreEntry | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [rename, setRename] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  if (book === undefined) return <div className="screen" />;
  if (!book || book.deletedAt) {
    return (
      <div className="screen">
        <div className="empty">
          <h2>Lorebook tidak ditemukan</h2>
        </div>
      </div>
    );
  }
  const set = (patch: Partial<Lorebook>) => void saveLorebook({ ...book, ...patch });
  const entries = [...book.entries].sort((a, b) => Number(b.constant) - Number(a.constant) || b.priority - a.priority || a.title.localeCompare(b.title));
  return (
    <div className="screen">
      <header className="page-header">
        <button className="icon-btn" aria-label="Kembali" onClick={() => goBack(nav)}>
          <IconBack />
        </button>
        <div className="chat-head-title">{owner ? `Lorebook ${owner.name}` : book.name}</div>
        <button className="icon-btn" aria-label="Menu lorebook" onClick={() => setMenuOpen(true)}>
          <IconMore />
        </button>
      </header>
      <div className="scroll-area settings">
        <p className="note">
          Entri dikirim ke AI kalau salah satu kata kuncinya muncul di pesan terakhir. Entri "selalu dikirim" ikut di setiap permintaan.
          {owner ? ' Lorebook ini ikut kartu saat diekspor.' : ''}
        </p>
        <div className="field-row">
          <span>
            Jangkauan pindai
            <small>Jumlah pesan terakhir yang diperiksa kata kuncinya</small>
          </span>
          <input className="input num" type="number" min={1} max={20} value={book.scanDepth} onChange={(e) => set({ scanDepth: Math.max(1, Math.min(20, Number(e.target.value) || 4)) })} />
        </div>
        <div className="field-row">
          <span>
            Batas token
            <small>Entri yang cocok dikirim sampai batas ini, urut prioritas</small>
          </span>
          <input className="input num" type="number" min={100} max={8000} step={100} value={book.tokenBudget} onChange={(e) => set({ tokenBudget: Math.max(100, Math.min(8000, Number(e.target.value) || 1500)) })} />
        </div>
        <h3>Entri ({book.entries.length})</h3>
        {entries.map((e) => (
          <button key={e.id} className={'lore-row' + (e.enabled ? '' : ' off')} onClick={() => setEntry(e)}>
            <b>
              {e.constant ? '📌 ' : ''}
              {e.title || '(tanpa judul)'}
            </b>
            <small>
              {e.constant ? 'Selalu dikirim' : e.keys.join(', ') || 'belum ada kata kunci'}
              {e.secondaryKeys?.length ? ` + ${e.secondaryKeys.join(', ')}` : ''} · ±{estimateTokens(e.content.length)} token{e.enabled ? '' : ' · nonaktif'}
            </small>
          </button>
        ))}
        <button className="btn rp-add-entry" onClick={() => setEntry({ id: uid(), title: '', keys: [], content: '', enabled: true, constant: false, priority: 100 })}>
          <IconPlus size={16} /> Entri baru
        </button>
      </div>
      {entry && (
        <EntryEditor
          entry={entry}
          isNew={!book.entries.some((e) => e.id === entry.id)}
          onClose={() => setEntry(null)}
          onSave={(e) => {
            const exists = book.entries.some((x) => x.id === e.id);
            set({ entries: exists ? book.entries.map((x) => (x.id === e.id ? e : x)) : [...book.entries, e] });
          }}
          onDelete={(eid) => set({ entries: book.entries.filter((x) => x.id !== eid) })}
        />
      )}
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={book.name}>
        <SheetItem icon={<IconBook />} label="Ganti nama" onClick={() => { setMenuOpen(false); setRename(true); }} />
        {!owner && <SheetItem icon={<IconTrash />} label="Hapus lorebook" danger onClick={() => { setMenuOpen(false); setConfirmDel(true); }} />}
      </Sheet>
      <PromptSheet open={rename} title="Nama lorebook" initial={book.name} onClose={() => setRename(false)} onSubmit={(v) => v.trim() && set({ name: v.trim() })} />
      <ConfirmSheet
        open={confirmDel}
        title="Hapus lorebook?"
        message={`${book.name} dipindah ke Sampah dan tidak dipakai lagi oleh karakter mana pun.`}
        confirmLabel="Hapus"
        danger
        onClose={() => setConfirmDel(false)}
        onConfirm={async () => {
          await trashLorebook(book.id);
          toast('Dipindah ke Sampah');
          goBack(nav);
        }}
      />
    </div>
  );
}

function EntryEditor({
  entry,
  isNew,
  onClose,
  onSave,
  onDelete,
}: {
  entry: LoreEntry;
  isNew: boolean;
  onClose: () => void;
  onSave: (e: LoreEntry) => void;
  onDelete: (id: string) => void;
}) {
  const [e, setE] = useState(entry);
  const [keys, setKeys] = useState(entry.keys.join(', '));
  const [sec, setSec] = useState((entry.secondaryKeys ?? []).join(', '));
  useEffect(() => {
    setE(entry);
    setKeys(entry.keys.join(', '));
    setSec((entry.secondaryKeys ?? []).join(', '));
  }, [entry]);
  return (
    <Sheet open onClose={onClose} title={isNew ? 'Entri baru' : 'Edit entri'}>
      <div className="form-pad">
        <div className="field">
          <span>Judul</span>
          <input className="input" value={e.title} placeholder="mis. Kafe Senja" onChange={(x) => setE({ ...e, title: x.target.value })} />
        </div>
        <div className="field">
          <span>Kata kunci</span>
          <input className="input" value={keys} placeholder="dipisah koma, mis. kafe senja, senja, kafe" onChange={(x) => setKeys(x.target.value)} />
          <small>Kata utuh. Pola regex: /pola/</small>
        </div>
        <div className="field">
          <span>Kata kunci kedua (opsional)</span>
          <input className="input" value={sec} placeholder="dipisah koma, mis. malam, hujan" onChange={(x) => setSec(x.target.value)} />
          {sec.trim() && (
            <select className="input" value={e.logic ?? 'and_any'} onChange={(x) => setE({ ...e, logic: x.target.value as LoreLogic })}>
              <option value="and_any">Dan salah satu kata kunci kedua muncul</option>
              <option value="and_all">Dan semua kata kunci kedua muncul</option>
              <option value="not_any">Dan tidak ada kata kunci kedua yang muncul</option>
              <option value="not_all">Dan tidak semua kata kunci kedua muncul</option>
            </select>
          )}
        </div>
        <div className="field-row">
          <span>Bedakan huruf besar/kecil</span>
          <Toggle checked={!!e.caseSensitive} onChange={(v) => setE({ ...e, caseSensitive: v })} label="Bedakan huruf besar/kecil" />
        </div>
        <div className="field">
          <span>Isi</span>
          <textarea className="input" rows={6} value={e.content} placeholder="Fakta yang dikirim ke AI saat kata kunci muncul." onChange={(x) => setE({ ...e, content: x.target.value })} />
          <small>±{estimateTokens(e.content.length)} token</small>
        </div>
        <div className="field-row">
          <span>
            Selalu dikirim
            <small>Tanpa kata kunci, ikut di setiap permintaan</small>
          </span>
          <Toggle checked={e.constant} onChange={(v) => setE({ ...e, constant: v })} label="Selalu dikirim" />
        </div>
        <div className="field-row">
          <span>Aktif</span>
          <Toggle checked={e.enabled} onChange={(v) => setE({ ...e, enabled: v })} label="Aktif" />
        </div>
        <div className="field-row">
          <span>
            Prioritas
            <small>Makin besar makin didahulukan saat batas token tercapai</small>
          </span>
          <input className="input num" type="number" value={e.priority} onChange={(x) => setE({ ...e, priority: Number(x.target.value) || 0 })} />
        </div>
      </div>
      <div className="row-buttons pad">
        {!isNew && (
          <button
            className="btn btn-danger"
            onClick={() => {
              onDelete(e.id);
              onClose();
            }}
          >
            Hapus
          </button>
        )}
        <button className="btn" onClick={onClose}>
          Batal
        </button>
        <button
          className="btn btn-primary"
          disabled={!e.content.trim()}
          onClick={() => {
            const k = keys.split(',').map((x) => x.trim()).filter(Boolean);
            if (!e.constant && !k.length) {
              toast('Isi kata kunci, atau nyalakan "Selalu dikirim".');
              return;
            }
            const k2 = sec.split(',').map((x) => x.trim()).filter(Boolean);
            onSave({ ...e, keys: k, secondaryKeys: k2.length ? k2 : undefined, logic: k2.length ? (e.logic ?? 'and_any') : undefined, title: e.title.trim() || k[0] || 'Entri' });
            onClose();
          }}
        >
          Simpan
        </button>
      </div>
    </Sheet>
  );
}
