import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { db, type Character } from '../../db';
import { IconBack, IconBook, IconChevron, IconChevronDown, IconClose, IconPlus, IconSparkle } from '../../components/Icons';
import { AvatarPicker } from '../../components/rp/AvatarPicker';
import { Sheet, SheetItem, Toggle, toast } from '../../components/ui';
import { goBack } from '../../lib/nav';
import { estimateTokens, usableModels } from '../../lib/providers';
import { CREATIVITY_LABEL, useSettings } from '../../lib/settings';
import { generateCard, improveField, translateCard } from '../../lib/rp/assist';
import { depthPrompt, withDepthPrompt } from '../../lib/rp/cards';
import { emptyCharacter, ensureOwnLorebook, listPersonas, ownLorebook, saveCharacter } from '../../lib/rp/data';
import { FIELD_ACTIONS } from '../../lib/rp/prompts';
import { UserError } from '../../lib/generate';
import { debounce } from '../../lib/util';

type TextField = 'description' | 'personality' | 'scenario' | 'firstMes' | 'mesExample' | 'systemPrompt' | 'postHistory' | 'creatorNotes';

/** Kartu kemungkinan bukan berbahasa Indonesia (untuk tawaran terjemahan setelah impor). */
function looksForeign(c: Character): boolean {
  const t = ` ${[c.description, c.firstMes, c.scenario].join(' ').toLowerCase()} `;
  const count = (words: string[]) => words.reduce((n, w) => n + (t.split(` ${w} `).length - 1), 0);
  return count(['the', 'and', 'you', 'is', 'with', 'her', 'his', 'to']) > count(['yang', 'dan', 'dengan', 'itu', 'tidak', 'ke', 'di']) + 3;
}

function errText(e: unknown): string {
  if (e instanceof UserError) return e.message;
  return (e as Error)?.message || String(e);
}

