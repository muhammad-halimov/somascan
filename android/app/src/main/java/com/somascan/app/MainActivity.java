package com.somascan.app;

import android.os.Build;
import android.os.Bundle;
import android.content.res.Configuration;
import android.view.View;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Локальные плагины регистрируются до super.onCreate, чтобы мост их увидел.
        registerPlugin(NativeThemePlugin.class);
        registerPlugin(NativeSheetPlugin.class);
        registerPlugin(SmbSharePlugin.class);
        registerPlugin(GoogleDriveAuthPlugin.class);
        registerPlugin(NativeHttpPlugin.class);
        super.onCreate(savedInstanceState);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat insetsController =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        int nightMode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        insetsController.setAppearanceLightStatusBars(nightMode != Configuration.UI_MODE_NIGHT_YES);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setStatusBarContrastEnforced(false);
            // Панель навигации (три кнопки) без системной полупрозрачной подложки: под ней виден фон приложения.
            getWindow().setNavigationBarContrastEnforced(false);
        }

        // Документ в WebView не прокручивается (вся прокрутка внутри экранов), поэтому у самого
        // WebView не нужны ни полосы прокрутки, ни эффект растяжения на краю — они выдавали бы браузер.
        WebView webView = getBridge().getWebView();
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
    }
}
