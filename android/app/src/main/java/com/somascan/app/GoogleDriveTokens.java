package com.somascan.app;

import android.content.Context;
import android.content.SharedPreferences;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.CommonStatusCodes;
import com.google.android.gms.common.api.Scope;
import java.util.Collections;
import java.util.List;

/**
 * Токен доступа к Google Drive без интерфейса — для экрана ({@link GoogleDriveAuthPlugin#getAccessToken})
 * и для движка очереди {@link UploadEngine}, который пишет таблицу и при закрытом приложении.
 *
 * Работает только после входа в настройках ({@code signIn}): тогда Google выдаёт свежий токен сам.
 * Если нужен пользователь (доступ отозван, сменился пароль) — отказ {@code authRequired}.
 */
final class GoogleDriveTokens {

    /** Настройки входа (общие с плагином). */
    static final String PREFS = "somascan.googleDrive";
    static final String KEY_SIGNED_IN = "signedIn";
    static final String KEY_TOKEN = "lastToken";

    /** Область доступа к Drive (как {@code DRIVE_SCOPE} в веб-части). */
    static final String DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

    /** Итог запроса токена. */
    interface Callback {
        void onToken(String token);

        void onFailure(String code, String message, Exception error);
    }

    private GoogleDriveTokens() {}

    /** Токен с доступом к Drive. */
    static void fetch(Context context, Callback callback) {
        fetch(context, Collections.singletonList(new Scope(DRIVE_SCOPE)), callback);
    }

    /** Токен с нужными областями; {@code context} может быть контекстом приложения (без экрана). */
    static void fetch(Context context, List<Scope> scopes, Callback callback) {
        if (!prefs(context).getBoolean(KEY_SIGNED_IN, false)) {
            callback.onFailure("notSignedIn", "Вход в Google не выполнен", null);
            return;
        }
        AuthorizationRequest request = AuthorizationRequest.builder().setRequestedScopes(scopes).build();
        Identity.getAuthorizationClient(context).authorize(request)
            .addOnSuccessListener(result -> {
                if (result.hasResolution()) {
                    // Без пользователя дальше нельзя: он войдёт заново в настройках.
                    callback.onFailure("authRequired", "Нужно войти в Google заново", null);
                    return;
                }
                String token = result.getAccessToken();
                if (token == null || token.isEmpty()) {
                    callback.onFailure("authRequired", "Google не выдал токен доступа", null);
                    return;
                }
                remember(context, token);
                callback.onToken(token);
            })
            .addOnFailureListener(error -> callback.onFailure(codeOf(error), messageOf(error), error));
    }

    /** Запоминает успешный вход и последний токен (его отзывают при выходе). */
    static void remember(Context context, String token) {
        prefs(context).edit().putBoolean(KEY_SIGNED_IN, true).putString(KEY_TOKEN, token).apply();
    }

    /** Код отказа для веб-части по ошибке Google. */
    static String codeOf(Exception error) {
        if (error instanceof ApiException) {
            int status = ((ApiException) error).getStatusCode();
            if (status == CommonStatusCodes.DEVELOPER_ERROR) {
                return "notConfigured";
            }
            if (status == CommonStatusCodes.CANCELED) {
                return "cancelled";
            }
            if (status == CommonStatusCodes.SIGN_IN_REQUIRED) {
                return "authRequired";
            }
        }
        return "io";
    }

    /** Сообщение для веб-части по ошибке Google. */
    static String messageOf(Exception error) {
        if ("notConfigured".equals(codeOf(error))) {
            return "Вход через Google не настроен: нет OAuth-клиента Android для этой подписи приложения";
        }
        return error.getMessage() == null ? "Ошибка входа Google" : error.getMessage();
    }

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
