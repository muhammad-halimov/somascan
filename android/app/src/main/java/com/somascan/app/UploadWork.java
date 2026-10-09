package com.somascan.app;

import android.app.Notification;
import android.content.Context;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.util.Log;
import androidx.annotation.NonNull;
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

    /** Сколько ждать опустения очереди за один запуск: обычная работа — до 10 минут, с уведомлением — дольше. */
    private static final long PLAIN_LIMIT_MS = 9 * 60_000;
    private static final long FOREGROUND_LIMIT_MS = 30 * 60_000;

    /** Как часто работа смотрит на очередь. */
    private static final long POLL_MS = 250;

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
        long kickedAt = engine.activitySequence();
        long startedAt = System.currentTimeMillis();
        boolean foreground = false;
        boolean foregroundTried = false;
        long idleSince = 0;
        try {
            engine.start();
            engine.command("{\"type\":\"kick\"}");
            while (!isStopped() && System.currentTimeMillis() < startedAt + (foreground ? FOREGROUND_LIMIT_MS : PLAIN_LIMIT_MS)) {
                Thread.sleep(POLL_MS);
                // Ответ на kick приходит всегда.
                if (!engine.isReady() || engine.activitySequence() <= kickedAt) {
                    continue;
                }
                long now = System.currentTimeMillis();
                if (UploadEngine.isBusy(engine.lastActivity())) {
                    idleSince = 0;
                    Notification shown = engine.notification().shown();
                    if (!foregroundTried && shown != null) {
                        // Уведомление с ходом уже показал движок — работа берёт его же (тот же id).
                        foregroundTried = true;
                        foreground = tryForeground(shown);
                    }
                } else if (idleSince == 0) {
                    idleSince = now;
                } else if (!foreground || now - idleSince >= UploadNotification.RESULT_SHOWN_MS) {
                    // С уведомлением работа ждёт, пока итог пачки повисит: её уведомление уберётся вместе с ней.
                    break;
                }
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
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
        return foregroundInfo(UploadEngine.get(getApplicationContext()).notification().shownOrPlaceholder());
    }

    /** Переводит работу в foreground service с уведомлением; из фона Android 12+ может не разрешить. */
    private boolean tryForeground(Notification notification) {
        try {
            setForegroundAsync(foregroundInfo(notification)).get();
            return true;
        } catch (Exception error) {
            Log.i(TAG, "foreground not allowed now, working as a background job: " + error.getMessage());
            return false;
        }
    }

    private static ForegroundInfo foregroundInfo(Notification notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return new ForegroundInfo(UploadNotification.ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        }
        return new ForegroundInfo(UploadNotification.ID, notification);
    }
}
