package com.somascan.app;

import android.graphics.Bitmap;
import android.graphics.ImageDecoder;
import android.net.Uri;
import android.os.Build;
import android.util.Size;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Перекодирует выбранное фото в JPEG.
 *
 * WebView Android не показывает и не декодирует HEIC/HEIF — а в нём снимают многие телефоны
 * (у HONOR и Samsung это «эффективный формат» камеры). Фото из галереи в таком формате не появилось бы
 * в карточке, а распознавание отвечало бы «файл не изображение». Система же HEIF декодирует
 * ({@link ImageDecoder}, Android 9+): фото перекодируется здесь в JPEG с учётом ориентации,
 * длинная сторона — не больше {@link #MAX_SIDE}.
 *
 * Копии лежат в кэше ({@link #DIR}) и нужны, только пока фото на экране: при запуске приложения
 * прежние удаляются.
 */
@CapacitorPlugin(name = "PhotoImport")
public class PhotoImportPlugin extends Plugin {

    /** Папка копий в кэше приложения. */
    private static final String DIR = "photo-import";
    /** Длинная сторона копии, px: деталей для распознавания и приближения хватает, памяти — не сотни мегабайт. */
    private static final int MAX_SIDE = 4096;
    /** Качество JPEG. */
    private static final int JPEG_QUALITY = 92;

    private final ExecutorService executor = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "PhotoImport");
        thread.setDaemon(true);
        return thread;
    });

    @Override
    public void load() {
        // Копии прошлого запуска не нужны: бирки на экране живут, пока живёт процесс.
        executor.execute(() -> {
            File[] old = directory().listFiles();
            if (old == null) return;
            for (File file : old) {
                //noinspection ResultOfMethodCallIgnored
                file.delete();
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdown();
    }

    /**
     * Перекодирует фото в JPEG. Параметр {@code path} — адрес файла от выбора файлов
     * ({@code content://…}, {@code file://…} или путь); ответ — {@code { path }}: путь копии в кэше.
     */
    @PluginMethod
    public void toJpeg(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("Нужен path", "invalidArgs");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            call.reject("Перекодирование доступно с Android 9", "unsupported");
            return;
        }
        executor.execute(() -> {
            Bitmap bitmap = null;
            try {
                Uri uri = Uri.parse(path);
                ImageDecoder.Source source = uri.getScheme() == null
                    ? ImageDecoder.createSource(new File(path))
                    : ImageDecoder.createSource(getContext().getContentResolver(), uri);
                // Ориентацию (EXIF, у HEIF — поворот в контейнере) ImageDecoder применяет сам.
                bitmap = ImageDecoder.decodeBitmap(source, (decoder, info, ignored) -> {
                    decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
                    Size size = info.getSize();
                    int longSide = Math.max(size.getWidth(), size.getHeight());
                    if (longSide > MAX_SIDE) {
                        double scale = (double) MAX_SIDE / longSide;
                        decoder.setTargetSize(
                            Math.max(1, (int) Math.round(size.getWidth() * scale)),
                            Math.max(1, (int) Math.round(size.getHeight() * scale))
                        );
                    }
                });
                File directory = directory();
                if (!directory.isDirectory() && !directory.mkdirs()) {
                    throw new IllegalStateException("Не удалось создать папку " + directory);
                }
                File target = new File(directory, UUID.randomUUID() + ".jpg");
                try (OutputStream output = new FileOutputStream(target)) {
                    if (!bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, output)) {
                        throw new IllegalStateException("Не удалось сохранить JPEG");
                    }
                }
                JSObject result = new JSObject();
                result.put("path", target.getAbsolutePath());
                call.resolve(result);
            } catch (Exception | OutOfMemoryError error) {
                call.reject("Не удалось перекодировать фото: " + error.getMessage(), "failed");
            } finally {
                if (bitmap != null) bitmap.recycle();
            }
        });
    }

    private File directory() {
        return new File(getContext().getCacheDir(), DIR);
    }
}
