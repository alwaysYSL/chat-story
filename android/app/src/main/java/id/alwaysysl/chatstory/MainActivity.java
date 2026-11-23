package id.alwaysysl.chatstory;

import android.os.Bundle;
import android.view.View;
import android.view.ViewParent;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin milik aplikasi harus didaftarkan sebelum super.onCreate.
        registerPlugin(StreamHttpPlugin.class);
        super.onCreate(savedInstanceState);
        handleKeyboard();
    }

    /**
     * Android 15+ selalu edge-to-edge, jadi keyboard tidak lagi mengecilkan halaman sendiri.
     * WebView dikecilkan setinggi keyboard (dikurangi bar navigasi, yang sudah ditangani CSS safe-area),
     * supaya kolom ketik dan bar format tidak tertutup.
     */
    private void handleKeyboard() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        ViewParent parent = getBridge().getWebView().getParent();
        if (!(parent instanceof View)) return;
        View container = (View) parent;
        ViewCompat.setOnApplyWindowInsetsListener(container, (v, insets) -> {
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            Insets nav = insets.getInsets(WindowInsetsCompat.Type.navigationBars());
            int bottom = insets.isVisible(WindowInsetsCompat.Type.ime()) ? Math.max(0, ime.bottom - nav.bottom) : 0;
            v.setPadding(v.getPaddingLeft(), v.getPaddingTop(), v.getPaddingRight(), bottom);
            return insets;
        });
    }
}
