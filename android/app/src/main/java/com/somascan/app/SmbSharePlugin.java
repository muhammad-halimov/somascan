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
 * Контракт (аргументы и коды ошибок) описан в веб-части: {@code src/features/uploads/smb/SmbShare.ts}.
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

    /** Операция над подключённой общей папкой с аргументами вызова. */
    private interface Operation {
        JSObject run(com.hierynomus.smbj.share.DiskShare share, PluginCall call) throws Exception;
    }

    @PluginMethod
    public void probe(PluginCall call) {
        perform(call, (share, c) -> client.probe(share, path(c, "path")));
    }

    @PluginMethod
    public void read(PluginCall call) {
        perform(call, (share, c) -> {
            JSObject result = new JSObject();
            result.put("data", client.read(share, path(c, "path")));
            return result;
        });
    }

    @PluginMethod
    public void write(PluginCall call) {
        perform(call, (share, c) -> {
            client.write(share, path(c, "path"), SmbShareClient.decode(string(c, "data")));
            return new JSObject();
        });
    }

    @PluginMethod
    public void commit(PluginCall call) {
        perform(call, (share, c) -> {
            String backup = c.getString("backupPath");
            return client.commit(share, path(c, "path"), SmbShareClient.decode(string(c, "data")), backup == null ? null : SmbShareClient.toSmbPath(backup));
        });
    }

    @PluginMethod
    public void rename(PluginCall call) {
        perform(call, (share, c) -> {
            client.rename(share, path(c, "from"), path(c, "to"));
            return new JSObject();
        });
    }

    @PluginMethod
    public void remove(PluginCall call) {
        perform(call, (share, c) -> {
            client.remove(share, path(c, "path"));
            return new JSObject();
        });
    }

    @PluginMethod
    public void list(PluginCall call) {
        perform(call, (share, c) -> {
            JSObject result = new JSObject();
            result.put("entries", client.list(share, path(c, "path")));
            return result;
        });
    }

    @PluginMethod
    public void mkdir(PluginCall call) {
        perform(call, (share, c) -> {
            client.mkdir(share, path(c, "path"));
            return new JSObject();
        });
    }

    @PluginMethod
    public void mkdirs(PluginCall call) {
        perform(call, (share, c) -> {
            client.mkdirs(share, path(c, "path"));
            return new JSObject();
        });
    }

    @Override
    protected void handleOnDestroy() {
        executor.execute(client::disconnect);
        executor.shutdown();
    }

    /** Ставит операцию в очередь потока и отвечает на вызов по её завершении. */
    private void perform(PluginCall call, Operation operation) {
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
                call.resolve(client.run(target, share -> operation.run(share, call)));
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

    /** Обязательный строковый аргумент. */
    private static String string(PluginCall call, String name) throws SmbShareClient.Failure {
        String value = call.getString(name);
        if (value == null) {
            throw new SmbShareClient.Failure("invalidArgs", "Нужен аргумент " + name);
        }
        return value;
    }

    /** Обязательный путь, переведённый в формат SMB. */
    private static String path(PluginCall call, String name) throws SmbShareClient.Failure {
        return SmbShareClient.toSmbPath(string(call, name));
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
