package com.somascan.app;

import android.accounts.Account;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.Context;
import android.content.SharedPreferences;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationClient;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.ClearTokenRequest;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.auth.api.identity.RevokeAccessRequest;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONException;

/**
 * Вход через Google для записи таблицы в Drive (Google Identity AuthorizationClient).
 *
 * {@code signIn} показывает выбор аккаунта и согласие на доступ к Drive; после этого
 * {@code getAccessToken} получает свежий токен без интерфейса ({@link GoogleDriveTokens}; так же
 * токен берёт движок очереди, который пишет таблицу и при закрытом приложении). Если Google требует участия пользователя (доступ отозван, сменился пароль),
 * {@code getAccessToken} отвечает {@code authRequired}, а не открывает окно из фона.
 *
 * Настройка: в Google Cloud Console — OAuth-клиент типа Android с именем пакета
 * {@code com.somascan.app} и SHA-1 ключа подписи (см. README, раздел про Google Drive).
 */
@CapacitorPlugin(name = "GoogleDriveAuth")
public class GoogleDriveAuthPlugin extends Plugin {

    private ActivityResultLauncher<IntentSenderRequest> resolutionLauncher;
    /** Вызов {@code signIn}, ждущий окна согласия. */
    private PluginCall pendingSignIn;

    @Override
    public void load() {
        // Регистрировать запуск окна можно только до старта активити — плагины загружаются в onCreate.
        resolutionLauncher = getActivity().registerForActivityResult(
            new ActivityResultContracts.StartIntentSenderForResult(),
            this::onResolution
        );
    }

    @PluginMethod
    public void signIn(PluginCall call) {
        AuthorizationRequest request;
        try {
            request = requestFor(call);
        } catch (JSONException error) {
            call.reject("Нужен список scopes", "invalidArgs");
            return;
        }
        if (pendingSignIn != null) {
            call.reject("Вход уже идёт", "busy");
            return;
        }
        client().authorize(request)
            .addOnSuccessListener(result -> {
                if (result.hasResolution()) {
                    PendingIntent intent = result.getPendingIntent();
                    if (intent == null) {
                        call.reject("Google не вернул окно согласия", "authRequired");
                        return;
                    }
                    pendingSignIn = call;
                    resolutionLauncher.launch(new IntentSenderRequest.Builder(intent.getIntentSender()).build());
                } else {
                    resolveToken(call, result);
                }
            })
            .addOnFailureListener(error -> rejectFailure(call, error));
    }

    @PluginMethod
    public void getAccessToken(PluginCall call) {
        AuthorizationRequest request;
        try {
            request = requestFor(call);
        } catch (JSONException error) {
            call.reject("Нужен список scopes", "invalidArgs");
            return;
        }
        GoogleDriveTokens.fetch(getContext(), request.getRequestedScopes(), new GoogleDriveTokens.Callback() {
            @Override
            public void onToken(String token) {
                JSObject response = new JSObject();
                response.put("accessToken", token);
                call.resolve(response);
            }

            @Override
            public void onFailure(String code, String message, Exception error) {
                call.reject(message, code, error);
            }
        });
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        SharedPreferences prefs = GoogleDriveTokens.prefs(getContext());
        String token = prefs.getString(GoogleDriveTokens.KEY_TOKEN, null);
        String email = call.getString("email");
        prefs.edit().clear().apply();
        if (token != null) {
            client().clearToken(ClearTokenRequest.builder().setToken(token).build());
        }
        if (email != null && !email.isEmpty()) {
            List<Scope> scopes = new ArrayList<>();
            scopes.add(new Scope(GoogleDriveTokens.DRIVE_SCOPE));
            client().revokeAccess(
                RevokeAccessRequest.builder().setAccount(new Account(email, "com.google")).setScopes(scopes).build()
            );
        }
        call.resolve();
    }

    /** Результат окна согласия. */
    private void onResolution(ActivityResult activityResult) {
        PluginCall call = pendingSignIn;
        pendingSignIn = null;
        if (call == null) {
            return;
        }
        if (activityResult.getResultCode() != Activity.RESULT_OK || activityResult.getData() == null) {
            call.reject("Вход отменён", "cancelled");
            return;
        }
        try {
            AuthorizationResult result = client().getAuthorizationResultFromIntent(activityResult.getData());
            resolveToken(call, result);
        } catch (ApiException error) {
            rejectFailure(call, error);
        }
    }

    private void resolveToken(PluginCall call, AuthorizationResult result) {
        String token = result.getAccessToken();
        if (token == null || token.isEmpty()) {
            call.reject("Google не выдал токен доступа", "authRequired");
            return;
        }
        GoogleDriveTokens.remember(getContext(), token);
        JSObject response = new JSObject();
        response.put("accessToken", token);
        call.resolve(response);
    }

    private void rejectFailure(PluginCall call, Exception error) {
        call.reject(GoogleDriveTokens.messageOf(error), GoogleDriveTokens.codeOf(error), error);
    }

    private AuthorizationRequest requestFor(PluginCall call) throws JSONException {
        JSArray scopes = call.getArray("scopes");
        List<Scope> requested = new ArrayList<>();
        if (scopes != null) {
            for (int index = 0; index < scopes.length(); index++) {
                requested.add(new Scope(scopes.getString(index)));
            }
        }
        if (requested.isEmpty()) {
            throw new JSONException("scopes");
        }
        return AuthorizationRequest.builder().setRequestedScopes(requested).build();
    }

    private AuthorizationClient client() {
        Context context = getActivity() != null ? getActivity() : getContext();
        return Identity.getAuthorizationClient(context);
    }
}
