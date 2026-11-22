import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Content Security Policy: hanya boleh menjalankan kode sendiri. Koneksi boleh ke alamat https mana pun
// supaya penyedia AI bisa dipilih bebas (DeepSeek, Vikey, Poolside, OpenRouter, atau penyedia lain).
// Dipasang hanya saat build supaya tidak bentrok dengan skrip dev server.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  base: '/chat-story/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // Editor TipTap + React membuat satu bundel ~860 KB (270 KB gzip); di-cache service worker setelah pertama dibuka.
  build: { chunkSizeWarningLimit: 1000 },
  plugins: [
    react(),
    cspPlugin(),
    VitePWA({
      // 'prompt': versi baru menunggu sampai pengguna menekan "Perbarui" (lihat UpdateBanner),
      // supaya tulisan AI yang sedang berjalan tidak terputus oleh muat ulang otomatis.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Chat Story',
        short_name: 'Chat Story',
        description: 'Menulis cerita bersama AI DeepSeek',
        lang: 'id',
        start_url: '/chat-story/',
        scope: '/chat-story/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#191919',
        theme_color: '#191919',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: 'index.html',
        // Jangan pernah meng-cache panggilan ke API DeepSeek.
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
});
