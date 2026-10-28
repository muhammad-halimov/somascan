package com.somascan.app;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Point;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Текст и коды бирки, прочитанные на самом телефоне, — Google ML Kit: распознавание латиницы (Text Recognition v2)
 * и кодов (Barcode Scanning: QR, DataMatrix, штрихкоды). Модели встроены в приложение — ни сети,
 * ни Google Play Services не нужно. Поля бирки из этого собирают правила в WebView ({@code LabelExtractor.ts}).
 *
 * Фото приходит JPEG в Base64 уже в нужной ориентации (WebView перерисовал его с учётом EXIF). Текст читается
 * в каждом из заданных поворотов: бирку могли снять боком — какой поворот верный, решают правила по найденным
 * подписям. Рамки строк — в пикселях повёрнутого фото.
 */
@CapacitorPlugin(name = "TagOcr")
public class TagOcrPlugin extends Plugin {

    private final ExecutorService executor = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "TagOcr");
        thread.setDaemon(true);
        return thread;
    });

    /** Распознаватели создаются при первом чтении (загрузка моделей — десятки миллисекунд) и живут до закрытия. */
    private TextRecognizer textRecognizer;
    private BarcodeScanner barcodeScanner;

    @Override
    protected void handleOnDestroy() {
        executor.execute(() -> {
            if (textRecognizer != null) textRecognizer.close();
            if (barcodeScanner != null) barcodeScanner.close();
        });
        executor.shutdown();
    }

    /**
     * Читает фото. Параметры: {@code image} — JPEG в Base64, {@code rotations} — повороты по часовой стрелке
     * (0, 90, 180, 270), {@code codes} — читать ли коды. Ответ — {@code { pages: [{ rotation, width, height,
     * lines: [{ text, corners, confidence }] }], codes: [{ text, format }] }}.
     */
    @PluginMethod
    public void read(PluginCall call) {
        String image = call.getString("image");
        JSArray rotations = call.getArray("rotations", new JSArray());
        boolean readCodes = Boolean.TRUE.equals(call.getBoolean("codes", false));
        if (image == null || image.isEmpty()) {
            call.reject("Нужно image", "invalidArgs");
            return;
        }
        executor.execute(() -> {
            Bitmap bitmap = null;
            try {
                byte[] bytes = Base64.decode(image, Base64.DEFAULT);
                bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                if (bitmap == null) {
                    call.reject("Не удалось прочитать фото", "imageUnreadable");
                    return;
                }
                JSArray pages = new JSArray();
                for (int index = 0; index < rotations.length(); index++) {
                    pages.put(readPage(bitmap, normalizeRotation(rotations.optInt(index, 0))));
                }
                JSObject result = new JSObject();
                result.put("pages", pages);
                result.put("codes", readCodes ? readCodes(bitmap) : new JSArray());
                call.resolve(result);
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                call.reject("Распознавание прервано", "cancelled");
            } catch (Exception | OutOfMemoryError error) {
                call.reject("Не удалось распознать текст: " + error.getMessage(), "failed");
            } finally {
                if (bitmap != null) bitmap.recycle();
            }
        });
    }

    /** Поворот, приведённый к 0, 90, 180 или 270. */
    private static int normalizeRotation(int rotation) {
        int turned = ((rotation % 360) + 360) % 360;
        return (turned / 90) * 90;
    }

    /** Текст фото, повёрнутого на {@code rotation}: строки всех блоков с рамками и уверенностью. */
    private JSObject readPage(Bitmap bitmap, int rotation) throws Exception {
        if (textRecognizer == null) textRecognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        Text text = Tasks.await(textRecognizer.process(InputImage.fromBitmap(bitmap, rotation)));
        boolean sideways = rotation % 180 != 0;
        JSArray lines = new JSArray();
        for (Text.TextBlock block : text.getTextBlocks()) {
            for (Text.Line line : block.getLines()) {
                Point[] points = line.getCornerPoints();
                if (points == null || points.length < 4) continue;
                JSArray corners = new JSArray();
                for (int corner = 0; corner < 4; corner++) {
                    corners.put(points[corner].x);
                    corners.put(points[corner].y);
                }
                JSObject item = new JSObject();
                item.put("text", line.getText());
                item.put("corners", corners);
                item.put("confidence", (double) line.getConfidence());
                lines.put(item);
            }
        }
        JSObject page = new JSObject();
        page.put("rotation", rotation);
        // Рамки ML Kit — в координатах повёрнутого фото: у поворота на 90° ширина и высота меняются местами.
        page.put("width", sideways ? bitmap.getHeight() : bitmap.getWidth());
        page.put("height", sideways ? bitmap.getWidth() : bitmap.getHeight());
        page.put("lines", lines);
        return page;
    }

    /** Коды на фото (поворот им не важен). */
    private JSArray readCodes(Bitmap bitmap) throws Exception {
        if (barcodeScanner == null) barcodeScanner = BarcodeScanning.getClient();
        List<Barcode> barcodes = Tasks.await(barcodeScanner.process(InputImage.fromBitmap(bitmap, 0)));
        JSArray codes = new JSArray();
        for (Barcode barcode : barcodes) {
            String value = barcode.getRawValue();
            if (value == null || value.isEmpty()) continue;
            JSObject code = new JSObject();
            code.put("text", value);
            code.put("format", formatName(barcode.getFormat()));
            codes.put(code);
        }
        return codes;
    }

    /** Название вида кода. */
    private static String formatName(int format) {
        switch (format) {
            case Barcode.FORMAT_QR_CODE: return "qr";
            case Barcode.FORMAT_DATA_MATRIX: return "dataMatrix";
            case Barcode.FORMAT_PDF417: return "pdf417";
            case Barcode.FORMAT_AZTEC: return "aztec";
            case Barcode.FORMAT_CODE_128: return "code128";
            case Barcode.FORMAT_CODE_39: return "code39";
            case Barcode.FORMAT_EAN_13: return "ean13";
            default: return "other";
        }
    }
}
