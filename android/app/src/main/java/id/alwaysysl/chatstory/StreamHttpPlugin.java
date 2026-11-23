package id.alwaysysl.chatstory;

import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Permintaan HTTP dari sisi Android, dengan isi jawaban dikirim sepotong-sepotong ke JavaScript.
 *
 * Aplikasi web tunduk pada aturan CORS browser, jadi penyedia AI yang tidak mengizinkannya
 * (mis. TokenKoding) tidak bisa dipanggil. Permintaan dari sini tidak terkena aturan itu.
 * Plugin CapacitorHttp bawaan tidak dipakai karena menunggu seluruh jawaban selesai,
 * sehingga tulisan AI tidak bisa mengalir.
 *
 * Event ke JavaScript:
 *   "chunk" { id, data: base64 }   potongan isi jawaban
 *   "end"   { id }                  jawaban selesai
 *   "error" { id, message }         koneksi gagal / terputus
 */
@CapacitorPlugin(name = "StreamHttp")
public class StreamHttpPlugin extends Plugin {

    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final Map<String, HttpURLConnection> open = new ConcurrentHashMap<>();
    private final Map<String, Boolean> canceled = new ConcurrentHashMap<>();

    /** Mulai permintaan. Selesai (resolve) begitu status dan header diterima; isi menyusul lewat event. */
    @PluginMethod
    public void request(PluginCall call) {
        final String id = call.getString("id");
        final String url = call.getString("url");
        final String method = call.getString("method", "GET");
        final String body = call.getString("body");
        final JSObject headers = call.getObject("headers", new JSObject());
        if (id == null || url == null || !url.startsWith("https://")) {
            call.reject("Alamat tidak valid (harus https).");
            return;
        }
        pool.execute(() -> {
            HttpURLConnection conn = null;
            boolean responded = false;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                open.put(id, conn);
                conn.setRequestMethod(method);
                conn.setConnectTimeout(30000);
                // Model yang berpikir lama bisa diam beberapa menit sebelum menulis.
                conn.setReadTimeout(300000);
                conn.setUseCaches(false);
                Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    conn.setRequestProperty(k, headers.getString(k));
                }
                if (body != null && !"GET".equals(method)) {
                    conn.setDoOutput(true);
                    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                    conn.setFixedLengthStreamingMode(bytes.length);
                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(bytes);
                    }
                }
                int status = conn.getResponseCode();
                JSObject res = new JSObject();
                res.put("status", status);
                JSObject resHeaders = new JSObject();
                for (Map.Entry<String, List<String>> e : conn.getHeaderFields().entrySet()) {
                    if (e.getKey() != null && !e.getValue().isEmpty()) resHeaders.put(e.getKey().toLowerCase(), e.getValue().get(0));
                }
                res.put("headers", resHeaders);
                call.resolve(res);
                responded = true;

                InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                if (in != null) {
                    byte[] buf = new byte[4096];
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        if (canceled.containsKey(id)) break;
                        JSObject chunk = new JSObject();
                        chunk.put("id", id);
                        chunk.put("data", Base64.encodeToString(buf, 0, n, Base64.NO_WRAP));
                        notifyListeners("chunk", chunk);
                    }
                    in.close();
                }
                JSObject end = new JSObject();
                end.put("id", id);
                notifyListeners(canceled.containsKey(id) ? "error" : "end", withMessage(end, "Dihentikan."));
            } catch (Exception e) {
                String msg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                if (!responded) {
                    call.reject(msg);
                } else {
                    JSObject err = new JSObject();
                    err.put("id", id);
                    notifyListeners("error", withMessage(err, msg));
                }
            } finally {
                open.remove(id);
                canceled.remove(id);
                if (conn != null) conn.disconnect();
            }
        });
    }

    private static JSObject withMessage(JSObject o, String msg) {
        o.put("message", msg);
        return o;
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("id");
        if (id != null) {
            canceled.put(id, true);
            HttpURLConnection conn = open.get(id);
            if (conn != null) pool.execute(conn::disconnect);
        }
        call.resolve();
    }

    /** Jaga layar tetap menyala selama AI menulis. */
    @PluginMethod
    public void keepAwake(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    /** Buka tautan di browser (mis. halaman API key, atau unduhan APK versi baru). */
    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
            call.reject("Alamat tidak valid.");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }
}
