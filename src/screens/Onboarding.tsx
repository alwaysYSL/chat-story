import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconSparkle } from '../components/Icons';
import { toast } from '../components/ui';
import { testProvider } from '../lib/api';
import { isNative } from '../lib/native';
import { PROVIDER_INFO } from '../lib/providers';
import { updateProvider, updateSettings, useSettings } from '../lib/settings';

export default function Onboarding() {
  const nav = useNavigate();
  const s = useSettings();
  const [step, setStep] = useState(0);
  const [providerId, setProviderId] = useState('deepseek');
  const [key, setKey] = useState('');
  const [balance, setBalance] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const standalone = window.matchMedia('(display-mode: standalone)').matches;

  const provider = s?.providers.find((p) => p.id === providerId);
  useEffect(() => {
    setKey(provider?.apiKey ?? '');
    setBalance(null);
  }, [providerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [finishing, setFinishing] = useState(false);
  const finish = async () => {
    await updateSettings({ onboarded: true });
    setFinishing(true);
  };
  // Pindah ke Beranda setelah pengaturan benar-benar terbaca "onboarded", supaya Gate tidak mengembalikan ke sini.
  useEffect(() => {
    if (finishing && s?.onboarded) nav('/', { replace: true });
  }, [finishing, s?.onboarded, nav]);

  /** Simpan API key yang diketik walaupun tes koneksi gagal atau dilewati. */
  const saveKey = async () => {
    const k = key.trim();
    if (!k || !provider) return;
    await updateProvider(provider.id, (p) => ({ ...p, apiKey: k }));
    if (provider.models[0]) await updateSettings({ defaultModel: { provider: provider.id, model: provider.models[0].id } });
  };

  const test = async () => {
    if (!key.trim() || !s || !provider) return;
    setTesting(true);
    try {
      await saveKey();
      const r = await testProvider({ ...provider, apiKey: key.trim() });
      setBalance(r.text);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="screen onboarding">
      <div className="scroll-area">
        <div className="ob-dots">
          {[0, 1, 2].map((i) => (
            <span key={i} className={i === step ? 'on' : ''} />
          ))}
        </div>

        {step === 0 && (
          <div className="ob-card">
            <div className="ai-face big">
              <IconSparkle size={40} />
            </div>
            <h1>Chat Story</h1>
            <p>Tulis cerita bersama AI. Mulai dari chat: tulis brief cerita, lalu AI menulis pembukaan langsung di page. Lanjutkan dengan arahan singkat.</p>
            <ul className="ob-list">
              <li>Semua cerita tersimpan hanya di HP ini.</li>
              <li>Pakai API key Anda sendiri: DeepSeek, Vikey, Poolside, OpenRouter, atau penyedia lain.</li>
              <li>Setiap balasan AI menampilkan biayanya.</li>
            </ul>
            <button className="btn btn-primary wide" onClick={() => setStep(1)}>
              Mulai
            </button>
          </div>
        )}

        {step === 1 && (
          <div className="ob-card">
            <h2>1. Penyedia AI</h2>
            <div className="segmented wrap">
              {(s?.providers ?? []).map((p) => (
                <button key={p.id} className={providerId === p.id ? 'active' : ''} onClick={() => setProviderId(p.id)}>
                  {p.name}
                </button>
              ))}
            </div>
            {provider && (
              <>
                <p className="note">{PROVIDER_INFO[provider.kind].note}</p>
                <ol className="ob-list">
                  <li>
                    Buka{' '}
                    <a href={PROVIDER_INFO[provider.kind].keyUrl} target="_blank" rel="noreferrer">
                      {new URL(PROVIDER_INFO[provider.kind].keyUrl).hostname}
                    </a>{' '}
                    dan masuk.
                  </li>
                  <li>Isi saldo secukupnya kalau penyedianya berbayar.</li>
                  <li>Buat API key baru, salin, lalu tempel di bawah.</li>
                </ol>
              </>
            )}
            <p className="note">Penyedia lain dan model tambahan bisa diatur nanti di Pengaturan → Penyedia AI.</p>
            <input
              className="input"
              type="password"
              placeholder="Tempel API key"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <button className="btn btn-primary wide" disabled={!key.trim() || testing} onClick={() => void test()}>
              {testing ? 'Mengecek…' : 'Tes koneksi'}
            </button>
            {balance && <p className="note ok">{balance}</p>}
            <div className="row-buttons">
              <button
                className="btn"
                onClick={async () => {
                  await saveKey();
                  setStep(2);
                }}
              >
                {balance ? 'Lanjut' : 'Lewati dulu'}
              </button>
            </div>
          </div>
        )}

        {step === 2 && isNative() && (
          <div className="ob-card">
            <h2>2. Siap dipakai</h2>
            <p>
              Cerita tersimpan di HP ini. Kalau sebelumnya Anda memakai versi web, pindahkan cerita lewat Pengaturan → Backup
              di versi web, lalu Pengaturan → Restore dari file di aplikasi ini.
            </p>
            <button className="btn btn-primary wide" onClick={() => void finish()}>
              Selesai
            </button>
          </div>
        )}

        {step === 2 && !isNative() && (
          <div className="ob-card">
            <h2>2. Pasang di layar utama</h2>
            {standalone ? (
              <p className="note ok">Aplikasi sudah terpasang.</p>
            ) : (
              <ol className="ob-list">
                <li>Di Chrome, ketuk menu titik tiga di kanan atas.</li>
                <li>
                  Pilih <b>Tambahkan ke layar utama</b> (atau <b>Instal aplikasi</b>).
                </li>
                <li>Buka Chat Story dari ikon di layar utama.</li>
              </ol>
            )}
            <h2>3. Simpan data secara permanen</h2>
            <p>Supaya Chrome tidak menghapus cerita saat penyimpanan HP penuh. Tetap rutin backup di Pengaturan.</p>
            <button
              className="btn wide"
              onClick={async () => {
                const ok = (await navigator.storage?.persist?.()) ?? false;
                setPersisted(ok);
              }}
            >
              Izinkan penyimpanan permanen
            </button>
            {persisted === true && <p className="note ok">Penyimpanan permanen aktif.</p>}
            {persisted === false && (
              <p className="note">Chrome belum mengizinkan. Biasanya otomatis diizinkan setelah aplikasi dipasang di layar utama.</p>
            )}
            <button className="btn btn-primary wide" onClick={() => void finish()}>
              Selesai
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