export default function CharacterEdit() {
  const { id = 'new' } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const isNew = id === 'new';
  const stored = useLiveQuery(async () => (isNew ? null : ((await db.characters.get(id)) ?? null)), [id]);
  const personas = useLiveQuery(listPersonas, []);
  const settings = useSettings();
  const usable = settings ? usableModels(settings.providers) : [];
  const worlds = useLiveQuery(async () => (await db.lorebooks.filter((b) => !b.characterId && !b.deletedAt).toArray()).sort((a, b) => a.name.localeCompare(b.name)), []);
  const [c, setC] = useState<Character | null>(null);
  const [prev, setPrev] = useState<Partial<Record<TextField, string>>>({});
  const [advanced, setAdvanced] = useState(false);
  const [aiOpen, setAiOpen] = useState(params.get('ai') === '1');
  const [idea, setIdea] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [live, setLive] = useState('');
  const [fieldMenu, setFieldMenu] = useState<TextField | null>(null);
  const [offerTranslate, setOfferTranslate] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const saved = useRef(false);
  const bookCount = useLiveQuery(async () => (c ? ((await ownLorebook(c.id))?.entries.length ?? 0) : 0), [c?.id]);

  // Muat sekali (perubahan berikutnya dari layar ini sendiri).
  useEffect(() => {
    if (c) return;
    if (isNew) setC(emptyCharacter());
    else if (stored) {
      setC(stored);
      saved.current = true;
      if (params.get('imported') === '1' && looksForeign(stored)) setOfferTranslate(true);
    }
  }, [isNew, stored]); // eslint-disable-line react-hooks/exhaustive-deps

  // Simpan otomatis begitu nama terisi.
  const save = useMemo(
    () =>
      debounce((x: Character) => {
        if (!x.name.trim()) return;
        void saveCharacter(x);
        if (!saved.current) {
          saved.current = true;
          nav(`/rp/c/${x.id}/edit`, { replace: true });
        }
      }, 500),
    [nav],
  );
  useEffect(() => () => save.flush(), [save]);
  const update = (patch: Partial<Character>) => {
    setC((x) => {
      if (!x) return x;
      const n = { ...x, ...patch };
      save(n);
      return n;
    });
  };

  if (stored === null && !isNew) {
    return (
      <div className="screen">
        <div className="empty">
          <h2>Karakter tidak ditemukan</h2>
        </div>
      </div>
    );
  }
  if (!c) return <div className="screen" />;

  const tokens = estimateTokens(
    [c.description, c.personality, c.scenario, c.mesExample, c.firstMes, c.systemPrompt, c.postHistory].reduce((n, t) => n + t.length, 0),
  );

  const runAi = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setLive('');
    try {
      await fn();
    } catch (e) {
      toast('Gagal: ' + errText(e));
    } finally {
      setBusy(null);
    }
  };

  const field = (key: TextField, label: string, hint: string, rows = 4, ai = true) => (
    <div className="field rp-field">
      <div className="rp-field-head">
        <span>{label}</span>
        {prev[key] !== undefined && (
          <button
            className="link-btn"
            onClick={() => {
              update({ [key]: prev[key] } as Partial<Character>);
              setPrev((p) => ({ ...p, [key]: undefined }));
            }}
          >
            Urungkan
          </button>
        )}
        {ai && (
          <button className="icon-btn small" aria-label={`Bantu AI: ${label}`} disabled={!!busy || photoBusy} onClick={() => setFieldMenu(key)}>
            <IconSparkle size={16} />
          </button>
        )}
      </div>
      <textarea className="input" rows={rows} value={c[key]} placeholder={hint} onChange={(e) => update({ [key]: e.target.value } as Partial<Character>)} />
    </div>
  );

  return (
    <div className="screen">
      <header className="page-header">
        <button className="icon-btn" aria-label="Kembali" onClick={() => { save.flush(); goBack(nav); }}>
          <IconBack />
        </button>
        <div className="chat-head-title">{isNew && !saved.current ? 'Karakter baru' : 'Edit karakter'}</div>
        <button
          className="btn btn-small btn-primary"
          onClick={() => {
            if (!c.name.trim()) {
              toast('Isi nama karakter dulu.');
              return;
            }
            save.flush();
            nav(`/rp/c/${c.id}`, { replace: true });
          }}
        >
          Selesai
        </button>
      </header>
      <div className="scroll-area settings">
        {offerTranslate && (
          <div className="composer-note">
            <span className="note-body">Kartu ini sepertinya bukan berbahasa Indonesia.</span>
            <button
              className="link-btn"
              disabled={!!busy || photoBusy}
              onClick={() => {
                setOfferTranslate(false);
                void runAi('Menerjemahkan…', async () => {
                  const t = await translateCard(c.id, c);
                  update(t);
                  toast('Diterjemahkan. Periksa hasilnya.');
                });
              }}
            >
              Terjemahkan
            </button>
            <button className="note-x" aria-label="Tutup" onClick={() => setOfferTranslate(false)}>
              <IconClose size={14} />
            </button>
          </div>
        )}
        {busy && (
          <div className="rp-busy">
            <span className="typing">
              <span />
              <span />
              <span />
            </span>
            {busy} {live ? `(${live.length} karakter)` : ''}
          </div>
        )}

        <div className="rp-edit-top">
          <AvatarPicker
            value={{ avatar: c.avatar, photo: c.photo, crop: c.crop }}
            name={c.name}
            size={84}
            onBusy={setPhotoBusy}
            onChange={(v) => update({ avatar: v.avatar, photo: v.photo ?? null, crop: v.crop ?? null })}
          />
          <div className="field rp-name">
            <span>Nama*</span>
            <input className="input" value={c.name} placeholder="Nama karakter" onChange={(e) => update({ name: e.target.value })} />
          </div>
        </div>
        <div className="row-buttons left">
          <button className="btn btn-small" disabled={!!busy || photoBusy} onClick={() => setAiOpen(true)}>
            <IconSparkle size={14} /> Buat dengan AI
          </button>
          {saved.current && (
            <button
              className="btn btn-small"
              disabled={!!busy || photoBusy}
              onClick={() =>
                void runAi('Menerjemahkan…', async () => {
                  update(await translateCard(c.id, c));
                  toast('Diterjemahkan. Periksa hasilnya.');
                })
              }
            >
              Terjemahkan ke bahasa Indonesia
            </button>
          )}
        </div>

        <div className="field">
          <span>Tag</span>
          <input
            className="input"
            value={c.tags.join(', ')}
            placeholder="mis. romansa, sekolah, fantasi"
            onChange={(e) => update({ tags: e.target.value.split(',').map((t) => t.trim()).filter((t, i, a) => t && a.indexOf(t) === i) })}
          />
        </div>
        {field('description', 'Deskripsi', 'Siapa dia: penampilan, latar, sifat, kebiasaan, cara bicara.', 7)}
        {field('personality', 'Kepribadian', 'Ringkasan sifat, mis. sinis tapi peduli, gengsian, setia.', 2)}
        {field('scenario', 'Skenario', 'Situasi dan hubungan dengan {{user}} di awal roleplay.', 3)}
        {field('firstMes', 'Pesan pembuka', 'Balasan pertama {{char}}. Narasi orang ketiga, dialog dalam tanda kutip.', 6)}

        <div className="field">
          <span>Pembuka alternatif</span>
          {c.altGreetings.map((g, i) => (
            <div key={i} className="rp-alt">
              <textarea
                className="input"
                rows={3}
                value={g}
                onChange={(e) => update({ altGreetings: c.altGreetings.map((x, j) => (j === i ? e.target.value : x)) })}
              />
              <button className="icon-btn small" aria-label={`Hapus pembuka ${i + 2}`} onClick={() => update({ altGreetings: c.altGreetings.filter((_, j) => j !== i) })}>
                <IconClose size={16} />
              </button>
            </div>
          ))}
          <button className="link-btn left" onClick={() => update({ altGreetings: [...c.altGreetings, ''] })}>
            <IconPlus size={14} /> Tambah pembuka
          </button>
        </div>

        {field('mesExample', 'Contoh dialog', '<START>\n{{user}}: Hai.\n{{char}}: *melirik sebentar* "Hm."', 5)}

        <button className="rp-adv-toggle" onClick={() => setAdvanced((v) => !v)}>
          Lanjutan <IconChevronDown size={16} className={advanced ? 'rot180' : ''} />
        </button>
        {advanced && (
          <>
            {field('systemPrompt', 'Instruksi sistem khusus', 'Ditambahkan di bawah instruksi roleplay aplikasi (tidak menggantikannya). Boleh dikosongkan.', 4, false)}
            {field('postHistory', 'Pengingat aturan karakter', 'Dikirim di akhir setiap permintaan, mis. "{{char}} selalu menjawab singkat."', 3, false)}
            <div className="field rp-field">
              <span>Catatan karakter (depth prompt)</span>
              <textarea
                className="input"
                rows={3}
                value={depthPrompt(c)}
                placeholder="Dari kartu SillyTavern. Dikirim di akhir setiap permintaan, bersama pengingat aturan."
                onChange={(e) => setC((x) => {
                  if (!x) return x;
                  const n = withDepthPrompt(x, e.target.value);
                  save(n);
                  return n;
                })}
              />
            </div>
            {field('creatorNotes', 'Catatan pembuat', 'Tidak dikirim ke AI.', 3, false)}
            <div className="field">
              <span>Model bawaan karakter</span>
              <select
                className="input"
                value={c.modelRef ? `${c.modelRef.provider}::${c.modelRef.model}` : ''}
                onChange={(e) => {
                  const [provider, model] = e.target.value.split('::');
                  update({ modelRef: e.target.value ? { provider, model } : null });
                }}
              >
                <option value="">Ikuti pengaturan</option>
                {usable.map((u) => (
                  <option key={`${u.provider.id}::${u.model.id}`} value={`${u.provider.id}::${u.model.id}`}>
                    {u.provider.name} · {u.model.label}
                  </option>
                ))}
              </select>
              <small>Dipakai di chat baru dengan karakter ini, sampai Anda memilih model lain di chat.</small>
            </div>
            <div className="field">
              <span>Kreativitas</span>
              <select className="input" value={c.creativity ?? ''} onChange={(e) => update({ creativity: (e.target.value || null) as Character['creativity'] })}>
                <option value="">Ikuti pengaturan</option>
                {(['stable', 'normal', 'wild'] as const).map((k) => (
                  <option key={k} value={k}>
                    {CREATIVITY_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <span>Persona yang diikat</span>
              <select className="input" value={c.personaId ?? ''} onChange={(e) => update({ personaId: e.target.value || null })}>
                <option value="">Persona bawaan</option>
                {(personas ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <span>Lorebook dunia yang dipasang</span>
              {(worlds ?? []).length === 0 && <small>Belum ada. Buat di Roleplay → Lorebook dunia.</small>}
              {(worlds ?? []).map((b) => (
                <div key={b.id} className="field-row">
                  <span>
                    {b.name}
                    <small>{b.entries.length} entri</small>
                  </span>
                  <Toggle
                    checked={c.worldIds.includes(b.id)}
                    label={b.name}
                    onChange={(on) => update({ worldIds: on ? [...c.worldIds, b.id] : c.worldIds.filter((w) => w !== b.id) })}
                  />
                </div>
              ))}
            </div>
          </>
        )}

        <button
          className="settings-link rp-link"
          disabled={!c.name.trim()}
          onClick={async () => {
            save.flush();
            await saveCharacter(c);
            saved.current = true;
            const b = await ensureOwnLorebook(c);
            nav(`/rp/lore/${b.id}`);
          }}
        >
          <IconBook size={18} /> Lorebook karakter{bookCount ? ` (${bookCount} entri)` : ''} <IconChevron size={16} />
        </button>
        <p className="note">
          Kartu ±{tokens.toLocaleString('id-ID')} token dikirim di setiap permintaan (kena cache).
          {tokens > 3000 ? ' Kartu ini cukup besar; pertimbangkan meringkas deskripsi.' : ''} Penanda {'{{char}}'} dan {'{{user}}'} diganti nama
          karakter dan persona.
        </p>
      </div>

      <Sheet open={aiOpen && !busy} onClose={() => { setAiOpen(false); if (params.get('ai')) { params.delete('ai'); setParams(params, { replace: true }); } }} title="Buat karakter dengan AI">
        <p className="note pad">Tulis ide singkat. AI mengisi semua kolom, lalu Anda periksa dan ubah. Kolom yang sudah terisi akan diganti.</p>
        <div className="form-pad">
          <textarea
            className="input"
            rows={4}
            autoFocus
            value={idea}
            placeholder="mis. gitaris band SMA yang sinis tapi peduli, latar Bandung 2005, diam-diam menulis lagu untuk {{user}}"
            onChange={(e) => setIdea(e.target.value)}
          />
        </div>
        <div className="row-buttons pad">
          <button
            className="btn btn-primary"
            disabled={!idea.trim()}
            onClick={() => {
              setAiOpen(false);
              void runAi('AI sedang membuat karakter…', async () => {
                const r = await generateCard(c.id, idea, setLive);
                update({ ...r, name: r.name || c.name });
                toast('Karakter dibuat. Periksa dan ubah kalau perlu.');
              });
            }}
          >
            <IconSparkle size={16} /> Buat
          </button>
        </div>
      </Sheet>

      <Sheet open={!!fieldMenu} onClose={() => setFieldMenu(null)} title="Bantu AI">
        {(['expand', 'shorten', 'improve'] as (keyof typeof FIELD_ACTIONS)[]).map((a) => (
          <SheetItem
            key={a}
            icon={<IconSparkle />}
            label={a === 'expand' ? 'Kembangkan' : a === 'shorten' ? 'Persingkat' : 'Perbaiki'}
            hint={a === 'expand' ? 'Tambah detail yang konkret' : a === 'shorten' ? 'Kira-kira setengahnya' : 'Lebih jelas, panjang sama'}
            disabled={!fieldMenu || (!c[fieldMenu].trim() && a !== 'expand')}
            onClick={() => {
              const key = fieldMenu!;
              setFieldMenu(null);
              void runAi('AI sedang menulis…', async () => {
                const old = c[key];
                const r = await improveField(c.id, key, old, a, c);
                if (!r.trim()) return;
                setPrev((p) => ({ ...p, [key]: old }));
                update({ [key]: r } as Partial<Character>);
              });
            }}
          />
        ))}
      </Sheet>
    </div>
  );
}
