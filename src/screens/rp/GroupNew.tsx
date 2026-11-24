import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../../db';
import { IconBack, IconCheck } from '../../components/Icons';
import { Avatar } from '../../components/rp/Avatar';
import { toast } from '../../components/ui';
import { goBack } from '../../lib/nav';
import { fillMacros } from '../../lib/rp/cards';
import { emptyPersona, listPersonas, savePersona } from '../../lib/rp/data';
import { startRpGroup } from '../../lib/rp/engine';
import { joinNames, MAX_MEMBERS } from '../../lib/rp/group';

/** Group chat baru: pilih 2–5 karakter (urutan pilihan = urutan anggota), persona, nama, dan pembuka. */
export default function GroupNew() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const chars = useLiveQuery(async () => (await db.characters.filter((c) => !c.deletedAt).toArray()).sort((a, b) => Math.max(b.usedAt, b.updatedAt) - Math.max(a.usedAt, a.updatedAt)), []);
  const personas = useLiveQuery(listPersonas, []);
  const [picked, setPicked] = useState<string[]>(() => (params.get('with') ? [params.get('with')!] : []));
  const [title, setTitle] = useState('');
  const [personaId, setPersonaId] = useState<string>('');
  const [newName, setNewName] = useState('');
  const [opener, setOpener] = useState<string>('auto');
  const [creating, setCreating] = useState(false);

  const byId = new Map((chars ?? []).map((c) => [c.id, c]));
  const members = picked.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => !!c);
  const userName = (personas ?? []).find((p) => p.id === personaId)?.name ?? (personas ?? []).find((p) => p.isDefault)?.name ?? (newName.trim() || 'Anda');
  // Pilihan pembuka: semua pembuka dari anggota terpilih.
  const openers = members.flatMap((c) => [c.firstMes, ...c.altGreetings].map((g, i) => ({ key: `${c.id}:${i}`, c, i, g })).filter((x) => x.g.trim()));
  const effOpener = opener === 'auto' ? (openers[0]?.key ?? 'none') : opener;

  const toggle = (id: string) =>
    setPicked((p) => {
      if (p.includes(id)) return p.filter((x) => x !== id);
      if (p.length >= MAX_MEMBERS) {
        toast(`Maksimal ${MAX_MEMBERS} karakter.`);
        return p;
      }
      return [...p, id];
    });

  const create = async () => {
    if (members.length < 2) {
      toast('Pilih minimal 2 karakter.');
      return;
    }
    let pid = personaId || null;
    if (!personas?.length) {
      if (!newName.trim()) {
        toast('Isi nama Anda di roleplay dulu.');
        return;
      }
      const p = { ...emptyPersona(newName.trim()), isDefault: true };
      await savePersona(p);
      pid = p.id;
    }
    setCreating(true);
    try {
      const [cid, gi] = effOpener === 'none' ? [null, 0] : [effOpener.split(':')[0], Number(effOpener.split(':')[1])];
      const chatId = await startRpGroup({ memberIds: picked, personaId: pid, title, opener: cid ? { characterId: cid, greeting: gi } : null });
      nav(`/rp/chat/${chatId}`, { replace: true });
    } catch (e) {
      toast((e as Error).message);
      setCreating(false);
    }
  };

  return (
    <div className="screen">
      <header className="page-header">
        <button className="icon-btn" aria-label="Kembali" onClick={() => goBack(nav)}>
          <IconBack />
        </button>
        <div className="chat-head-title">Group chat baru</div>
        <button className="btn btn-small btn-primary" disabled={members.length < 2 || creating} onClick={() => void create()}>
          Buat
        </button>
      </header>
      <div className="scroll-area settings">
        <h3>Karakter ({members.length}/{MAX_MEMBERS})</h3>
        <p className="note">Pilih 2–{MAX_MEMBERS} karakter. Urutan pilihan menjadi urutan anggota (dipakai mode giliran Berurutan).</p>
        {(chars ?? []).length < 2 && <p className="note">Butuh minimal 2 karakter. Buat karakter dulu di tab Roleplay.</p>}
        {(chars ?? []).map((c) => {
          const n = picked.indexOf(c.id);
          return (
            <button key={c.id} className={'rp-pick' + (n >= 0 ? ' on' : '')} aria-pressed={n >= 0} onClick={() => toggle(c.id)}>
              <Avatar blob={c.avatar} name={c.name} size={40} />
              <span className="rp-char-text">
                <span className="chat-title">{c.name}</span>
                <small>{c.tags.slice(0, 3).join(', ')}</small>
              </span>
              <span className="rp-pick-mark">{n >= 0 ? n + 1 : <IconCheck size={14} />}</span>
            </button>
          );
        })}

        <h3>Grup</h3>
        <div className="field">
          <span>Nama grup</span>
          <input className="input" value={title} placeholder={members.length ? joinNames(members.map((c) => c.name)) : 'mis. Band Senja'} onChange={(e) => setTitle(e.target.value)} />
        </div>
        {personas?.length ? (
          <div className="field">
            <span>Main sebagai</span>
            <select className="input" value={personaId} onChange={(e) => setPersonaId(e.target.value)}>
              <option value="">Persona bawaan</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="field">
            <span>Nama Anda di roleplay</span>
            <input className="input" value={newName} placeholder="mis. Dimas" onChange={(e) => setNewName(e.target.value)} />
          </div>
        )}
        <div className="field">
          <span>Pembuka</span>
          <select className="input" value={effOpener} onChange={(e) => setOpener(e.target.value)}>
            <option value="none">Tanpa pembuka (saya yang mulai)</option>
            {openers.map((o) => (
              <option key={o.key} value={o.key}>
                {o.c.name} · pembuka {o.i + 1}: {fillMacros(o.g, o.c.name, userName).replace(/\s+/g, ' ').slice(0, 60)}
              </option>
            ))}
          </select>
          <small>Bisa diganti ke pembuka lain dari karakter yang sama selama belum dibalas.</small>
        </div>
        <p className="note">Setelah dibuat, atur giliran bicara, balasan per giliran, dan skenario grup dari menu chat.</p>
      </div>
    </div>
  );
}
