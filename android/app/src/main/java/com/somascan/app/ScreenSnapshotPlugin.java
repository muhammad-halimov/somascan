package com.somascan.app;

import android.graphics.Bitmap;
import android.graphics.Rect;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Base64;
import android.view.PixelCopy;
import android.webkit.WebView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;

/**
 * Уменьшенный снимок экрана приложения (WebView) — для стекла окон «Настройки» и «Загрузки».
 *
 * Под открытым окном экран неподвижен, поэтому стекло окна — один раз размытый снимок, а не размытие, которое
 * GPU пересчитывает на каждом кадре движения внутри окна. Снимок берётся с того, что уже на экране (PixelCopy),
 * и сразу уменьшается до запрошенного размера; размывает его веб-часть.
 */
@CapacitorPlugin(name = "ScreenSnapshot")
public class ScreenSnapshotPlugin extends Plugin {

    /** Поток, на котором PixelCopy сообщает о готовности и снимок сжимается в PNG (не главный поток). */
    private HandlerThread worker;

    @Override
    public void load() {
        worker = new HandlerThread("ScreenSnapshot");
        worker.start();
    }

    @Override
    protected void handleOnDestroy() {
        if (worker != null) worker.quitSafely();
    }

    /**
     * Снимок WebView размером `width` × `height` пикселей. Ответ: `image` — PNG в виде data URL.
     * PixelCopy есть с Android 8; на более старых снимка нет — окно остаётся на живом стекле.
     */
    @PluginMethod
    public void capture(PluginCall call) {
        int width = call.getInt("width", 0);
        int height = call.getInt("height", 0);
        if (width <= 0 || height <= 0) {
            call.reject("Invalid snapshot size");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.unavailable("PixelCopy requires Android 8");
            return;
        }
        getActivity().runOnUiThread(() -> {
            WebView webView = getBridge().getWebView();
            if (webView == null || webView.getWidth() == 0 || webView.getHeight() == 0) {
                call.reject("WebView is not laid out");
                return;
            }
            int[] origin = new int[2];
            webView.getLocationInWindow(origin);
            Rect source = new Rect(origin[0], origin[1], origin[0] + webView.getWidth(), origin[1] + webView.getHeight());
            Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            Handler handler = new Handler(worker.getLooper());
            PixelCopy.request(getActivity().getWindow(), source, bitmap, (result) -> {
                if (result != PixelCopy.SUCCESS) {
                    bitmap.recycle();
                    call.reject("PixelCopy failed: " + result);
                    return;
                }
                ByteArrayOutputStream png = new ByteArrayOutputStream();
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, png);
                bitmap.recycle();
                JSObject answer = new JSObject();
                answer.put("image", "data:image/png;base64," + Base64.encodeToString(png.toByteArray(), Base64.NO_WRAP));
                call.resolve(answer);
            }, handler);
        });
    }
}
