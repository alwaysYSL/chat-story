import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { IconBack } from '../components/Icons';
import { Sheet, SheetItem, Toggle, toast } from '../components/ui';
import { backupFileName, createBackup, markBackedUp, restoreBackup } from '../lib/backup';
import { getBalance } from '../lib/deepseek';
import { MODEL_LABEL, PRICES } from '../lib/pricing';
import { CREATIVITY_LABEL, updateSettings, useSettings, type Creativity, type Settings } from '../lib/settings';
import { downloadFile, shareFile, timeAgo } from '../lib/util';
import type { ModelId } from '../db';

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  suffix?: string;
}) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <label className="field-row">
      <span>{label}</span>
      <span className="field-num">
        <input
          className="input num"
          inputMode="numeric"
          value={v}
          onChange={(e) => setV(e.target.value.replace(/[^\d]/g, ''))}
          onBlur={() => {
            const n = Math.min(max, Math.max(min, parseInt(v || '0', 10)));
            setV(String(n));
            if (n !== value) onChange(n);
          }}
        />
        {suffix && <small>{suffix}</small>}
      </span>
    </label>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function SettingsScreen() {
  const s = useSettings();
  const nav = useNavigate();
  const loc = useLocation();
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [balance, setBalance] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [storage, setStorage] = useState<{ used: string; persisted: boolean } | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (s) setKey(s.apiKey);
  }, [s?.apiKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void (async () => {
      const est = await navigator.storage?.estimate?.();
      const persisted = (await navigator.storage?.persisted?.()) ?? false;
      const mb = est?.usage ? (est.usage / 1024 / 1024).toFixed(1) + ' MB' : '—';
      setStorage({ used: mb, persisted });
    })();
  }, []);

  useEffect(() => {
    if (!s || !loc.hash) return;
    document.getElementById(loc.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [s, loc.hash]);

  if (!s) return <div className="screen" />;
  const set = (patch: Partial<Settings>) => void updateSettings(patch);

  const test = async () => {
    const k = key.trim();
    if (!k) {
      toast('Masukkan API key dulu.');
      return;
    }
    setTesting(true);
    try {
      const b = await getBalance(k);
      setBalance(b.text + (b.available ? '' : ' (saldo tidak cukup)'));
      if (k !== s.apiKey) await updateSettings({ apiKey: k });
      toast('Koneksi berhasil');
    } catch (e) {
      setBalance(null);
      toast((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const doBackup = async () => {
    const blob = await createBackup();
    const name = backupFileName();
    if (!(await shareFile(name, blob, 'Backup Chat Story'))) downloadFile(name, blob);
    await markBackedUp();
    toast('Backup dibuat');
  };

  const doRestore = async (mode: 'merge' | 'replace') => {
    if (!restoreFile) return;
    try {
      const r = await restoreBackup(restoreFile, mode);
      toast(`Dipulihkan: ${r.pages} page, ${r.chats} chat`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setRestoreFile(null);
    }
  };

  return (
    <div className="screen">
      <header className="page-header">
        <button className="icon-btn" aria-label="Kembali" onClick={() => (history.length > 1 ? nav(-1) : nav('/'))}>
          <IconBack />
        </button>
        <div className="chat-head-title">Pengaturan</div>
      </header>
      <div className="scroll-area settings">
        <section id="ai">
          <h3>AI DeepSeek</h3>
          <label className="field">
            <span>API key</span>
            <div className="key-row">
              <input
                className="input"
                type={showKey ? 'text' : 'password'}
                value={key}
                placeholder="sk-…"
                autoComplete="off"
                onChange={(e) => setKey(e.target.value)}
                onBlur={() => key.trim() !== s.apiKey && set({ apiKey: key.trim() })}
              />
              <button className="btn btn-small" onClick={() => setShowKey((v) => !v)}>
                {showKey ? 'Sembunyi' : 'Lihat'}
              </button>
            </div>
            <small>
              Dapatkan di{' '}
              <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">
                platform.deepseek.com
              </a>
              . Disimpan hanya di HP ini dan tidak ikut backup.
            </small>
          </label>
          <div className="row-buttons left">
            <button className="btn btn-primary" disabled={testing} onClick={() => void test()}>
              {testing ? 'Mengecek…' : 'Tes koneksi & cek saldo'}
            </button>
            {s.apiKey && (
              <button
                className="btn btn-danger"
                onClick={() => {
                  setKey('');
                  setBalance(null);
                  set({ apiKey: '' });
                  toast('API key dihapus');
                }}
              >
                Hapus key
              </button>
            )}
          </div>
          {balance && <p className="note">Saldo: {balance}</p>}

          <div className="field-row">
            <span>Model default</span>
            <Segmented<ModelId>
              value={s.model}
              options={[
                { value: 'deepseek-flash', label: MODEL_LABEL['deepseek-flash'] },
                { value: 'deepseek-v4-pro', label: MODEL_LABEL['deepseek-v4-pro'] },
              ]}
              onChange={(v) => set({ model: v })}
            />
          </div>
          <p className="note">
            Flash: ${PRICES['deepseek-flash'].miss}/${PRICES['deepseek-flash'].out} per 1 juta token input/output, bisa membaca gambar. Pro:
            ${PRICES['deepseek-v4-pro'].miss}/${PRICES['deepseek-v4-pro'].out}, tidak bisa membaca gambar. Harga off-peak.
          </p>
          <div className="field-row">
            <span>
              Mode berpikir (thinking)
              <small>Token berpikir ditagih sebagai output. Biasanya tidak perlu untuk cerita.</small>
            </span>
            <Toggle checked={s.thinking} onChange={(v) => set({ thinking: v })} label="Mode berpikir" />
          </div>
          <div className="field-row">
            <span>Kreativitas</span>
            <Segmented<Creativity>
              value={s.creativity}
              options={(['stable', 'normal', 'wild'] as Creativity[]).map((c) => ({ value: c, label: CREATIVITY_LABEL[c] }))}
              onChange={(v) => set({ creativity: v })}
            />
          </div>
        </section>

        <section id="panjang">
          <h3>Panjang tulisan</h3>
          <NumberField label="Pembukaan minimal" value={s.openingMin} min={200} max={8000} suffix="kata" onChange={(n) => set({ openingMin: n })} />
          <NumberField label="Pembukaan maksimal" value={s.openingMax} min={300} max={10000} suffix="kata" onChange={(n) => set({ openingMax: Math.max(n, s.openingMin) })} />
          <NumberField label="Lanjutan Normal minimal" value={s.contMin} min={100} max={5000} suffix="kata" onChange={(n) => set({ contMin: n })} />
          <NumberField label="Lanjutan Normal maksimal" value={s.contMax} min={100} max={6000} suffix="kata" onChange={(n) => set({ contMax: Math.max(n, s.contMin) })} />
          <NumberField label="Pendek" value={s.shortWords} min={50} max={3000} suffix="kata" onChange={(n) => set({ shortWords: n })} />
          <NumberField label="Panjang" value={s.longWords} min={200} max={8000} suffix="kata" onChange={(n) => set({ longWords: n })} />
          <NumberField
            label="Sarankan bab baru setelah"
            value={s.chapterThreshold}
            min={500}
            max={100000}
            suffix="kata"
            onChange={(n) => set({ chapterThreshold: n })}
          />
        </section>

        <section id="biaya">
          <h3>Biaya</h3>
          <NumberField label="Kurs 1 USD" value={s.usdToIdr} min={1000} max={100000} suffix="Rupiah" onChange={(n) => set({ usdToIdr: n })} />
          <div className="field-row">
            <span>
              Peringatan jam peak
              <small>08:00–11:00 dan 13:00–17:00 WIB, Senin–Jumat. Harga 2×.</small>
            </span>
            <Toggle checked={s.peakWarning} onChange={(v) => set({ peakWarning: v })} label="Peringatan jam peak" />
          </div>
        </section>

        <section id="baca">
          <h3>Tampilan baca</h3>
          <label className="field-row">
            <span>Ukuran huruf ({s.fontSize}px)</span>
            <input type="range" min={14} max={24} value={s.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })} />
          </label>
          <label className="field-row">
            <span>Jarak baris ({s.lineHeight.toFixed(1)})</span>
            <input
              type="range"
              min={1.3}
              max={2.2}
              step={0.1}
              value={s.lineHeight}
              onChange={(e) => set({ lineHeight: Number(e.target.value) })}
            />
          </label>
          <div className="field-row">
            <span>Huruf serif</span>
            <Toggle checked={s.serif} onChange={(v) => set({ serif: v })} label="Huruf serif" />
          </div>
          <div className="field-row">
            <span>
              Penanda batas balasan AI
              <small>Garis tipis di pinggir tiap balasan AI di naskah.</small>
            </span>
            <Toggle checked={s.segMarker} onChange={(v) => set({ segMarker: v })} label="Penanda batas balasan AI" />
          </div>
        </section>

        <section id="backup">
          <h3>Data</h3>
          <p className="note">
            Semua cerita hanya tersimpan di HP ini. Backup terakhir: {s.lastBackupAt ? timeAgo(s.lastBackupAt) : 'belum pernah'}.
            {storage && ` Terpakai ${storage.used}. Penyimpanan permanen: ${storage.persisted ? 'aktif' : 'belum aktif'}.`}
          </p>
          <div className="row-buttons left">
            <button className="btn btn-primary" onClick={() => void doBackup()}>
              Backup sekarang
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              Restore dari file
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept="application/json,.json"
              onChange={(e) => {
                setRestoreFile(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
          </div>
          {storage && !storage.persisted && (
            <button
              className="btn"
              onClick={async () => {
                const ok = await navigator.storage?.persist?.();
                setStorage((x) => (x ? { ...x, persisted: !!ok } : x));
                toast(ok ? 'Penyimpanan permanen aktif' : 'Chrome belum mengizinkan. Pasang aplikasi ke layar utama lalu coba lagi.');
              }}
            >
              Minta penyimpanan permanen
            </button>
          )}
          <Link to="/trash" className="settings-link">
            Sampah ›
          </Link>
        </section>

        <section id="tentang">
          <h3>Tentang</h3>
          <p className="note">Chat Story versi {__APP_VERSION__}</p>
          <Link to="/onboarding" className="settings-link">
            Panduan awal & cara pasang ›
          </Link>
        </section>
      </div>

      <Sheet open={!!restoreFile} onClose={() => setRestoreFile(null)} title="Restore backup">
        <p className="note">{restoreFile?.name}</p>
        <SheetItem
          label="Gabungkan"
          hint="Data di backup ditambahkan; item dengan id sama ditimpa"
          onClick={() => void doRestore('merge')}
        />
        <SheetItem
          label="Ganti semua"
          hint="Semua data di HP ini dihapus lalu diganti isi backup"
          danger
          onClick={() => void doRestore('replace')}
        />
      </Sheet>
    </div>
  );
}
