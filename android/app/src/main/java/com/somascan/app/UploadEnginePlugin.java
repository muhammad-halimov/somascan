package com.somascan.app;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONException;

/**
 * Окно экрана в очередь выгрузки: команды движку {@link UploadEngine}, снимки очереди обратно
 * (событие {@code state}), настройки хранилища и тексты уведомления на языке приложения.
 *
 * Сам экран очередь не пишет — это делает движок вне WebView, поэтому записи доходят до таблицы
 * и при свёрнутом или закрытом приложении. Контракт — {@code src/features/uploads/queue/NativeUploadQueue.ts}.
 */
@CapacitorPlugin(
    name = "UploadEngine",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class UploadEnginePlugin extends Plugin implements UploadEngine.Listener {

    private UploadEngine engine;

    @Override
    public void load() {
        engine = UploadEngine.get(getContext());
        engine.addListener(this);
        engine.start();
    }

    @Override
    protected void handleOnDestroy() {
        if (engine != null) {
            engine.removeListener(this);
        }
    }

    /** Настройки хранилища и id устройства — движку; тексты — для уведомления фоновой выгрузки. */
    @PluginMethod
    public void configure(PluginCall call) {
        JSObject storage = call.getObject("storage");
        String deviceId = call.getString("deviceId", "");
        if (storage == null) {
            call.reject("Нужны настройки хранилища (storage)", "invalidArgs");
            return;
        }
        JSObject texts = call.getObject("texts", new JSObject());
        getContext().getSharedPreferences(UploadNotification.TEXTS_PREFS, android.content.Context.MODE_PRIVATE).edit()
            .putString("title", texts.getString("title", "Выгрузка в таблицу"))
            .putString("pending", texts.getString("pending", "Осталось записать: {count}"))
            .putString("done", texts.getString("done", "Записано в таблицу: {count}"))
            .putString("attention", texts.getString("attention", "Не всё записано — подробности в «Загрузках»"))
            .putString("percent", texts.getString("percent", "{percent}%"))
            .apply();
        JSObject command = new JSObject();
        command.put("type", "configure");
        command.put("storage", storage);
        command.put("deviceId", deviceId);
        engine.command(command.toString());
        call.resolve();
    }

    /** Команда движку; если появилось что писать — сразу запускается фоновая работа. */
    @PluginMethod
    public void command(PluginCall call) {
        JSObject command = call.getObject("command");
        if (command == null) {
            call.reject("Нужна команда (command)", "invalidArgs");
            return;
        }
        engine.command(command.toString());
        String type = command.getString("type", "");
        if ("enqueue".equals(type) || "import".equals(type) || "retry".equals(type) || "retryAll".equals(type)) {
            // Экран сейчас на виду: фоновую работу с уведомлением можно запустить (из фона Android 12+ не даёт).
            UploadWork.ensureRunning(getContext());
        }
        call.resolve();
    }

    /** Последний снимок очереди. */
    @PluginMethod
    public void getState(PluginCall call) {
        JSObject result = new JSObject();
        try {
            result.put("records", new JSArray(engine.lastState()));
        } catch (JSONException error) {
            result.put("records", new JSArray());
        }
        call.resolve(result);
    }

    /** Видно ли уведомление о выгрузке (разрешение, уведомления приложения, канал «Выгрузка в таблицу»). */
    @PluginMethod
    public void notificationStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("enabled", UploadNotification.isEnabled(getContext()));
        call.resolve(result);
    }

    /** Системные настройки уведомлений приложения (там включают и разрешение, и канал). */
    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        String packageName = getContext().getPackageName();
        Intent intent = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
            : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("Не удалось открыть настройки уведомлений", "unavailable", error);
        }
    }

    /** Разрешение на уведомление о фоновой выгрузке (Android 13+; раньше оно не нужно). */
    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState("notifications") == PermissionState.GRANTED) {
            resolveGranted(call, true);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsResult");
    }

    @PermissionCallback
    private void notificationsResult(PluginCall call) {
        resolveGranted(call, getPermissionState("notifications") == PermissionState.GRANTED);
    }

    private static void resolveGranted(PluginCall call, boolean granted) {
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }

    @Override
    public void onState(String recordsJson) {
        try {
            JSObject event = new JSObject();
            event.put("records", new JSArray(recordsJson));
            notifyListeners("state", event);
        } catch (JSONException ignored) {
            // Движок присылает корректный JSON; битый снимок просто пропускаем.
        }
    }
}
