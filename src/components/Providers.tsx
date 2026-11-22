import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { testProvider } from '../lib/api';
import { formatPrice } from '../lib/pricing';
import {
  defaultThinkingStyle,
  isValidBaseUrl,
  newCustomProvider,
  PROVIDER_INFO,
  usableModels,
  type ModelConfig,
  type ModelRef,
  type ProviderConfig,
  type ThinkingStyle,
} from '../lib/providers';
import { updateSettings, useSettings } from '../lib/settings';
import { uid } from '../lib/util';
import { IconCheck, IconChevron, IconPlus, IconSettings } from './Icons';
import { ConfirmSheet, Sheet, SheetItem, Toggle, toast } from './ui';

/* ---------- Pilih model (di chat) ---------- */

export function ModelPicker({
  open,
  onClose,
  value,
  onPick,
  thinking,
  onThinking,
  peak,
  contextTokens = 0,
}: {
  open: boolean;
  onClose: () => void;
  value: ModelRef;
  onPick: (ref: ModelRef) => void;
  /** kalau diisi, saklar mode berpikir tampil di atas daftar */
  thinking?: boolean;
  onThinking?: (v: boolean) => void;
  peak?: boolean;
  /** perkiraan ukuran konteks cerita (token); 0 = tidak ditampilkan */
  contextTokens?: number;
}) {
  const s = useSettings();
  const nav = useNavigate();
  const list = s ? usableModels(s.providers) : [];
  const groups = new Map<string, typeof list>();
  for (const it of list) {
    const g = groups.get(it.provider.id) ?? [];
    g.push(it);
    groups.set(it.provider.id, g);
  }
  return (
    <Sheet open={open} onClose={onClose} title="Model">
      {onThinking && (
        <div className="sheet-toggle">
          <span>
            Mode berpikir
            <small>AI berpikir dulu sebelum menulis. Lebih lambat, token berpikir ikut ditagih.</small>
          </span>
          <Toggle checked={!!thinking} onChange={onThinking} label="Mode berpikir" />
        </div>
      )}
      {peak && <p className="note pad warn-text">Sekarang jam peak DeepSeek: harga DeepSeek 2×.</p>}
      {contextTokens > 0 && (
        <p className="note pad">Perkiraan konteks cerita ini: ±{kTok(contextTokens)} token per permintaan.</p>
      )}
      {list.length === 0 && <p className="note pad">Belum ada penyedia dengan API key. Isi dulu di Pengaturan.</p>}
      {[...groups.values()].map((items) => (
        <div key={items[0].provider.id}>
          <div className="sheet-group">{items[0].provider.name}</div>
          {items.map(({ provider, model }) => {
            const active = value.provider === provider.id && value.model === model.id;
            const tooSmall = !!model.context && contextTokens > model.context * 0.85;
            return (
              <SheetItem
                key={model.id}
                icon={active ? <IconCheck /> : <span />}
                label={model.label}
                hint={[
                  model.id,
                  model.vision ? 'bisa baca gambar' : 'teks saja',
                  model.context ? `konteks ${kTok(model.context)}` : '',
                  tooSmall ? '⚠ terlalu kecil untuk cerita ini' : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
                onClick={() => {
                  onPick({ provider: provider.id, model: model.id });
                  onClose();
                }}
              />
            );
          })}
        </div>
      ))}
      <SheetItem
        icon={<IconSettings />}
        label="Atur penyedia & model"
        onClick={() => {
          onClose();
          nav('/settings#penyedia');
        }}
      />
    </Sheet>
  );
}

function kTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} juta`;
  return `${Math.max(1, Math.round(n / 1000)).toLocaleString('id-ID')} ribu`;
}

/* ---------- Daftar penyedia (di Pengaturan) ---------- */

export function ProviderList() {
  const s = useSettings();
  const [editing, setEditing] = useState<ProviderConfig | null>(null);
  const [picker, setPicker] = useState(false);
  if (!s) return null;
  const def = s.providers.find((p) => p.id === s.defaultModel.provider)?.models.find((m) => m.id === s.defaultModel.model);
  const defProvider = s.providers.find((p) => p.id === s.defaultModel.provider);

  return (
    <>
      {s.providers.map((p) => (
        <button key={p.id} className="provider-row" onClick={() => setEditing(p)}>
          <span className="provider-text">
            <b>{p.name}</b>
            <small>
              {p.apiKey.trim() ? 'API key terisi' : 'Belum ada API key'} · {p.models.length} model
            </small>
          </span>
          <span className={'dot' + (p.apiKey.trim() ? ' on' : '')} />
          <IconChevron size={18} />
        </button>
      ))}
      <button className="provider-row add" onClick={() => setEditing(newCustomProvider(uid()))}>
        <IconPlus size={18} /> Tambah penyedia lain (format OpenAI)
      </button>

      <div className="field-row">
        <span>
          Model default
          <small>{def && defProvider ? `${defProvider.name} · ${def.label}` : 'Belum dipilih'}</small>
        </span>
        <button className="btn btn-small" onClick={() => setPicker(true)}>
          Ganti
        </button>
      </div>

      {editing && (
        <ProviderEditor
          key={editing.id}
          initial={editing}
          isNew={!s.providers.some((p) => p.id === editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
      <ModelPicker
        open={picker}
        onClose={() => setPicker(false)}
        value={s.defaultModel}
        onPick={(ref) => void updateSettings({ defaultModel: ref })}
      />
    </>
  );
}

function DecimalField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  const [v, setV] = useState(value ? String(value) : '');
  return (
    <label className="field-row">
      <span>{label}</span>
      <input
        className="input num"
        inputMode="decimal"
        placeholder="0"
        value={v}
        onChange={(e) => setV(e.target.value.replace(/[^\d.,]/g, ''))}
        onBlur={() => {
          const n = parseFloat(v.replace(',', '.')) || 0;
          setV(n ? String(n) : '');
          onChange(n);
        }}
      />
    </label>
  );
}

const THINKING_LABEL: Record<ThinkingStyle, string> = {
  deepseek: 'DeepSeek',
  poolside: 'Poolside',
  openrouter: 'OpenRouter',
  none: 'Tidak dikirim',
};

function ModelEditor({
  initial,
  onSave,
  onDelete,
  onClose,
}: {
  initial: ModelConfig;
  onSave: (m: ModelConfig) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [m, setM] = useState(initial);
  const set = (patch: Partial<ModelConfig>) => setM((x) => ({ ...x, ...patch }));
  return (
    <Sheet open onClose={onClose} title={initial.id ? 'Edit model' : 'Tambah model'}>
      <div className="form-pad">
        <label className="field">
          <span>Model id</span>
          <input className="input" value={m.id} placeholder="mis. deepseek/deepseek-v4.1-flash" onChange={(e) => set({ id: e.target.value.trim() })} />
          <small>Persis seperti di daftar model penyedia.</small>
        </label>
        <label className="field">
          <span>Nama tampilan</span>
          <input className="input" value={m.label} placeholder="mis. DeepSeek Flash" onChange={(e) => set({ label: e.target.value })} />
        </label>
        <div className="field-row">
          <span>
            Bisa membaca gambar
            <small>Kalau mati, lampiran gambar dilewati.</small>
          </span>
          <Toggle checked={m.vision} onChange={(v) => set({ vision: v })} label="Bisa membaca gambar" />
        </div>
        <div className="field">
          <span>Cara mengatur mode berpikir</span>
          <div className="segmented wrap">
            {(Object.keys(THINKING_LABEL) as ThinkingStyle[]).map((t) => (
              <button key={t} className={m.thinking === t ? 'active' : ''} onClick={() => set({ thinking: t })}>
                {THINKING_LABEL[t]}
              </button>
            ))}
          </div>
          <small>Kalau penyedia menolak permintaan (error 400), coba pilih "Tidak dikirim".</small>
        </div>
        <div className="field">
          <span>Harga per 1 juta token (untuk menghitung biaya)</span>
          <div className="segmented">
            {(['USD', 'IDR'] as const).map((c) => (
              <button key={c} className={m.currency === c ? 'active' : ''} onClick={() => set({ currency: c })}>
                {c === 'USD' ? 'Dolar (USD)' : 'Rupiah'}
              </button>
            ))}
          </div>
        </div>
        <DecimalField label="Input" value={m.price.in} onChange={(n) => set({ price: { ...m.price, in: n } })} />
        <DecimalField label="Input dari cache" value={m.price.cache} onChange={(n) => set({ price: { ...m.price, cache: n } })} />
        <DecimalField label="Output" value={m.price.out} onChange={(n) => set({ price: { ...m.price, out: n } })} />
        <p className="note">Kosongkan semua kalau harga tidak diketahui; biaya tidak ditampilkan untuk model ini.</p>
        <DecimalField label="Batas konteks (ribu token)" value={m.context ? m.context / 1000 : 0} onChange={(n) => set({ context: Math.round(n * 1000) })} />
        <p className="note">Lihat di dokumentasi penyedia, mis. 128 untuk 128K. Dipakai untuk peringatan saat cerita mendekati batas. Kosongkan kalau tidak tahu.</p>
        <div className="row-buttons">
          {onDelete && (
            <button
              className="btn btn-danger"
              onClick={() => {
                onDelete();
                onClose();
              }}
            >
              Hapus model
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={() => {
              if (!m.id) {
                toast('Model id wajib diisi.');
                return;
              }
              onSave({ ...m, label: m.label.trim() || m.id });
              onClose();
            }}
          >
            Simpan model
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function ProviderEditor({ initial, isNew, onClose }: { initial: ProviderConfig; isNew: boolean; onClose: () => void }) {
  const s = useSettings();
  const [p, setP] = useState(initial);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [editModel, setEditModel] = useState<{ index: number; model: ModelConfig } | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const info = PROVIDER_INFO[p.kind];
  const set = (patch: Partial<ProviderConfig>) => setP((x) => ({ ...x, ...patch }));

  useEffect(() => setResult(null), [p.apiKey, p.baseUrl]);

  const save = async (close = true): Promise<boolean> => {
    if (!s) return false;
    if (!isValidBaseUrl(p.baseUrl)) {
      toast('Base URL harus diawali https:// dan berisi alamat yang valid.');
      return false;
    }
    const clean = { ...p, name: p.name.trim() || 'Penyedia lain', baseUrl: p.baseUrl.trim(), apiKey: p.apiKey.trim() };
    const exists = s.providers.some((x) => x.id === p.id);
    const providers = exists ? s.providers.map((x) => (x.id === p.id ? clean : x)) : [...s.providers, clean];
    // Kalau model default belum bisa dipakai, jadikan model pertama penyedia ini default.
    const def = providers.find((x) => x.id === s.defaultModel.provider);
    const defOk = def?.apiKey && def.models.some((m) => m.id === s.defaultModel.model);
    await updateSettings({
      providers,
      ...(!defOk && clean.apiKey && clean.models[0] ? { defaultModel: { provider: clean.id, model: clean.models[0].id } } : {}),
    });
    if (close) {
      toast('Penyedia disimpan');
      onClose();
    }
    return true;
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const r = await testProvider({ ...p, baseUrl: p.baseUrl.trim(), apiKey: p.apiKey.trim() });
      setResult(r.text);
      await save(false);
    } catch (e) {
      setResult('Gagal: ' + (e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <Sheet open onClose={onClose} title={isNew ? 'Penyedia baru' : p.name}>
        <div className="form-pad">
          <p className="note">{info.note}</p>
          {p.kind === 'custom' && (
            <label className="field">
              <span>Nama</span>
              <input className="input" value={p.name} onChange={(e) => set({ name: e.target.value })} />
            </label>
          )}
          <label className="field">
            <span>Base URL</span>
            <input
              className="input"
              value={p.baseUrl}
              inputMode="url"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(e) => set({ baseUrl: e.target.value })}
            />
          </label>
          <label className="field">
            <span>API key</span>
            <div className="key-row">
              <input
                className="input"
                type={showKey ? 'text' : 'password'}
                value={p.apiKey}
                autoComplete="off"
                placeholder="Tempel API key di sini"
                onChange={(e) => set({ apiKey: e.target.value })}
              />
              <button className="btn btn-small" onClick={() => setShowKey((v) => !v)}>
                {showKey ? 'Sembunyi' : 'Lihat'}
              </button>
            </div>
            <small>
              {info.keyUrl && (
                <>
                  Buat API key di{' '}
                  <a href={info.keyUrl} target="_blank" rel="noreferrer">
                    {new URL(info.keyUrl).hostname}
                  </a>
                  .{' '}
                </>
              )}
              Disimpan hanya di HP ini dan tidak ikut backup.
            </small>
          </label>
          <button className="btn wide" disabled={testing || !p.apiKey.trim()} onClick={() => void test()}>
            {testing ? 'Mengecek…' : info.balance ? 'Tes koneksi & cek saldo' : 'Tes koneksi'}
          </button>
          {!info.balance && <p className="note">Tes koneksi mengirim satu pesan sangat pendek ke model pertama (biayanya sangat kecil).</p>}
          {result && <p className={'note' + (result.startsWith('Gagal') ? ' err' : ' ok')}>{result}</p>}

          <h4 className="sub-head">Model</h4>
          {p.models.length === 0 && <p className="note">Belum ada model. Tambahkan model id dari daftar model penyedia.</p>}
          {p.models.map((m, i) => (
            <button key={m.id + i} className="provider-row" onClick={() => setEditModel({ index: i, model: m })}>
              <span className="provider-text">
                <b>{m.label}</b>
                <small>
                  {m.id} · {m.vision ? 'gambar' : 'teks saja'} · {formatPrice(m)}
                </small>
              </span>
              <IconChevron size={18} />
            </button>
          ))}
          <button
            className="provider-row add"
            onClick={() =>
              setEditModel({
                index: -1,
                model: {
                  id: '',
                  label: '',
                  vision: false,
                  thinking: defaultThinkingStyle(p.kind),
                  currency: p.kind === 'vikey' ? 'IDR' : 'USD',
                  price: { in: 0, cache: 0, out: 0 },
                },
              })
            }
          >
            <IconPlus size={18} /> Tambah model
          </button>

          <div className="row-buttons">
            {p.kind === 'custom' && !isNew && (
              <button className="btn btn-danger" onClick={() => setConfirmDel(true)}>
                Hapus penyedia
              </button>
            )}
            <button className="btn" onClick={onClose}>
              Batal
            </button>
            <button className="btn btn-primary" onClick={() => void save()}>
              Simpan
            </button>
          </div>
        </div>
      </Sheet>
      {editModel && (
        <ModelEditor
          initial={editModel.model}
          onClose={() => setEditModel(null)}
          onDelete={editModel.index >= 0 ? () => set({ models: p.models.filter((_, i) => i !== editModel.index) }) : undefined}
          onSave={(m) =>
            set({
              models:
                editModel.index >= 0 ? p.models.map((x, i) => (i === editModel.index ? m : x)) : [...p.models, m],
            })
          }
        />
      )}
      <ConfirmSheet
        open={confirmDel}
        title="Hapus penyedia?"
        message={`${p.name} dan API key-nya dihapus dari HP ini.`}
        confirmLabel="Hapus"
        danger
        onClose={() => setConfirmDel(false)}
        onConfirm={async () => {
          if (!s) return;
          await updateSettings({ providers: s.providers.filter((x) => x.id !== p.id) });
          onClose();
        }}
      />
    </>
  );
}
