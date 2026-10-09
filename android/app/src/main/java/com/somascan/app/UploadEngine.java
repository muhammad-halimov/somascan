package com.somascan.app;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.MutableContextWrapper;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Base64;
import android.util.Log;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.annotation.NonNull;
import androidx.webkit.WebViewAssetLoader;
import com.getcapacitor.JSObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.ProtocolException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * Движок очереди выгрузки: {@code public/upload-engine.js} (веб-часть, {@code src/engine}) в скрытом
 * WebView, который принадлежит процессу, а не экрану.
 *
 * Поэтому очередь пишется, пока жив процесс, — и при свёрнутом приложении, и после того, как его
 * смахнули из недавних: процесс держит фоновая работа {@link UploadWork} с уведомлением, а если
 * система всё же выгрузила процесс, WorkManager поднимет его снова, и движок продолжит с сохранённой
 * очередью. Экран приложения — только окно в очередь: команды и снимки идут через {@link UploadEnginePlugin}.
 *
 * Хост движка ({@code SomascanHost}): хранилище «ключ — значение» в файлах приложения, сетевой диск
 * ({@link SmbOps}, один поток, wake lock на операцию), HTTP для Google Drive, токен Google
 * ({@link GoogleDriveTokens}), события и журнал. Протокол — {@code src/engine/protocol.ts}.
 */
final class UploadEngine {

    private static final String TAG = "UploadEngine";

    /** Ключ очереди в хранилище движка (как у {@code UploadStore}). */
    static final String QUEUE_KEY = "somascan.uploads.v2";

    /** Страница движка: только его скрипт из ресурсов приложения (через WebViewAssetLoader). */
    private static final String ORIGIN = "https://appassets.androidplatform.net/";
    private static final String PAGE = "<!doctype html><meta charset=\"utf-8\"><script src=\"/assets/public/upload-engine.js\"></script>";

    /** Предел удержания wake lock на одну операцию с сетевым диском. */
    private static final long WAKE_LOCK_MS = 120_000;

    /** Подписчик на события движка (вызывается не из главного потока). */
    interface Listener {
        default void onState(String recordsJson) {}

        default void onActivity(JSONObject activity, long sequence) {}
    }

    private static UploadEngine instance;

    /** Движок процесса. */
    static synchronized UploadEngine get(Context context) {
        if (instance == null) {
            instance = new UploadEngine(context.getApplicationContext());
        }
        return instance;
    }

    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    /** Сетевой диск: одно подключение, операции строго по одной. */
    private final SmbShareClient smb = new SmbShareClient();
    private final ExecutorService smbExecutor = Executors.newSingleThreadExecutor(runnable -> named(runnable, "UploadEngine-smb"));
    private final ExecutorService httpExecutor = Executors.newCachedThreadPool(runnable -> named(runnable, "UploadEngine-http"));
    private final File storageDir;
    private final Object storageLock = new Object();
    private final CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();
    /** Уведомление о выгрузке — по каждой активности, сразу (синхронно с «Загрузками»). */
    private final UploadNotification notification;

    private volatile String lastState;
    private volatile JSONObject lastActivity;
    private volatile long activitySequence;
    private volatile boolean ready;

    // Только из главного потока.
    private WebView webView;
    /** Номер текущего экземпляра движка: ответы прежнего (до перезапуска WebView) отбрасываются. */
    private volatile int generation;
    private final List<String> pendingCommands = new ArrayList<>();
    private final Map<Integer, Runnable> timers = new HashMap<>();
    private boolean networkWatched;

    private UploadEngine(Context context) {
        this.context = context;
        this.storageDir = new File(context.getFilesDir(), "upload-engine");
        this.notification = new UploadNotification(context);
    }

    /** Запускает движок (если ещё не запущен). */
    void start() {
        main.post(this::startOnMain);
    }

    /** Команда движку (JSON {@code EngineCommand}); до загрузки движка команды копятся. */
    void command(String json) {
        main.post(() -> {
            startOnMain();
            if (ready) {
                evaluate("SomascanEngine.command(" + JSONObject.quote(json) + ")");
            } else {
                pendingCommands.add(json);
            }
        });
    }

    boolean isReady() {
        return ready;
    }

