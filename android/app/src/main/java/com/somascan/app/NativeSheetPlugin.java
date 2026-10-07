package com.somascan.app;

import android.content.Context;
import android.content.res.TypedArray;
import android.graphics.Typeface;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.material.bottomsheet.BottomSheetDialog;
import com.google.android.material.bottomsheet.BottomSheetDragHandleView;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Панель действий Material 3 в теме приложения (светлой или тёмной).
 *
 * Плагин `@capacitor/action-sheet` на Android рисует панель с жёстко заданными цветами
 * и в тёмной теме остаётся белой. Здесь панель строится из системных виджетов в теме
 * активити (`values` / `values-night`), поэтому следует теме, выбранной в настройках
 * приложения, и даёт нативный отклик (волна) на нажатие пунктов.
 *
 * Контракт тот же, что у `ActionSheet.showActions`: параметры `title` и `options[{title, style}]`,
 * ответ `{ index, canceled }`; отмена (тап вне панели или «Назад») — `index: -1`.
 */
@CapacitorPlugin(name = "NativeSheet")
public class NativeSheetPlugin extends Plugin {

    private static final String STYLE_CANCEL = "CANCEL";
    private static final String STYLE_DESTRUCTIVE = "DESTRUCTIVE";

    @PluginMethod
    public void showActions(PluginCall call) {
        String title = call.getString("title");
        JSArray options = call.getArray("options");
        if (options == null) {
            call.reject("Нужен список options");
            return;
        }
        if (getActivity().isFinishing()) {
            call.reject("Активити завершается");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                show(call, title, options);
            } catch (JSONException error) {
                call.reject("Некорректный пункт панели", error);
            }
        });
    }

    private void show(PluginCall call, String title, JSArray options) throws JSONException {
        Context context = getActivity();
        BottomSheetDialog dialog = new BottomSheetDialog(context, R.style.AppBottomSheet);
        LinearLayout root = new LinearLayout(context);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(0, 0, 0, dp(context, 8));

        // Ручка перетаскивания, как у системных панелей Material 3.
        root.addView(new BottomSheetDragHandleView(context));

        if (title != null && !title.isEmpty()) {
            TextView header = new TextView(context);
            header.setText(title);
            header.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            header.setTextColor(themeColor(context, android.R.attr.textColorSecondary));
            header.setPadding(dp(context, 24), dp(context, 4), dp(context, 24), dp(context, 12));
            root.addView(header);
        }

        for (int index = 0; index < options.length(); index++) {
            JSONObject option = options.getJSONObject(index);
            String style = option.optString("style", "DEFAULT");
            TextView item = new TextView(context);
            item.setText(option.optString("title", ""));
            item.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
            item.setGravity(Gravity.CENTER_VERTICAL);
            item.setMinHeight(dp(context, 56));
            item.setPadding(dp(context, 24), 0, dp(context, 24), 0);
            // Отклик на нажатие — системная волна.
            item.setBackgroundResource(themeResource(context, android.R.attr.selectableItemBackground));
            if (STYLE_DESTRUCTIVE.equals(style)) {
                item.setTextColor(themeColor(context, android.R.attr.colorError));
            } else if (STYLE_CANCEL.equals(style)) {
                item.setTextColor(themeColor(context, android.R.attr.textColorSecondary));
                item.setTypeface(Typeface.DEFAULT_BOLD);
            } else {
                item.setTextColor(themeColor(context, android.R.attr.textColorPrimary));
            }
            final int selected = index;
            item.setOnClickListener((View view) -> {
                dialog.setOnCancelListener(null);
                resolve(call, selected);
                dialog.dismiss();
            });
            root.addView(item);
        }

        dialog.setOnCancelListener(ignored -> resolve(call, -1));
        dialog.setContentView(root);
        dialog.show();
    }

    private static void resolve(PluginCall call, int index) {
        JSObject result = new JSObject();
        result.put("index", index);
        result.put("canceled", index < 0);
        call.resolve(result);
    }

    private static int dp(Context context, int value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, context.getResources().getDisplayMetrics()));
    }

    /** Цвет из атрибута темы активити (следует светлой/тёмной теме). */
    private static int themeColor(Context context, int attribute) {
        TypedArray values = context.obtainStyledAttributes(new int[] { attribute });
        int color = values.getColor(0, 0);
        values.recycle();
        return color;
    }

    /** Ресурс drawable из атрибута темы активити. */
    private static int themeResource(Context context, int attribute) {
        TypedValue value = new TypedValue();
        context.getTheme().resolveAttribute(attribute, value, true);
        return value.resourceId;
    }
}
