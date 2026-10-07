package com.somascan.app;

import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.hierynomus.msdtyp.AccessMask;
import com.hierynomus.mserref.NtStatus;
import com.hierynomus.msfscc.FileAttributes;
import com.hierynomus.msfscc.fileinformation.FileAllInformation;
import com.hierynomus.msfscc.fileinformation.FileIdBothDirectoryInformation;
import com.hierynomus.mssmb2.SMB2CreateDisposition;
import com.hierynomus.mssmb2.SMB2CreateOptions;
import com.hierynomus.mssmb2.SMB2ShareAccess;
import com.hierynomus.mssmb2.SMBApiException;
import com.hierynomus.smbj.SMBClient;
import com.hierynomus.smbj.SmbConfig;
import com.hierynomus.smbj.auth.AuthenticationContext;
import com.hierynomus.smbj.connection.Connection;
import com.hierynomus.smbj.session.Session;
import com.hierynomus.smbj.share.DiskEntry;
import com.hierynomus.smbj.share.DiskShare;
import com.hierynomus.smbj.share.File;
import com.hierynomus.smbj.share.Share;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ConnectException;
import java.net.NoRouteToHostException;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.security.MessageDigest;
import java.util.EnumSet;
import java.util.Locale;
import java.util.Objects;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Файловые операции на общей папке Windows (SMB 2/3) через библиотеку smbj.
 *
 * Держит одно соединение на последние параметры подключения и переподключается, если сервер
 * закрыл сессию. Не потокобезопасен: все вызовы идут из единственного потока {@link SmbSharePlugin},
 * поэтому операции выполняются строго по одной.
 *
 * Пути приходят от веб-части через {@code /} относительно корня общей папки и здесь
 * переводятся в формат SMB ({@code папка\файл}). Ошибки превращаются в {@link Failure}
 * с кодом, который понимает веб-часть ({@code UploadError}).
 */
final class SmbShareClient {

    /** Параметры подключения. */
    static final class Target {
        final String host;
        final int port;
        final String share;
        final String domain;
        final String username;
        final String password;

        Target(String host, int port, String share, String domain, String username, String password) {
            this.host = host;
            this.port = port;
            this.share = share;
            this.domain = domain;
            this.username = username;
            this.password = password;
        }

        /** Читает параметры из аргумента {@code connection} вызова плагина. */
        static Target from(JSObject object) throws Failure {
            if (object == null) {
                throw new Failure("invalidArgs", "Нужны параметры подключения (connection)");
            }
            String host = object.getString("host", "").trim();
            String share = object.getString("share", "").trim();
            int port = object.getInteger("port", 445);
            if (host.isEmpty() || share.isEmpty()) {
                throw new Failure("invalidArgs", "Не заданы сервер или общая папка");
            }
            return new Target(host, port, share, object.getString("domain", ""), object.getString("username", ""), object.getString("password", ""));
        }

        @Override
        public boolean equals(Object other) {
            if (!(other instanceof Target)) {
                return false;
            }
            Target that = (Target) other;
            return port == that.port
                && host.equals(that.host)
                && share.equals(that.share)
                && domain.equals(that.domain)
                && username.equals(that.username)
                && password.equals(that.password);
        }

        @Override
        public int hashCode() {
            return Objects.hash(host, port, share, domain, username, password);
        }
    }

    /** Сбой с кодом для веб-части. */
    static final class Failure extends Exception {
        final String code;

        Failure(String code, String message) {
            super(message);
            this.code = code;
        }

        Failure(String code, String message, Throwable cause) {
            super(message, cause);
            this.code = code;
        }
    }

    /** Операция над подключённой общей папкой. */
    interface Operation<T> {
        T run(DiskShare share) throws Exception;
    }

    /** Признак папки в атрибутах файла. */
    private static final long DIRECTORY_FLAG = FileAttributes.FILE_ATTRIBUTE_DIRECTORY.getValue();

    /** Суффикс временного файла при атомарной замене. */
    private static final String TMP_SUFFIX = ".tmp";

    private final SMBClient client = new SMBClient(
        SmbConfig.builder()
            .withTimeout(20, TimeUnit.SECONDS)
            .withSoTimeout(30, TimeUnit.SECONDS)
            .build()
    );

