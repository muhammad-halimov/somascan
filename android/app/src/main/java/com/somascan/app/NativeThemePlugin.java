package com.somascan.app;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.view.Window;
import android.webkit.WebView;
import androidx.appcompat.app.AppCompatDelegate;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Синхронизирует нативную часть Android с темой из настроек приложения.
 *
 * Веб-часть сама красится через CSS, но системные элементы (диалоги подтверждения,
 * полоса под статус-баром) по умолчанию следуют теме системы.
 * Плагин подгоняет их под тему, выбранную в приложении.
 */
@CapacitorPlugin(name = "NativeTheme")
public class NativeThemePlugin extends Plugin {

    /**
     * Режим ночной темы для нативных элементов (диалоги и т. п.).
     * Параметр `mode`: `system` | `light` | `dark`.
     * Activity не пересоздаётся: в манифесте `configChanges` включает `uiMode`.
     */
    @PluginMethod
    public void setMode(PluginCall call) {
        String mode = call.getString("mode", "system");
        int nightMode;
        if ("dark".equals(mode)) {
            nightMode = AppCompatDelegate.MODE_NIGHT_YES;
        } else if ("light".equals(mode)) {
            nightMode = AppCompatDelegate.MODE_NIGHT_NO;
        } else {
            nightMode = AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM;
        }
        getActivity().runOnUiThread(() -> {
            if (AppCompatDelegate.getDefaultNightMode() != nightMode) {
                AppCompatDelegate.setDefaultNightMode(nightMode);
            }
            call.resolve();
        });
    }

    /**
     * Цвет фона окна и самого WebView: он виден под статус-баром и навигационной панелью,
     * а также до первой отрисовки страницы и при анимации клавиатуры (Capacitor без `backgroundColor`
     * в конфиге оставляет WebView белым). Параметр `background` — цвет `#rrggbb`. Цвет значков на панелях
     * задаёт встроенный плагин Capacitor `SystemBars` (он же восстанавливает его после смены конфигурации).
     */
    @PluginMethod
    public void setWindowBackground(PluginCall call) {
        String background = call.getString("background", "#ffffff");
        int color;
        try {
            color = Color.parseColor(background);
        } catch (IllegalArgumentException error) {
            call.reject("Некорректный цвет: " + background);
            return;
        }
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            window.setBackgroundDrawable(new ColorDrawable(color));
            window.getDecorView().setBackgroundColor(color);
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                webView.setBackgroundColor(color);
            }
            call.resolve();
        });
    }
}
