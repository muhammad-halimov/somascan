package com.somascan.app;

import com.getcapacitor.JSObject;
import com.hierynomus.smbj.share.DiskShare;

/**
 * Операции на общей папке по имени — общие для плагина {@link SmbSharePlugin} (экран приложения)
 * и движка очереди {@link UploadEngine} (фоновая запись таблицы). Аргументы и результаты — как в
 * контракте веб-части ({@code src/features/uploads/smb/smbFiles.ts}): пути через {@code /},
 * содержимое файлов — base64.
 */
final class SmbOps {

    private SmbOps() {}

    /** Выполняет операцию {@code op} над подключённой общей папкой. */
    static JSObject run(SmbShareClient client, DiskShare share, String op, JSObject args) throws Exception {
        switch (op) {
            case "probe":
                return client.probe(share, path(args, "path"));
            case "read": {
                JSObject result = new JSObject();
                result.put("data", client.read(share, path(args, "path")));
                return result;
            }
            case "write":
                client.write(share, path(args, "path"), SmbShareClient.decode(string(args, "data")));
                return new JSObject();
            case "commit": {
                String backup = args.getString("backupPath");
                return client.commit(share, path(args, "path"), SmbShareClient.decode(string(args, "data")), backup == null ? null : SmbShareClient.toSmbPath(backup));
            }
            case "rename":
                client.rename(share, path(args, "from"), path(args, "to"));
                return new JSObject();
            case "remove":
                client.remove(share, path(args, "path"));
                return new JSObject();
            case "list": {
                JSObject result = new JSObject();
                result.put("entries", client.list(share, path(args, "path")));
                return result;
            }
            case "mkdir":
                client.mkdir(share, path(args, "path"));
                return new JSObject();
            case "mkdirs":
                client.mkdirs(share, path(args, "path"));
                return new JSObject();
            default:
                throw new SmbShareClient.Failure("invalidArgs", "Неизвестная операция " + op);
        }
    }

    /** Обязательный строковый аргумент. */
    private static String string(JSObject args, String name) throws SmbShareClient.Failure {
        String value = args.getString(name);
        if (value == null) {
            throw new SmbShareClient.Failure("invalidArgs", "Нужен аргумент " + name);
        }
        return value;
    }

    /** Обязательный путь, переведённый в формат SMB. */
    private static String path(JSObject args, String name) throws SmbShareClient.Failure {
        return SmbShareClient.toSmbPath(string(args, name));
    }
}
