import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'id.alwaysysl.chatstory',
  appName: 'Chat Story',
  webDir: 'dist-android',
  android: {
    // Koneksi AI lewat plugin StreamHttp milik aplikasi (lihat android/.../StreamHttpPlugin.java).
    allowMixedContent: false,
  },
  plugins: {
    // Jangan ganti fetch bawaan: plugin ini tidak mendukung streaming, jadi tulisan AI tidak akan mengalir.
    CapacitorHttp: { enabled: false },
    // WebView edge-to-edge; jarak aman diatur CSS env(safe-area-inset-*) seperti di PWA.
    SystemBars: { insetsHandling: 'native', initialViewportFitValueHint: 'cover' },
  },
};

export default config;
