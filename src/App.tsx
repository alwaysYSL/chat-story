import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { flushEditors } from './lib/editors';
import { runMigrations } from './lib/migrations';
import { ToastHost } from './components/ui';
import { UpdateBanner } from './components/UpdateBanner';
import { recoverInterrupted } from './lib/generate';
import { purgeTrash } from './lib/pages';
import { useSettings } from './lib/settings';
import Home from './screens/Home';
import Chats from './screens/Chats';
import ChatScreen from './screens/ChatScreen';
import PageView from './screens/PageView';
import Search from './screens/Search';
import SettingsScreen from './screens/Settings';
import Trash from './screens/Trash';
import Onboarding from './screens/Onboarding';

function Startup() {
  useEffect(() => {
    void (async () => {
      await runMigrations();
      await recoverInterrupted();
      await purgeTrash();
    })();
    // Simpan tulisan yang belum tersimpan saat aplikasi disembunyikan (Android bisa menutupnya kapan saja).
    const onVis = () => {
      if (document.visibilityState === 'hidden') void flushEditors();
    };
    const onHide = () => void flushEditors();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);
    void navigator.storage?.persisted?.().then((p) => {
      if (!p) void navigator.storage.persist?.();
    });
  }, []);
  return null;
}

/** Komponen dibuat ulang untuk setiap chat/page, supaya isi kolom ketik dan pilihan tidak terbawa. */
function ChatRoute() {
  const { id = 'new' } = useParams();
  const loc = useLocation();
  return <ChatScreen key={id === 'new' ? `new-${loc.key}` : id} />;
}

function PageRoute() {
  const { id = '' } = useParams();
  return <PageView key={id} />;
}

function Gate({ children }: { children: React.ReactNode }) {
  const settings = useSettings();
  const loc = useLocation();
  if (!settings) return <div className="splash" />;
  if (!settings.onboarded && loc.pathname !== '/onboarding') return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

function ReadingVars() {
  const s = useSettings();
  useEffect(() => {
    if (!s) return;
    const root = document.documentElement;
    root.style.setProperty('--read-size', `${s.fontSize}px`);
    root.style.setProperty('--read-line', String(s.lineHeight));
    root.style.setProperty(
      '--read-font',
      s.serif ? `'Noto Serif', Georgia, 'Times New Roman', serif` : `system-ui, -apple-system, Roboto, 'Segoe UI', sans-serif`,
    );
    root.classList.toggle('seg-marker', s.segMarker);
  }, [s]);
  return null;
}

export default function App() {
  return (
    <HashRouter>
      <Startup />
      <ReadingVars />
      <Gate>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/chats" element={<Chats />} />
          <Route path="/chat/:id" element={<ChatRoute />} />
          <Route path="/page/:id" element={<PageRoute />} />
          <Route path="/search" element={<Search />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/trash" element={<Trash />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Gate>
      <UpdateBanner />
      <ToastHost />
    </HashRouter>
  );
}
