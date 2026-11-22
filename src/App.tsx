import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
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
    void recoverInterrupted();
    void purgeTrash();
    void navigator.storage?.persisted?.().then((p) => {
      if (!p) void navigator.storage.persist?.();
    });
  }, []);
  return null;
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
          <Route path="/chat/:id" element={<ChatScreen />} />
          <Route path="/page/:id" element={<PageView />} />
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
