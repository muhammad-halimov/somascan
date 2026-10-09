package com.somascan.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.ForegroundInfo;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.OutOfQuotaPolicy;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/**
 * Фоновая работа очереди выгрузки (WorkManager): пока в очереди есть что писать, держит процесс
 * с движком {@link UploadEngine} живым — с уведомлением «Выгрузка в таблицу» (foreground service
 * типа dataSync). Так запись не замирает в свёрнутом приложении и доходит до конца после того, как
 * приложение закрыли: процесс остаётся, пока очередь не опустеет.
 *
 * Если система всё же выгрузила процесс или записи ждут сети / паузы после сбоя, WorkManager
 * запустит работу снова (с условием «есть сеть»), поднимет процесс и движок — очередь продолжится
 * с сохранённого места, без открытия приложения.
 */
public class UploadWork extends Worker {

    private static final String TAG = "UploadWork";

    /** Работа «писать сейчас» и отложенная (пауза после сбоя, ожидание сети). */
    private static final String WORK_NOW = "somascan.uploads.now";
    private static final String WORK_LATER = "somascan.uploads.later";

    private static final String CHANNEL_ID = "somascan.uploads";
    private static final int NOTIFICATION_ID = 7301;

    /** Тексты уведомления на языке приложения (присылает экран, см. {@link UploadEnginePlugin}). */
    static final String TEXTS_PREFS = "somascan.uploadEngine";

    /** Сколько ждать опустения очереди за один запуск: обычная работа — до 10 минут, с уведомлением — дольше. */
    private static final long PLAIN_LIMIT_MS = 9 * 60_000;
    private static final long FOREGROUND_LIMIT_MS = 30 * 60_000;

    /** Больше отрезков полоса прогресса не рисует по одному на бирку — дальше сплошная. */
    private static final int MAX_SEGMENTS = 12;

    /** Акцентный цвет приложения (значок и полоса прогресса). */
    private static final int ACCENT = 0xFF536DFE;

    /** Последнее решение планировщика — одинаковые не повторяются. */
    private static String lastPlan = "";

