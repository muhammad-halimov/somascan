package com.somascan.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * HTTP-запросы из нативной части с настоящей отменой — для серверов в локальной сети по {@code http://}
 * (LM Studio), которые WebView блокирует как смешанное содержимое.
 *
 * В отличие от встроенного CapacitorHttp, запрос можно прервать ({@code cancel}): соединение
 * закрывается, и LM Studio, заметив разрыв, останавливает генерацию ответа — модель не продолжает
 * впустую нагружать сервер после «Сброса».
 */
@CapacitorPlugin(name = "NativeHttp")
public class NativeHttpPlugin extends Plugin {

    private final ExecutorService executor = Executors.newCachedThreadPool(runnable -> {
        Thread thread = new Thread(runnable, "NativeHttp");
        thread.setDaemon(true);
        return thread;
    });

    /** Идущие запросы по id — чтобы {@code cancel} мог закрыть соединение. */
    private final Map<String, HttpURLConnection> active = new ConcurrentHashMap<>();
    /** Запросы, отменённые до или во время выполнения. */
    private final Map<String, Boolean> cancelled = new ConcurrentHashMap<>();

    @PluginMethod
    public void request(PluginCall call) {
        String id = call.getString("id");
        String url = call.getString("url");
        if (id == null || url == null) {
            call.reject("Нужны id и url", "invalidArgs");
            return;
        }
        String method = call.getString("method", "GET");
        String body = call.getString("body");
        int timeoutMs = call.getInt("timeoutMs", 0);
        JSObject headers = call.getObject("headers", new JSObject());
        executor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                if (cancelled.remove(id) != null) {
                    call.reject("Запрос отменён", "cancelled");
                    return;
                }
                connection = (HttpURLConnection) new URL(url).openConnection();
                active.put(id, connection);
                connection.setRequestMethod(method);
                connection.setConnectTimeout(timeoutMs > 0 ? timeoutMs : 15_000);
                connection.setReadTimeout(timeoutMs);
                for (Iterator<String> keys = headers.keys(); keys.hasNext(); ) {
                    String key = keys.next();
                    connection.setRequestProperty(key, headers.getString(key));
                }
                if (body != null) {
                    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                    connection.setDoOutput(true);
                    connection.setFixedLengthStreamingMode(bytes.length);
                    try (OutputStream out = connection.getOutputStream()) {
                        out.write(bytes);
                    }
                }
                int status = connection.getResponseCode();
                InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                String text = "";
                if (stream != null) {
                    try (InputStream in = stream) {
                        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                        byte[] chunk = new byte[16 * 1024];
                        int read;
                        while ((read = in.read(chunk)) != -1) {
                            buffer.write(chunk, 0, read);
                        }
                        text = buffer.toString(StandardCharsets.UTF_8.name());
                    }
                }
                JSObject result = new JSObject();
                result.put("status", status);
                result.put("body", text);
                call.resolve(result);
            } catch (Exception error) {
                if (cancelled.remove(id) != null) {
                    call.reject("Запрос отменён", "cancelled");
                } else if (error instanceof SocketTimeoutException) {
                    call.reject("Сервер не ответил вовремя", "timeout", error);
                } else {
                    call.reject(error.getClass().getSimpleName() + ": " + error.getMessage(), "network", error);
                }
            } finally {
                active.remove(id);
                if (connection != null) {
                    connection.disconnect();
                }
            }
        });
    }

    /** Прерывает запрос: соединение закрывается, вызов {@code request} отвечает {@code cancelled}. */
    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("id");
        if (id != null) {
            cancelled.put(id, true);
            HttpURLConnection connection = active.get(id);
            if (connection != null) {
                // disconnect() из другого потока закрывает сокет — чтение ответа тут же обрывается.
                executor.execute(connection::disconnect);
            }
        }
        call.resolve();
    }
}
