package com.somascan.app;

import android.content.Context;
import android.os.PowerManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Плагин «сетевой диск»: файловые операции на общей папке Windows для выгрузки таблицы.
 *
 * Все вызовы выполняются в одном фоновом потоке по очереди — параллельных обращений к серверу
 * нет, а поток моста Capacitor (общий для всех плагинов) не блокируется сетью.
 * На время операции удерживается частичный wake lock, чтобы запись дописалась,
 * даже если экран погас.
 *
 * Операции — {@link SmbOps} (их же выполняет движок очереди); контракт (аргументы и коды ошибок)
 * описан в веб-части: {@code src/features/uploads/smb/smbFiles.ts}.
 */
@CapacitorPlugin(name = "SmbShare")
public class SmbSharePlugin extends Plugin {

    /** Предел удержания wake lock на одну операцию. */
    private static final long WAKE_LOCK_MS = 90_000;

    /** Единственный поток операций. */
    private final ExecutorService executor = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "SmbShare");
        thread.setDaemon(true);
        return thread;
    });

    private final SmbShareClient client = new SmbShareClient();

    @PluginMethod
    public void probe(PluginCall call) {
        perform(call, "probe");
    }

    @PluginMethod
    public void read(PluginCall call) {
        perform(call, "read");
    }

    @PluginMethod
    public void write(PluginCall call) {
        perform(call, "write");
    }

    @PluginMethod
    public void commit(PluginCall call) {
        perform(call, "commit");
    }

    @PluginMethod
    public void rename(PluginCall call) {
        perform(call, "rename");
    }

    @PluginMethod
    public void remove(PluginCall call) {
        perform(call, "remove");
    }

    @PluginMethod
    public void list(PluginCall call) {
        perform(call, "list");
    }

    @PluginMethod
    public void mkdir(PluginCall call) {
        perform(call, "mkdir");
    }

    @PluginMethod
    public void mkdirs(PluginCall call) {
        perform(call, "mkdirs");
    }

    @Override
    protected void handleOnDestroy() {
        executor.execute(client::disconnect);
        executor.shutdown();
    }

    /** Ставит операцию {@code op} ({@link SmbOps}) в очередь потока и отвечает на вызов по её завершении. */
    private void perform(PluginCall call, String op) {
        SmbShareClient.Target target;
        try {
            target = SmbShareClient.Target.from(call.getObject("connection"));
        } catch (SmbShareClient.Failure failure) {
            call.reject(failure.getMessage(), failure.code);
            return;
        }
        executor.execute(() -> {
            PowerManager.WakeLock wakeLock = acquireWakeLock();
            try {
                call.resolve(client.run(target, share -> SmbOps.run(client, share, op, call.getData())));
            } catch (SmbShareClient.Failure failure) {
                call.reject(failure.getMessage(), failure.code);
            } catch (Exception error) {
                call.reject(error.getClass().getSimpleName() + ": " + error.getMessage(), "io");
            } finally {
                if (wakeLock != null && wakeLock.isHeld()) {
                    wakeLock.release();
                }
            }
        });
    }

    /** Частичный wake lock на время операции; {@code null}, если его не дали. */
    private PowerManager.WakeLock acquireWakeLock() {
        try {
            PowerManager manager = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            PowerManager.WakeLock wakeLock = manager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "somascan:smb");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(WAKE_LOCK_MS);
            return wakeLock;
        } catch (Exception error) {
            return null;
        }
    }
}
