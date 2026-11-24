import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, type Persona } from '../../db';
import { useSettings } from '../../lib/settings';
import { formatRupiah } from '../../lib/util';
import { IconBack, IconPlus, IconSparkle } from '../../components/Icons';
import { AvatarPicker } from '../../components/rp/AvatarPicker';
import { Avatar } from '../../components/rp/Avatar';
import { ConfirmSheet, Sheet, Toggle, toast } from '../../components/ui';
import { goBack } from '../../lib/nav';
import { generatePersona, improveField } from '../../lib/rp/assist';
import { emptyPersona, listPersonas, savePersona, trashPersona } from '../../lib/rp/data';

export default function Personas() {
  const nav = useNavigate();
  const list = useLiveQuery(listPersonas, []);
  const [edit, setEdit] = useState<Persona | null>(null);
  const settings = useSettings();
  const aiCost = useLiveQuery(async () => (await db.usage.where('rootId').equals('persona').toArray()).reduce((n, u) => n + u.costUsd, 0), []);
  return (
    <div className="screen">
      <header className="page-header">
        <button className="icon-btn" aria-label="Kembali" onClick={() => goBack(nav)}>
          <IconBack />
        </button>
        <div className="chat-head-title">Persona saya</div>
        <button className="icon-btn" aria-label="Persona baru" onClick={() => setEdit(emptyPersona())}>
          <IconPlus />
        </button>
      </header>
      <div className="scroll-area">
        <p className="note pad">Persona = siapa Anda di roleplay. Namanya menggantikan {'{{user}}'}, deskripsinya dibaca AI. Persona bawaan dipakai di chat baru.</p>
        {list?.length === 0 && (
          <div className="empty">
            <p>Belum ada persona.</p>
            <button className="btn" onClick={() => setEdit(emptyPersona())}>
              <IconPlus size={16} /> Buat persona
            </button>
          </div>
        )}
        <ul className="chat-list">
          {list?.map((p) => (
            <li key={p.id} className="chat-row">
              <button className="chat-main pressable rp-char-main" onClick={() => setEdit(p)}>
                <Avatar blob={p.avatar} name={p.name} size={44} />
                <span className="rp-char-text">
                  <span className="chat-title">{p.name}</span>
                  <small>{[p.isDefault ? 'Bawaan' : '', p.description.trim().slice(0, 80)].filter(Boolean).join(' · ') || 'Tanpa deskripsi'}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {!!aiCost && settings && <p className="note pad">Biaya bantuan AI untuk persona: {formatRupiah(aiCost * settings.usdToIdr)}</p>}
      </div>
      {edit && <PersonaEditor initial={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

export function PersonaEditor({ initial, onClose, onSaved }: { initial: Persona; onClose: () => void; onSaved?: (p: Persona) => void }) {
  const [p, setP] = useState(initial);
  const [idea, setIdea] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const exists = !!useLiveQuery(async () => (await listPersonas()).some((x) => x.id === initial.id), [initial.id]);
  const ai = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast('Gagal: ' + ((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Sheet open={!confirm} onClose={onClose} title={exists ? 'Edit persona' : 'Persona baru'}>
        <div className="form-pad">
          <div className="rp-edit-top">
            <AvatarPicker
              value={{ avatar: p.avatar, photo: p.photo, crop: p.crop }}
              name={p.name}
              size={64}
              onBusy={setPhotoBusy}
              onChange={(v) => setP({ ...p, avatar: v.avatar, photo: v.photo ?? null, crop: v.crop ?? null })}
            />
            <div className="field rp-name">
              <span>Nama*</span>
              <input className="input" value={p.name} placeholder="Nama Anda di roleplay" onChange={(e) => setP({ ...p, name: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <span className="rp-field-head">
              <span>Deskripsi</span>
              <button
                className="icon-btn small"
                aria-label="Kembangkan deskripsi dengan AI"
                disabled={busy || !p.description.trim()}
                onClick={() => void ai(async () => setP({ ...p, description: await improveField('persona', 'persona', p.description, 'expand', { name: p.name }) }))}
              >
                <IconSparkle size={16} />
              </button>
            </span>
            <textarea
              className="input"
              rows={5}
              value={p.description}
              placeholder="Penampilan, sifat, latar, hal yang perlu diketahui karakter."
              onChange={(e) => setP({ ...p, description: e.target.value })}
            />
          </div>
          <div className="field">
            <span>Buat dengan AI</span>
            <div className="key-row">
              <input className="input" value={idea} placeholder="mis. mahasiswa musik pemalu dari Yogya" onChange={(e) => setIdea(e.target.value)} />
              <button
                className="btn btn-small"
                disabled={busy || !idea.trim()}
                onClick={() =>
                  void ai(async () => {
                    const r = await generatePersona(idea);
                    setP({ ...p, name: p.name.trim() || r.name, description: r.description });
                  })
                }
              >
                {busy ? '…' : <IconSparkle size={16} />}
              </button>
            </div>
          </div>
          <div className="field-row">
            <span>Jadikan persona bawaan</span>
            <Toggle checked={p.isDefault} onChange={(v) => setP({ ...p, isDefault: v })} label="Persona bawaan" />
          </div>
        </div>
        <div className="row-buttons pad">
          {exists && (
            <button className="btn btn-danger" onClick={() => setConfirm(true)}>
              Hapus
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Batal
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || photoBusy}
            onClick={async () => {
              if (!p.name.trim()) {
                toast('Isi nama persona dulu.');
                return;
              }
              await savePersona({ ...p, name: p.name.trim() });
              onSaved?.(p);
              toast('Persona disimpan');
              onClose();
            }}
          >
            Simpan
          </button>
        </div>
      </Sheet>
      <ConfirmSheet
        open={confirm}
        title="Hapus persona?"
        message={`${p.name} dipindah ke Sampah. Chat yang memakainya tetap ada.`}
        confirmLabel="Hapus"
        danger
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          await trashPersona(p.id);
          toast('Dipindah ke Sampah');
          onClose();
        }}
      />
    </>
  );
}