    public UploadWork(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    // ---------- Планирование ----------

    /**
     * Запустить работу сейчас (бирку поставили в очередь, повтор). Если работа уже запрошена или идёт,
     * вторая не ставится: идущая ждёт, пока очередь не опустеет, и подхватит новые записи сама.
     */
    static void ensureRunning(Context context) {
        synchronized (UploadWork.class) {
            if (lastPlan.equals("now")) {
                return;
            }
            lastPlan = "now";
        }
        enqueueNow(context);
    }

    private static void enqueueNow(Context context) {
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(UploadWork.class)
            .setConstraints(networkConstraint())
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build();
        // Если работа уже идёт — следующая встанет за ней (а не потеряется, если текущая как раз заканчивает).
        WorkManager.getInstance(context).enqueueUniqueWork(WORK_NOW, ExistingWorkPolicy.APPEND_OR_REPLACE, request);
    }

    /** Решение по активности движка: писать сейчас, позже (пауза, нет сети) или ничего. */
    static void plan(Context context, JSONObject activity) {
        String decision;
        long delay = 0;
        if (UploadEngine.isBusy(activity)) {
            decision = "now";
        } else if (activity != null && activity.optInt("pending") > 0) {
            long next = activity.isNull("nextAttemptAt") ? 0 : activity.optLong("nextAttemptAt");
            delay = next > 0 ? Math.max(0, next - System.currentTimeMillis()) : 0;
            decision = "later:" + next;
        } else {
            decision = "idle";
        }
        synchronized (UploadWork.class) {
            if (decision.equals(lastPlan)) {
                return;
            }
            lastPlan = decision;
        }
        try {
            if (decision.equals("now")) {
                enqueueNow(context);
            } else if (decision.startsWith("later:")) {
                OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(UploadWork.class)
                    .setConstraints(networkConstraint())
                    .setInitialDelay(delay, TimeUnit.MILLISECONDS)
                    .build();
                WorkManager.getInstance(context).enqueueUniqueWork(WORK_LATER, ExistingWorkPolicy.REPLACE, request);
            }
        } catch (Exception error) {
            Log.w(TAG, "plan " + decision, error);
        }
    }

    private static Constraints networkConstraint() {
        return new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
    }

    // ---------- Работа ----------

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        UploadEngine engine = UploadEngine.get(context);
        boolean foreground = tryForeground(engine.lastActivity());
        long kickedAt = engine.activitySequence();
        UploadEngine.Listener listener = new UploadEngine.Listener() {
            @Override
            public void onActivity(JSONObject activity, long sequence) {
                if (foreground) {
                    setForegroundAsync(foregroundInfo(context, activity));
                }
            }
        };
        engine.addListener(listener);
        try {
            engine.start();
            engine.command("{\"type\":\"kick\"}");
            long deadline = System.currentTimeMillis() + (foreground ? FOREGROUND_LIMIT_MS : PLAIN_LIMIT_MS);
            // Ответ на kick приходит всегда; дальше ждём, пока очередь не перестанет быть занятой.
            while (!isStopped() && System.currentTimeMillis() < deadline) {
                Thread.sleep(1_000);
                boolean answered = engine.isReady() && engine.activitySequence() > kickedAt;
                if (answered && !UploadEngine.isBusy(engine.lastActivity())) {
                    break;
                }
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        } finally {
            engine.removeListener(listener);
        }
        // Что осталось (пауза после сбоя, нет сети, не уложились в срок) — следующей работе.
        synchronized (UploadWork.class) {
            lastPlan = "";
        }
        plan(context, engine.lastActivity());
        return Result.success();
    }

    /** Для ускоренной работы на Android 11 и ниже: уведомление, с которым она идёт. */
    @NonNull
    @Override
    public ForegroundInfo getForegroundInfo() {
        return foregroundInfo(getApplicationContext(), UploadEngine.get(getApplicationContext()).lastActivity());
    }

    /** Переводит работу в foreground service с уведомлением; из фона Android 12+ может не разрешить. */
    private boolean tryForeground(JSONObject activity) {
        try {
            setForegroundAsync(foregroundInfo(getApplicationContext(), activity)).get();
            return true;
        } catch (Exception error) {
            Log.i(TAG, "foreground not allowed now, working as a background job: " + error.getMessage());
            return false;
        }
    }

    // ---------- Уведомление ----------

    private static ForegroundInfo foregroundInfo(Context context, JSONObject activity) {
        Notification notification = notification(context, activity);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return new ForegroundInfo(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        }
        return new ForegroundInfo(NOTIFICATION_ID, notification);
    }

    /**
     * Уведомление о выгрузке с системным прогрессом: {@link NotificationCompat.ProgressStyle} —
     * на Android 16 полоса из отрезков (одна бирка — один отрезок) и Live Update (чип «2/5» в строке
     * состояния и на экране блокировки), на Android 15 и ниже тот же стиль сам показывает обычную
     * системную полосу прогресса.
     */
    private static Notification notification(Context context, JSONObject activity) {
        ensureChannel(context);
        SharedPreferences texts = context.getSharedPreferences(TEXTS_PREFS, Context.MODE_PRIVATE);
        String title = texts.getString("title", "Выгрузка в таблицу");
        JSONObject progress = activity == null ? null : activity.optJSONObject("progress");
        int total = progress == null ? 0 : Math.max(0, progress.optInt("total"));
        int done = progress == null ? 0 : Math.max(0, Math.min(progress.optInt("done"), total));
        boolean writing = UploadEngine.isBusy(activity) && total > 0;
        String text = writing
            ? texts.getString("pending", "Осталось записать: {count}").replace("{count}", String.valueOf(total - done))
            : texts.getString("waiting", "Ждёт сети или повтора");

        NotificationCompat.ProgressStyle style = new NotificationCompat.ProgressStyle().setStyledByProgress(true);
        if (writing) {
            if (total <= MAX_SEGMENTS) {
                for (int index = 0; index < total; index++) {
                    style.addProgressSegment(new NotificationCompat.ProgressStyle.Segment(1));
                }
            } else {
                style.addProgressSegment(new NotificationCompat.ProgressStyle.Segment(total));
            }
            style.setProgress(done);
        } else {
            style.setProgressIndeterminate(true);
        }

        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent open = launch == null ? null : PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_upload)
            .setColor(ACCENT)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(open)
            .setStyle(style)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            // Android 16: Live Update — уведомление поднимается наверх, ход виден в строке состояния.
            .setRequestPromotedOngoing(true);
        if (writing) {
            builder.setShortCriticalText(done + "/" + total);
        }
        return builder.build();
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
}
