package com.somascan.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import org.json.JSONObject;

/**
 * Уведомление о выгрузке в таблицу — системный прогресс пачки, синхронно с «Загрузками».
 *
 * Показывается сразу по активности движка ({@link UploadEngine}), а не когда запустится фоновая
 * работа: бирку поставили — уведомление с ходом пачки уже на месте, каждая записанная бирка сдвигает
 * полосу в тот же момент, что и строку в истории. Фоновая работа ({@link UploadWork}) переводит
 * в foreground service это же уведомление (тот же id) и дальше его не трогает.
 *
 * Пачка дописана — на несколько секунд остаётся итог («Записано в таблицу: 3» с полной полосой или
 * «Не всё записано»), потом уведомление убирается само.
 *
 * Стиль — системный {@link NotificationCompat.ProgressStyle}: на Android 16 полоса из отрезков цвета
 * приложения (одна бирка — один отрезок) и Live Update (чип «42 %» в строке состояния и на экране
 * блокировки), на Android 15 и ниже тот же стиль сам показывает обычную системную полосу прогресса.
 * Полоса и проценты — плавный ход пачки от движка ({@code progress.fraction}): движется ровно и внутри
 * записи одной бирки, без скачков по её шагам.
 */
final class UploadNotification {

    private static final String TAG = "UploadNotification";

    static final String CHANNEL_ID = "somascan.uploads";
    static final int ID = 7301;

    /** Тексты уведомления на языке приложения (присылает экран, см. {@link UploadEnginePlugin}). */
    static final String TEXTS_PREFS = "somascan.uploadEngine";

    /** Сколько держится итог пачки. */
    static final long RESULT_SHOWN_MS = 4_000;

    /**
     * Обновления не чаще: частые обновления одного уведомления система отбрасывает (до 5 в секунду).
     * Движок присылает плавный ход примерно так же часто — полоса движется ровно.
     */
    private static final long MIN_INTERVAL_MS = 300;

    /** Больше отрезков полоса не рисует по одному на бирку — дальше сплошная. */
    private static final int MAX_SEGMENTS = 12;

    /** Делений на бирку: полоса движется плавно и внутри записи одной бирки. */
    private static final int UNITS = 100;