    private Target cachedTarget;
    private Connection connection;
    private Session session;
    private DiskShare share;

    /**
     * Выполняет операцию на общей папке. Если соединение протухло (сервер закрыл сессию,
     * сменилась сеть), переподключается и повторяет операцию один раз.
     */
    <T> T run(Target target, Operation<T> operation) throws Failure {
        try {
            return operation.run(open(target));
        } catch (Failure failure) {
            throw failure;
        } catch (SMBApiException error) {
            // Ответ сервера со статусом: соединение живо, повторять бессмысленно.
            throw translate(error);
        } catch (Exception first) {
            disconnect();
            try {
                return operation.run(open(target));
            } catch (Exception second) {
                throw translate(second);
            }
        }
    }

    /** Закрывает соединение (если есть). */
    void disconnect() {
        try {
            if (share != null) {
                share.close();
            }
        } catch (Exception ignored) {
            // Соединение уже могло быть разорвано.
        }
        try {
            if (session != null) {
                session.close();
            }
        } catch (Exception ignored) {
            // То же.
        }
        try {
            if (connection != null) {
                connection.close();
            }
        } catch (Exception ignored) {
            // То же.
        }
        share = null;
        session = null;
        connection = null;
        cachedTarget = null;
    }

    /** Текущее соединение с нужными параметрами или новое. */
    private DiskShare open(Target target) throws IOException, Failure {
        if (share != null && target.equals(cachedTarget) && connection != null && connection.isConnected() && share.isConnected()) {
            return share;
        }
        disconnect();
        Connection fresh = client.connect(target.host, target.port);
        Session freshSession;
        try {
            freshSession = fresh.authenticate(new AuthenticationContext(target.username, target.password.toCharArray(), target.domain));
        } catch (RuntimeException error) {
            fresh.close();
            throw error;
        }
        Share connected;
        try {
            connected = freshSession.connectShare(target.share);
        } catch (RuntimeException error) {
            fresh.close();
            throw error;
        }
        if (!(connected instanceof DiskShare)) {
            fresh.close();
            throw new Failure("shareNotFound", "«" + target.share + "» — не файловая папка");
        }
        connection = fresh;
        session = freshSession;
        share = (DiskShare) connected;
        cachedTarget = target;
        return share;
    }

    // ---- Операции -------------------------------------------------------------------------

    /** Сведения о файле или папке; {@code exists: false}, если пути нет. */
    JSObject probe(DiskShare share, String path) throws Exception {
        JSObject result = new JSObject();
        if (path.isEmpty()) {
            return stat(result, true, true, 0, 0);
        }
        try {
            FileAllInformation info = share.getFileInformation(path);
            long attributes = info.getBasicInformation().getFileAttributes();
            return stat(
                result,
                true,
                (attributes & DIRECTORY_FLAG) != 0,
                info.getStandardInformation().getEndOfFile(),
                info.getBasicInformation().getLastWriteTime().toEpochMillis()
            );
        } catch (SMBApiException error) {
            if (isNotFound(error.getStatus())) {
                return stat(result, false, false, 0, 0);
            }
            throw error;
        }
    }

    /** Содержимое файла в base64. */
    String read(DiskShare share, String path) throws Exception {
        return Base64.encodeToString(readBytes(share, path), Base64.NO_WRAP);
    }

    /** Создаёт файл или перезаписывает существующий. */
    void write(DiskShare share, String path, byte[] data) throws Exception {
        writeBytes(share, path, data, SMB2CreateDisposition.FILE_OVERWRITE_IF);
    }