    /** Последний снимок очереди (JSON-массив записей). */
    String lastState() {
        String state = lastState;
        if (state != null) {
            return state;
        }
        String stored = readStorage(QUEUE_KEY);
        return stored == null ? "[]" : stored;
    }

    /** Последняя активность очереди или {@code null}, пока движок её не сообщил. */
    JSONObject lastActivity() {
        return lastActivity;
    }

    /** Сколько раз движок сообщал активность (чтобы ждать ответа на {@code kick}). */
    long activitySequence() {
        return activitySequence;
    }

    UploadNotification notification() {
        return notification;
    }

    void addListener(Listener listener) {
        listeners.add(listener);
    }

    void removeListener(Listener listener) {
        listeners.remove(listener);
    }

    /** Занята ли очередь: пишет или есть что писать при наличии сети (как {@code isBusy} в протоколе). */
    static boolean isBusy(JSONObject activity) {
        if (activity == null) {
            return false;
        }
        return activity.optBoolean("running") || (activity.optBoolean("online", true) && activity.optInt("due") > 0);
    }

    // ---------- WebView ----------

    @SuppressLint({ "SetJavaScriptEnabled", "JavascriptInterface" })
    private void startOnMain() {
        if (webView != null) {
            return;
        }
        int current = ++generation;
        ready = false;
        WebView view = new WebView(new MutableContextWrapper(context));
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Процесс отрисовки — с важностью приложения, даже без видимого WebView.
            view.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(context))
            .build();
        view.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail detail) {
                Log.w(TAG, "renderer gone, restarting engine");
                if (v == webView) {
                    destroyOnMain();
                    main.postDelayed(UploadEngine.this::startOnMain, 1_000);
                } else {
                    v.destroy();
                }
                return true;
            }
        });
        view.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                Log.println(message.messageLevel() == ConsoleMessage.MessageLevel.ERROR ? Log.ERROR : Log.INFO, TAG,
                    message.message() + " (" + message.sourceId() + ":" + message.lineNumber() + ")");
                return true;
            }
        });
        view.addJavascriptInterface(new Host(current), "SomascanHost");
        view.loadDataWithBaseURL(ORIGIN, PAGE, "text/html", "utf-8", null);
        webView = view;
        watchNetwork();
    }

    private void destroyOnMain() {
        ready = false;
        for (Runnable timer : timers.values()) {
            main.removeCallbacks(timer);
        }
        timers.clear();
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
    }

    private void evaluate(String script) {
        if (webView != null) {
            webView.evaluateJavascript(script, null);
        }
    }

    /** Ответ на долгую операцию — в движок, если он тот же, что её начал. */
    private void settle(int forGeneration, int id, boolean ok, String payload) {
        main.post(() -> {
            if (forGeneration == generation && webView != null) {
                evaluate("__somascanSettle(" + id + "," + ok + "," + JSONObject.quote(payload) + ")");
            }
        });
    }

    /** Отказ в формате хоста ({@code { code, message }}). */
    private static String failure(String code, String message) {
        JSObject object = new JSObject();
        object.put("code", code);
        object.put("message", message == null ? code : message);
        return object.toString();
    }

    // ---------- События движка ----------

    private void onEvent(int fromGeneration, String type, String payload) {
        if (fromGeneration != generation) {
            return;
        }
        try {
            JSONObject data = new JSONObject(payload);
            switch (type) {
                case "ready":
                    main.post(() -> {
                        if (fromGeneration != generation) {
                            return;
                        }
                        ready = true;
                        for (String json : pendingCommands) {
                            evaluate("SomascanEngine.command(" + JSONObject.quote(json) + ")");
                        }
                        pendingCommands.clear();
                    });
                    break;
                case "state": {
                    String records = data.getJSONArray("records").toString();
                    lastState = records;
                    for (Listener listener : listeners) {
                        listener.onState(records);
                    }
                    break;
                }
                case "activity": {
                    JSONObject activity = data.getJSONObject("activity");
                    lastActivity = activity;
                    long sequence = ++activitySequence;
                    notification.onActivity(activity);
                    UploadWork.plan(context, activity);
                    for (Listener listener : listeners) {
                        listener.onActivity(activity, sequence);
                    }
                    break;
                }
                default:
                    break;
            }
        } catch (Exception error) {
            Log.w(TAG, "bad engine event " + type, error);
        }
    }

    // ---------- Долгие операции ----------

    private void perform(int forGeneration, int id, String method, String argsJson) {
        switch (method) {
            case "smb":
                smbExecutor.execute(() -> settleSmb(forGeneration, id, argsJson));
                break;
            case "http":
                httpExecutor.execute(() -> {
                    try {
                        settle(forGeneration, id, true, http(new JSONObject(argsJson)));
                    } catch (Exception error) {
                        settle(forGeneration, id, false, failure("network", error.getClass().getSimpleName() + ": " + error.getMessage()));
                    }
                });
                break;
            case "googleToken":
                main.post(() -> GoogleDriveTokens.fetch(context, new GoogleDriveTokens.Callback() {
                    @Override
                    public void onToken(String token) {
                        JSObject result = new JSObject();
                        result.put("accessToken", token);
                        settle(forGeneration, id, true, result.toString());
                    }

                    @Override
                    public void onFailure(String code, String message, Exception error) {
                        settle(forGeneration, id, false, failure(code, message));
                    }
                }));
                break;
            default:
                settle(forGeneration, id, false, failure("io", "Неизвестная операция хоста " + method));
        }
    }

    private void settleSmb(int forGeneration, int id, String argsJson) {
        PowerManager.WakeLock wakeLock = acquireWakeLock();
        try {
            JSObject args = new JSObject(argsJson);
            SmbShareClient.Target target = SmbShareClient.Target.from(args.getJSObject("connection"));
            String op = args.getString("op", "");
            JSObject result = smb.run(target, share -> SmbOps.run(smb, share, op, args));
            settle(forGeneration, id, true, result.toString());
        } catch (SmbShareClient.Failure error) {
            settle(forGeneration, id, false, failure(error.code, error.getMessage()));
        } catch (Exception error) {
            settle(forGeneration, id, false, failure("io", error.getClass().getSimpleName() + ": " + error.getMessage()));
        } finally {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        }
    }

    /** HTTP-запрос для Google Drive: тело запроса и ответа — base64. */
    private static String http(JSONObject args) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(args.getString("url")).openConnection();
        try {
            String method = args.optString("method", "GET");
            try {
                connection.setRequestMethod(method);
            } catch (ProtocolException unsupported) {
                // PATCH (обновление файла в Drive): Google принимает его как POST с заголовком-заменой.
                connection.setRequestMethod("POST");
                connection.setRequestProperty("X-HTTP-Method-Override", method);
            }
            connection.setConnectTimeout(20_000);
            connection.setReadTimeout(120_000);
            JSONObject headers = args.optJSONObject("headers");
            if (headers != null) {
                for (Iterator<String> keys = headers.keys(); keys.hasNext(); ) {
                    String key = keys.next();
                    connection.setRequestProperty(key, headers.getString(key));
                }
            }
            String body = args.optString("body", "");
            if (!body.isEmpty()) {
                byte[] bytes = Base64.decode(body, Base64.DEFAULT);
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream out = connection.getOutputStream()) {
                    out.write(bytes);
                }
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            byte[] response = new byte[0];
            if (stream != null) {
                try (InputStream in = stream) {
                    ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                    byte[] chunk = new byte[32 * 1024];
                    int read;
                    while ((read = in.read(chunk)) != -1) {
                        buffer.write(chunk, 0, read);
                    }
                    response = buffer.toByteArray();
                }
            }
            JSObject result = new JSObject();
            result.put("status", status);
            result.put("body", Base64.encodeToString(response, Base64.NO_WRAP));
            return result.toString();
        } finally {
            connection.disconnect();
        }
    }

    // ---------- Хранилище ----------

    private File storageFile(String key) {
        return new File(storageDir, key.replaceAll("[^A-Za-z0-9._-]", "_") + ".json");
    }

    String readStorage(String key) {
        synchronized (storageLock) {
            File file = storageFile(key);
            if (!file.exists()) {
                return null;
            }
            try {
                try (InputStream in = new FileInputStream(file)) {
                    ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                    byte[] chunk = new byte[16 * 1024];
                    int read;
                    while ((read = in.read(chunk)) != -1) {
                        buffer.write(chunk, 0, read);
                    }
                    return buffer.toString(StandardCharsets.UTF_8.name());
                }
            } catch (Exception error) {
                Log.w(TAG, "storage read " + key, error);
                return null;
            }
        }
    }

    private void writeStorage(String key, String value) {
        synchronized (storageLock) {
            try {
                if (!storageDir.exists() && !storageDir.mkdirs()) {
                    throw new IllegalStateException("no storage dir");
                }
                // Атомарно: временный файл на диск, затем замена — очередь не теряется при обрыве.
                File tmp = new File(storageDir, storageFile(key).getName() + ".tmp");
                try (FileOutputStream out = new FileOutputStream(tmp)) {
                    out.write(value.getBytes(StandardCharsets.UTF_8));
                    out.getFD().sync();
                }
                if (!tmp.renameTo(storageFile(key))) {
                    throw new IllegalStateException("rename failed");
                }
            } catch (Exception error) {
                Log.e(TAG, "storage write " + key, error);
            }
        }
    }

    private void removeStorage(String key) {
        synchronized (storageLock) {
            File file = storageFile(key);
            if (file.exists() && !file.delete()) {
                Log.w(TAG, "storage remove " + key);
            }
        }
    }

    // ---------- Сеть ----------

    /** Сообщает движку о сети: с её возвращением паузы снимаются, очередь идёт сразу. */
    private void watchNetwork() {
        if (networkWatched) {
            return;
        }
        networkWatched = true;
        ConnectivityManager manager = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (manager == null) {
            return;
        }
        command(networkCommand(isOnline(manager)));
        try {
            manager.registerDefaultNetworkCallback(new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(@NonNull Network network) {
                    command(networkCommand(true));
                }

                @Override
                public void onLost(@NonNull Network network) {
                    command(networkCommand(isOnline(manager)));
                }
            });
        } catch (Exception error) {
            Log.w(TAG, "network callback", error);
        }
    }

    private static boolean isOnline(ConnectivityManager manager) {
        Network network = manager.getActiveNetwork();
        NetworkCapabilities capabilities = network == null ? null : manager.getNetworkCapabilities(network);
        return capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private static String networkCommand(boolean online) {
        return "{\"type\":\"network\",\"online\":" + online + "}";
    }

    // ---------- Разное ----------

    private PowerManager.WakeLock acquireWakeLock() {
        try {
            PowerManager manager = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            PowerManager.WakeLock wakeLock = manager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "somascan:upload");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(WAKE_LOCK_MS);
            return wakeLock;
        } catch (Exception error) {
            return null;
        }
    }

    private static Thread named(Runnable runnable, String name) {
        Thread thread = new Thread(runnable, name);
        thread.setDaemon(true);
        return thread;
    }

    private static int priority(String level) {
        switch (level) {
            case "error":
                return Log.ERROR;
            case "warn":
                return Log.WARN;
            case "debug":
                return Log.DEBUG;
            default:
                return Log.INFO;
        }
    }

    /** Методы {@code SomascanHost} (вызываются из потока JavaBridge, JS ждёт возврата). */
    private final class Host {
        private final int owner;

        Host(int owner) {
            this.owner = owner;
        }

        @JavascriptInterface
        public String storageGet(String key) {
            return readStorage(key);
        }

        @JavascriptInterface
        public void storageSet(String key, String value) {
            writeStorage(key, value);
        }

        @JavascriptInterface
        public void storageRemove(String key) {
            removeStorage(key);
        }

        @JavascriptInterface
        public void call(int id, String method, String args) {
            perform(owner, id, method, args);
        }

        @JavascriptInterface
        public void emit(String type, String payload) {
            onEvent(owner, type, payload);
        }

        @JavascriptInterface
        public void log(String level, String message) {
            Log.println(priority(level), TAG, message);
        }

        @JavascriptInterface
        public void setTimer(int id, double delay) {
            main.post(() -> {
                if (owner != generation) {
                    return;
                }
                Runnable fire = () -> {
                    timers.remove(id);
                    evaluate("__somascanTimer(" + id + ")");
                };
                timers.put(id, fire);
                main.postDelayed(fire, (long) Math.max(0, delay));
            });
        }

        @JavascriptInterface
        public void clearTimer(int id) {
            main.post(() -> {
                Runnable fire = timers.remove(id);
                if (fire != null) {
                    main.removeCallbacks(fire);
                }
            });
        }
    }
}
