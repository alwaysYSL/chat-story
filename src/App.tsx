import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { maybeAutoBackup } from './lib/autobackup';
import { flushEditors } from './lib/editors';
import { runMigrations } from './lib/migrations';
import { exitApp, installBackButton, installExternalLinkHandler } from './lib/native';
import { ToastHost } from './components/ui';
import { UpdateBanner } from './components/UpdateBanner';
import { recoverInterrupted } from './lib/generate';
import { purgeTrash } from './lib/pages';
import { useSettings } from './lib/settings';
import { TabPager } from './components/TabSwipe';
import Home from './screens/Home';
import Chats from './screens/Chats';
import ChatScreen from './screens/ChatScreen';
import PageView from './screens/PageView';
import Search from './screens/Search';
import SettingsScreen from './screens/Settings';
import Trash from './screens/Trash';
import Onboarding from './screens/Onboarding';
import RoleplayTab from './screens/rp/RoleplayTab';
import CharacterView from './screens/rp/CharacterView';
import CharacterEdit from './screens/rp/CharacterEdit';
import Personas from './screens/rp/Personas';
import LorebookView, { WorldLorebooks } from './screens/rp/LorebookView';
import RpChat from './screens/rp/RpChat';
import GroupNew from './screens/rp/GroupNew';
import { purgeRpTrash } from './lib/rp/data';
import { PhotoViewer } from './components/rp/PhotoViewer';

function Startup() {
  useEffect(() => {
    void (async () => {
      await runMigrations();
      await recoverInterrupted();
      await purgeTrash();
      await purgeRpTrash();
      await maybeAutoBackup();
    })();
    // Simpan tulisan yang belum tersimpan saat aplikasi disembunyikan (Android bisa menutupnya kapan saja).
    const onVis = () => {
      if (document.visibilityState === 'hidden') void flushEditors().then(() => maybeAutoBackup());
    };
    const onHide = () => void flushEditors();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);
    // APK: tombol back menutup sheet, lalu kembali ke halaman sebelumnya, lalu meminimalkan aplikasi.
    void installBackButton(() => {
      const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
      if (idx > 0) window.history.back();
      else void exitApp();
    });
    installExternalLinkHandler();
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

/** Beranda, Chat, dan Pengaturan dalam satu wadah geser yang tetap terpasang saat berpindah tab. */
const TABS = <TabPager panes={{ settings: <SettingsScreen />, home: <Home />, chats: <Chats />, roleplay: <RoleplayTab /> }} />;

function RpChatRoute() {
  const { id = '' } = useParams();
  return <RpChat key={id} />;
}


export default function App() {
  return (
    <HashRouter>
      <Startup />
      <ReadingVars />
      <Gate>
        <Routes>
          <Route path="/" element={TABS} />
          <Route path="/chats" element={TABS} />
          <Route path="/chat/:id" element={<ChatRoute />} />
          <Route path="/page/:id" element={<PageRoute />} />
          <Route path="/search" element={<Search />} />
          <Route path="/settings" element={TABS} />
          <Route path="/roleplay" element={TABS} />
          <Route path="/rp/c/:id" element={<CharacterView />} />
          {/* Tanpa key: karakter baru yang tersimpan pindah ke /rp/c/<id>/edit tanpa memasang ulang editor. */}
          <Route path="/rp/c/:id/edit" element={<CharacterEdit />} />
          <Route path="/rp/chat/:id" element={<RpChatRoute />} />
          <Route path="/rp/group/new" element={<GroupNew />} />
          <Route path="/rp/personas" element={<Personas />} />
          <Route path="/rp/lore" element={<WorldLorebooks />} />
          <Route path="/rp/lore/:id" element={<LorebookView />} />
          <Route path="/trash" element={<Trash />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Gate>
      <UpdateBanner />
      <ToastHost />
      <PhotoViewer />
    </HashRouter>
  );
}
