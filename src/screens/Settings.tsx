import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { IconBack } from '../components/Icons';
import { ConfirmSheet, Sheet, SheetItem, Toggle, toast } from '../components/ui';
import { getSnapshotInfo, snapshotBlob, type SnapshotInfo } from '../lib/migrations';
import { goBack } from '../lib/nav';
import { goTab, useTabSwipe } from '../components/TabSwipe';
import { isNative } from '../lib/native';
import { backupFileName, createBackup, markBackedUp, restoreBackup } from '../lib/backup';
import { ProviderList } from '../components/Providers';
import { CREATIVITY_LABEL, updateSettings, useSettings, type Creativity, type Settings } from '../lib/settings';
import { downloadFile, shareFile, timeAgo } from '../lib/util';

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
  const swipeRef = useTabSwipe('settings');
  const [storage, setStorage] = useState<{ used: string; persisted: boolean } | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [confirmReplace, setConfirmReplace] = useState<File | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [snapshot, setSnapshot] = useState<SnapshotInfo | null>(null);
  useEffect(() => {
    void getSnapshotInfo().then(setSnapshot);
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);

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

  if (!s) return <div className="screen tab-screen" ref={swipeRef} />;
  const set = (patch: Partial<Settings>) => void updateSettings(patch);

  const doBackup = async () => {
    if (backingUp) return;
    setBackingUp(true);
    try {
      const { blob, at } = await createBackup();
      const name = backupFileName();
      const r = await shareFile(name, blob, 'Backup Chat Story');
      if (r === 'canceled') {
        toast('Backup dibatalkan. File belum tersimpan.');
        return;
      }
      const where = r === 'unsupported' ? await downloadFile(name, blob) : null;
      await markBackedUp(at);
      toast(where ? `Backup disimpan di ${where}` : 'Backup dibagikan');
    } catch (e) {
      toast('Backup gagal: ' + ((e as Error).message || String(e)));
    } finally {
      setBackingUp(false);
    }
  };

  const doRestore = async (mode: 'merge' | 'replace', file: File | null = restoreFile) => {
    if (!file) return;
    setRestoreFile(null);
    setConfirmReplace(null);
    try {
      if (mode === 'replace') {
        // Data di HP ini diunduh dulu sebagai pengaman sebelum diganti.
        const { blob } = await createBackup();
        await downloadFile(backupFileName('chat-story-sebelum-restore'), blob);
      }
      const r = await restoreBackup(file, mode);
      toast(
        `Dipulihkan: ${r.pages} page, ${r.chats} chat` +
          (r.keptNewer ? `. ${r.keptNewer} item di HP ini lebih baru, jadi tetap dipakai.` : ''),
      );
    } catch (e) {
      toast((e as Error).message || 'Restore gagal.');
    }
  };

  const downloadSnapshot = async () => {
    const blob = await snapshotBlob();
    if (blob) toast('Disimpan di ' + (await downloadFile(backupFileName('chat-story-sebelum-pembaruan'), blob)));
  };

  return (
    <div className="screen tab-screen" ref={swipeRef}>
      <header className="page-header">
        <button
          className="icon-btn"
          aria-label="Kembali"
          onClick={() => ((loc.state as { tabFromHome?: boolean } | null)?.tabFromHome ? goTab(nav, loc, 'settings', 'home') : goBack(nav))}
        >
          <IconBack />
        </button>
        <div className="chat-head-title">Pengaturan</div>
      </header>
      <div className="scroll-area settings">
        <section id="penyedia">
          <h3>Penyedia AI</h3>
          <p className="note">
            Isi API key untuk penyedia yang Anda pakai. Model bisa diganti per pesan lewat tombol model di kolom chat.
          </p>
          <ProviderList />
        </section>

        <section id="ai">
          <h3>Gaya AI</h3>
          <div className="field-row">
            <span>
              Mode berpikir (thinking) default
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
              Peringatan jam peak DeepSeek
              <small>08:00–11:00 dan 13:00–17:00 WIB, Senin–Jumat. Harga DeepSeek 2×.</small>
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
            {storage &&
              (isNative()
                ? ` Terpakai ${storage.used}.`
                : ` Terpakai ${storage.used}. Penyimpanan permanen: ${storage.persisted ? 'aktif' : 'belum aktif'}.`)}
          </p>
          <div className="row-buttons left">
            <button className="btn btn-primary" disabled={backingUp} onClick={() => void doBackup()}>
              {backingUp ? 'Menyiapkan…' : 'Backup sekarang'}
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
          {storage && !storage.persisted && !isNative() && (
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
          {snapshot && (
            <p className="note">
              Backup otomatis sebelum pembaruan aplikasi ({timeAgo(snapshot.at)}).{' '}
              <button className="link-btn" onClick={() => void downloadSnapshot()}>
                Unduh
              </button>
            </p>
          )}
          <Link to="/trash" className="settings-link">
            Sampah ›
          </Link>
        </section>

        <section id="tentang">
          <h3>Tentang</h3>
          <p className="note">
            Chat Story versi {__APP_VERSION__} ({isNative() ? 'aplikasi Android' : 'versi web'}).{' '}
            {!isNative() && (
              <a href="https://github.com/alwaysYSL/chat-story/releases/latest" target="_blank" rel="noreferrer">
                Unduh aplikasi Android
              </a>
            )}
          </p>
          <Link to="/onboarding" className="settings-link">
            Panduan awal & cara pasang ›
          </Link>
        </section>
      </div>

      <Sheet open={!!restoreFile} onClose={() => setRestoreFile(null)} title="Restore backup">
        <p className="note">{restoreFile?.name}</p>
        <SheetItem
          label="Gabungkan"
          hint="Tambahkan isi backup. Kalau ada di keduanya, yang lebih baru dipakai."
          onClick={() => void doRestore('merge')}
        />
        <SheetItem
          label="Ganti semua"
          hint="Semua cerita & chat di HP ini diganti isi backup"
          danger
          onClick={() => {
            setConfirmReplace(restoreFile);
            setRestoreFile(null);
          }}
        />
      </Sheet>
      <ConfirmSheet
        open={!!confirmReplace}
        title="Ganti semua data?"
        message="Semua cerita, bab, dan chat di HP ini dihapus lalu diganti isi backup. Data sekarang diunduh dulu sebagai file pengaman. Penyedia AI dan API key tetap ada."
        confirmLabel="Ganti semua"
        danger
        onClose={() => setConfirmReplace(null)}
        onConfirm={() => {
          const f = confirmReplace;
          setConfirmReplace(null);
          if (f) void doRestore('replace', f);
        }}
      />
    </div>
  );
}