    /**
     * Атомарная замена файла: временный файл рядом → перечитать и сверить SHA-256 →
     * прежний файл переименовать в резервную копию (или удалить, если копия не нужна) →
     * временный переименовать в целевой → сверить размер.
     */
    JSObject commit(DiskShare share, String path, byte[] data, String backupPath) throws Exception {
        String tmp = path + TMP_SUFFIX;
        ensureParent(share, path);
        writeBytes(share, tmp, data, SMB2CreateDisposition.FILE_OVERWRITE_IF);
        String hash = sha256(data);
        if (!hash.equals(sha256(readBytes(share, tmp)))) {
            try {
                share.rm(tmp);
            } catch (Exception ignored) {
                // Главное — не подменять таблицу повреждённым файлом.
            }
            throw new Failure("verifyFailed", "Временный файл прочитан не таким, каким был записан");
        }
        if (share.fileExists(path)) {
            if (backupPath != null && !backupPath.isEmpty()) {
                ensureParent(share, backupPath);
                rename(share, path, backupPath);
            } else {
                share.rm(path);
            }
        }
        rename(share, tmp, path);
        long size = share.getFileInformation(path).getStandardInformation().getEndOfFile();
        if (size != data.length) {
            throw new Failure("verifyFailed", "Размер файла после замены не совпал: " + size + " вместо " + data.length);
        }
        JSObject result = new JSObject();
        result.put("hash", hash);
        result.put("size", size);
        return result;
    }

    /** Переименовывает файл или папку; цель не должна существовать. */
    void rename(DiskShare share, String from, String to) throws Exception {
        try (DiskEntry entry = share.open(
            from,
            EnumSet.of(AccessMask.DELETE, AccessMask.FILE_READ_ATTRIBUTES),
            null,
            SMB2ShareAccess.ALL,
            SMB2CreateDisposition.FILE_OPEN,
            null
        )) {
            entry.rename(to, false);
        }
    }

    /** Удаляет файл или папку со всем содержимым. */
    void remove(DiskShare share, String path) throws Exception {
        FileAllInformation info = share.getFileInformation(path);
        if ((info.getBasicInformation().getFileAttributes() & DIRECTORY_FLAG) != 0) {
            share.rmdir(path, true);
        } else {
            share.rm(path);
        }
    }

    /** Содержимое папки без {@code .} и {@code ..}. */
    JSArray list(DiskShare share, String path) throws Exception {
        JSArray entries = new JSArray();
        for (FileIdBothDirectoryInformation info : share.list(path)) {
            String name = info.getFileName();
            if (".".equals(name) || "..".equals(name)) {
                continue;
            }
            JSObject entry = new JSObject();
            entry.put("name", name);
            entry.put("isDirectory", (info.getFileAttributes() & DIRECTORY_FLAG) != 0);
            entry.put("size", info.getEndOfFile());
            entry.put("modifiedAt", info.getLastWriteTime().toEpochMillis());
            entries.put(entry);
        }
        return entries;
    }

    /** Создаёт одну папку; если она уже есть — ошибка {@code exists}. */
    void mkdir(DiskShare share, String path) throws Exception {
        share.mkdir(path);
    }

    /** Создаёт папку вместе с родительскими; существующие пропускает. */
    void mkdirs(DiskShare share, String path) throws Exception {
        if (path.isEmpty()) {
            return;
        }
        StringBuilder current = new StringBuilder();
        for (String segment : path.split("\\\\")) {
            if (segment.isEmpty()) {
                continue;
            }
            if (current.length() > 0) {
                current.append('\\');
            }
            current.append(segment);
            String prefix = current.toString();
            if (share.folderExists(prefix)) {
                continue;
            }
            try {
                share.mkdir(prefix);
            } catch (SMBApiException error) {
                if (error.getStatus() != NtStatus.STATUS_OBJECT_NAME_COLLISION) {
                    throw error;
                }
            }
        }
    }

    // ---- Вспомогательное -------------------------------------------------------------------

    /** Путь веб-части ({@code папка/файл}) в формат SMB ({@code папка\файл}). */
    static String toSmbPath(String path) {
        String converted = path.replace('/', '\\');
        int start = 0;
        int end = converted.length();
        while (start < end && converted.charAt(start) == '\\') {
            start++;
        }
        while (end > start && converted.charAt(end - 1) == '\\') {
            end--;
        }
        return converted.substring(start, end);
    }

