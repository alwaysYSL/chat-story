import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconSparkle } from '../components/Icons';
import { toast } from '../components/ui';
import { getBalance } from '../lib/deepseek';
import { updateSettings, useSettings } from '../lib/settings';

export default function Onboarding() {
  const nav = useNavigate();
  const s = useSettings();
  const [step, setStep] = useState(0);
  const [key, setKey] = useState('');
  const [balance, setBalance] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const standalone = window.matchMedia('(display-mode: standalone)').matches;

  useEffect(() => {
    if (s?.apiKey) setKey(s.apiKey);
  }, [s?.apiKey]);

  const [finishing, setFinishing] = useState(false);
  const finish = async () => {
    await updateSettings({ onboarded: true });
    setFinishing(true);
  };
  // Pindah ke Beranda setelah pengaturan benar-benar terbaca "onboarded", supaya Gate tidak mengembalikan ke sini.
  useEffect(() => {
    if (finishing && s?.onboarded) nav('/', { replace: true });
  }, [finishing, s?.onboarded, nav]);

  const test = async () => {
    if (!key.trim()) return;
    setTesting(true);
    try {
      const b = await getBalance(key.trim());
      await updateSettings({ apiKey: key.trim() });
      setBalance(b.text);
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
            <p>Tulis cerita bersama AI DeepSeek. Mulai dari chat: tulis brief cerita, lalu AI menulis pembukaan langsung di page. Lanjutkan dengan arahan singkat.</p>
            <ul className="ob-list">
              <li>Semua cerita tersimpan hanya di HP ini.</li>
              <li>Biaya dibayar langsung ke DeepSeek dengan API key Anda sendiri.</li>
              <li>Setiap balasan AI menampilkan biayanya.</li>
            </ul>
            <button className="btn btn-primary wide" onClick={() => setStep(1)}>
              Mulai
            </button>
          </div>
        )}

        {step === 1 && (
          <div className="ob-card">
            <h2>1. API key DeepSeek</h2>
            <ol className="ob-list">
              <li>
                Buka{' '}
                <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">
                  platform.deepseek.com/api_keys
                </a>{' '}
                dan masuk.
              </li>
              <li>Isi saldo (top up) secukupnya, misalnya $2.</li>
              <li>Buat API key baru, salin, lalu tempel di bawah.</li>
            </ol>
            <input
              className="input"
              type="password"
              placeholder="sk-…"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <button className="btn btn-primary wide" disabled={!key.trim() || testing} onClick={() => void test()}>
              {testing ? 'Mengecek…' : 'Tes koneksi'}
            </button>
            {balance && <p className="note ok">Berhasil terhubung. Saldo: {balance}</p>}
            <div className="row-buttons">
              <button className="btn" onClick={() => setStep(2)}>
                {balance ? 'Lanjut' : 'Lewati dulu'}
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
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