    /** Акцентный цвет приложения (значок и полоса прогресса). */
    private static final int ACCENT = 0xFF536DFE;

    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());

    // Только из главного потока.
    /** Идёт ли пачка (уведомление с ходом показано). */
    private boolean inBatch;
    /** Что показать: ход пачки, итог или ничего. */
    private View view = View.NONE;
    private View shown = View.NONE;
    private boolean flushScheduled;
    private long lastPostedAt;

    /** Последнее построенное уведомление — для foreground service фоновой работы. */
    private volatile Notification current;

    UploadNotification(Context context) {
        this.context = context;
    }

    /** Новая активность очереди (любой поток). */
    void onActivity(JSONObject activity) {
        main.post(() -> update(activity));
    }

    /** Показанное уведомление (ход или итог пачки) или {@code null}, пока показывать нечего. */
    Notification shown() {
        return current;
    }

    /** Уведомление для foreground service: показанное, а если его ещё нет — «Выгрузка в таблицу» без хода. */
    Notification shownOrPlaceholder() {
        Notification notification = current;
        return notification != null ? notification : build(View.NONE);
    }

    private void update(JSONObject activity) {
        JSONObject progress = activity.optJSONObject("progress");
        int total = progress == null ? 0 : Math.max(0, progress.optInt("total"));
        int done = progress == null ? 0 : Math.max(0, Math.min(progress.optInt("done"), total));
        // Плавный ход пачки от движка (0…1): полоса и проценты.
        double fraction = progress == null ? 0 : Math.max(0, Math.min(1, progress.optDouble("fraction", 0)));
        if (UploadEngine.isBusy(activity)) {
            if (total > 0) {
                inBatch = true;
                view = View.progress(done, total, (int) Math.round(fraction * total * UNITS));
            }
        } else if (inBatch) {
            inBatch = false;
            JSONObject finished = activity.optJSONObject("finished");
            view = finished == null ? View.NONE : View.result(finished.optInt("written"), finished.optInt("total"));
        } else {
            return;
        }
        if (!flushScheduled) {
            flushScheduled = true;
            main.postAtTime(this::flush, Math.max(SystemClock.uptimeMillis(), lastPostedAt + MIN_INTERVAL_MS));
        }
    }

    private void flush() {
        flushScheduled = false;
        if (view.equals(shown)) {
            return;
        }
        lastPostedAt = SystemClock.uptimeMillis();
        NotificationManagerCompat manager = NotificationManagerCompat.from(context);
        if (view.kind == View.Kind.NONE) {
            shown = view;
            current = null;
            manager.cancel(ID);
            return;
        }
        Notification notification = build(view);
        current = notification;
        // Уведомления выключены: показанным не считаем — включат посреди пачки, и следующий ход появится сразу.
        if (!isEnabled(context)) {
            Log.i(TAG, "upload notifications are turned off (permission, app or channel)");
            return;
        }
        try {
            manager.notify(ID, notification);
            shown = view;
        } catch (SecurityException error) {
            Log.w(TAG, "notify", error);
        }
    }

    /**
     * Видно ли уведомление о выгрузке: есть разрешение (Android 13+), уведомления приложения включены
     * и канал «Выгрузка в таблицу» не выключен пользователем.
     */
    static boolean isEnabled(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            return false;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            NotificationChannel channel = manager == null ? null : manager.getNotificationChannel(CHANNEL_ID);
            return channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
        }
        return true;
    }

    // ---------- Вид ----------

    private Notification build(View view) {
        ensureChannel(context);
        SharedPreferences texts = context.getSharedPreferences(TEXTS_PREFS, Context.MODE_PRIVATE);
        String title = texts.getString("title", "Выгрузка в таблицу");
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent open = launch == null ? null : PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_upload)
            .setColor(ACCENT)
            .setContentTitle(title)
            .setContentIntent(open)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setPriority(NotificationCompat.PRIORITY_LOW);

        String percent = texts.getString("percent", "{percent}%").replace("{percent}", String.valueOf(view.percent()));
        switch (view.kind) {
            case PROGRESS:
                builder
                    .setContentText(percent + " · " + texts.getString("pending", "Осталось записать: {count}").replace("{count}", String.valueOf(view.total - view.done)))
                    .setStyle(progressStyle(view.total, view.units))
                    .setOngoing(true)
                    // Android 16: Live Update — уведомление поднимается наверх, ход виден в строке состояния.
                    .setRequestPromotedOngoing(true)
                    .setShortCriticalText(percent);
                break;
            case RESULT:
                boolean complete = view.done == view.total;
                builder
                    .setContentText(complete
                        ? texts.getString("done", "Записано в таблицу: {count}").replace("{count}", String.valueOf(view.done))
                        : texts.getString("attention", "Не всё записано — подробности в «Загрузках»"))
                    .setAutoCancel(true)
                    .setTimeoutAfter(RESULT_SHOWN_MS);
                if (complete) {
                    builder.setStyle(progressStyle(view.total, view.total * UNITS));
                }
                break;
            default:
                // Фоновая работа поднялась раньше, чем движок сообщил ход: без полосы, только заголовок.
                builder.setOngoing(true);
                break;
        }
        return builder.build();
    }

    /** Полоса: отрезок на бирку (до {@link #MAX_SEGMENTS}), в каждом — {@link #UNITS} делений; {@code units} — пройдено делений. */
    private static NotificationCompat.ProgressStyle progressStyle(int total, int units) {
        NotificationCompat.ProgressStyle style = new NotificationCompat.ProgressStyle().setStyledByProgress(true);
        if (total <= MAX_SEGMENTS) {
            for (int index = 0; index < total; index++) {
                style.addProgressSegment(new NotificationCompat.ProgressStyle.Segment(UNITS).setColor(ACCENT));
            }
        } else {
            style.addProgressSegment(new NotificationCompat.ProgressStyle.Segment(total * UNITS).setColor(ACCENT));
        }
        return style.setProgress(Math.max(0, Math.min(units, total * UNITS)));
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) {
            return;
        }
        String name = context.getSharedPreferences(TEXTS_PREFS, Context.MODE_PRIVATE).getString("title", "Выгрузка в таблицу");
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, name, NotificationManager.IMPORTANCE_LOW);
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    /** Что показывает уведомление: ход пачки (обработано из всех), итог (записано из всех) или ничего. */
    private static final class View {
        enum Kind { NONE, PROGRESS, RESULT }

        static final View NONE = new View(Kind.NONE, 0, 0, 0);

        final Kind kind;
        final int done;
        final int total;
        /** Пройдено делений полосы ({@link #UNITS} на бирку, плавный ход). */
        final int units;

        private View(Kind kind, int done, int total, int units) {
            this.kind = kind;
            this.done = done;
            this.total = total;
            this.units = units;
        }

        static View progress(int done, int total, int units) {
            return new View(Kind.PROGRESS, done, total, units);
        }

        /** Процент хода (не 100, пока пачка не дописана). */
        int percent() {
            return total > 0 ? Math.min(99, units * 100 / (total * UNITS)) : 0;
        }

        static View result(int written, int total) {
            return new View(Kind.RESULT, Math.max(0, Math.min(written, total)), Math.max(0, total), 0);
        }

        @Override
        public boolean equals(Object other) {
            if (!(other instanceof View)) {
                return false;
            }
            View view = (View) other;
            return view.kind == kind && view.done == done && view.total == total && view.units == units;
        }

        @Override
        public int hashCode() {
            return ((kind.ordinal() * 31 + done) * 31 + total) * 31 + units;
        }
    }
}