    /** Декодирует base64 из аргумента вызова. */
    static byte[] decode(String base64) throws Failure {
        try {
            return Base64.decode(base64, Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            throw new Failure("invalidArgs", "Данные не в base64");
        }
    }

    private static JSObject stat(JSObject result, boolean exists, boolean isDirectory, long size, long modifiedAt) {
        result.put("exists", exists);
        result.put("isDirectory", isDirectory);
        result.put("size", size);
        result.put("modifiedAt", modifiedAt);
        return result;
    }

    private static byte[] readBytes(DiskShare share, String path) throws Exception {
        try (
            File file = share.openFile(path, EnumSet.of(AccessMask.GENERIC_READ), null, SMB2ShareAccess.ALL, SMB2CreateDisposition.FILE_OPEN, null);
            InputStream in = file.getInputStream()
        ) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
            return out.toByteArray();
        }
    }

    private static void writeBytes(DiskShare share, String path, byte[] data, SMB2CreateDisposition disposition) throws Exception {
        try (
            File file = share.openFile(
                path,
                EnumSet.of(AccessMask.GENERIC_WRITE),
                EnumSet.of(FileAttributes.FILE_ATTRIBUTE_NORMAL),
                EnumSet.of(SMB2ShareAccess.FILE_SHARE_READ),
                disposition,
                EnumSet.of(SMB2CreateOptions.FILE_NON_DIRECTORY_FILE)
            );
            OutputStream out = file.getOutputStream()
        ) {
            out.write(data);
            out.flush();
        }
    }

    /** Создаёт папку файла, если её нет. */
    private void ensureParent(DiskShare share, String path) throws Exception {
        int slash = path.lastIndexOf('\\');
        if (slash > 0) {
            mkdirs(share, path.substring(0, slash));
        }
    }

    private static String sha256(byte[] data) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(data);
        StringBuilder hex = new StringBuilder(digest.length * 2);
        for (byte b : digest) {
            hex.append(String.format(Locale.ROOT, "%02x", b));
        }
        return hex.toString();
    }

    private static boolean isNotFound(NtStatus status) {
        return status == NtStatus.STATUS_OBJECT_NAME_NOT_FOUND
            || status == NtStatus.STATUS_OBJECT_PATH_NOT_FOUND
            || status == NtStatus.STATUS_NO_SUCH_FILE
            || status == NtStatus.STATUS_DELETE_PENDING;
    }

    /** Переводит исключения smbj и сети в {@link Failure} с кодом для веб-части. */
    static Failure translate(Exception error) {
        if (error instanceof Failure) {
            return (Failure) error;
        }
        if (error instanceof SMBApiException) {
            NtStatus status = ((SMBApiException) error).getStatus();
            String message = status + ": " + error.getMessage();
            switch (status) {
                case STATUS_LOGON_FAILURE:
                case STATUS_ACCOUNT_DISABLED:
                case STATUS_PASSWORD_EXPIRED:
                    return new Failure("authFailed", message, error);
                case STATUS_BAD_NETWORK_NAME:
                    return new Failure("shareNotFound", message, error);
                case STATUS_OBJECT_NAME_NOT_FOUND:
                case STATUS_OBJECT_PATH_NOT_FOUND:
                case STATUS_NO_SUCH_FILE:
                case STATUS_DELETE_PENDING:
                    return new Failure("notFound", message, error);
                case STATUS_OBJECT_NAME_COLLISION:
                    return new Failure("exists", message, error);
                case STATUS_ACCESS_DENIED:
                    return new Failure("accessDenied", message, error);
                case STATUS_SHARING_VIOLATION:
                case STATUS_FILE_LOCK_CONFLICT:
                case STATUS_LOCK_NOT_GRANTED:
                    return new Failure("locked", message, error);
                case STATUS_IO_TIMEOUT:
                    return new Failure("timeout", message, error);
                default:
                    return new Failure("io", message, error);
            }
        }
        Throwable root = error;
        while (root.getCause() != null && root.getCause() != root) {
            root = root.getCause();
        }
        String message = error.getClass().getSimpleName() + ": " + error.getMessage();
        if (root instanceof SocketTimeoutException || root instanceof TimeoutException) {
            return new Failure("timeout", message, error);
        }
        if (root instanceof UnknownHostException
            || root instanceof ConnectException
            || root instanceof NoRouteToHostException
            || root instanceof SocketException
            || root instanceof IOException) {
            return new Failure("hostUnreachable", message, error);
        }
        return new Failure("io", message, error);
    }
}
