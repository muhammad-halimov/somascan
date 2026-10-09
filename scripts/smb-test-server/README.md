# Локальный SMB-сервер для проверки выгрузки

Samba в Docker, чтобы проверять запись таблицы без файлового сервера завода.

```bash
mkdir -p share
docker run -d --name somascan-smb -p 1445:445 \
  -e NAME=Warehouse -e USER=scanner -e PASS=scanner123 \
  -v "$PWD/share:/storage" \
  -v "$PWD/smb.conf:/etc/samba/smb.conf:ro" \
  dockurr/samba
```

В приложении («Настройки → Хранилище → Сетевой диск»): сервер `10.0.2.2:1445` для эмулятора Android
или `127.0.0.1:1445` для симулятора iOS, общая папка `Warehouse`, путь к таблице — например `Probe otel.xlsx`,
пользователь `scanner`, пароль `scanner123`. Общая папка — папка `share` на компьютере. Приложение таблицу
не создаёт: положите туда копию журнала или пустой журнал `tests/fixtures/Probe otel.xlsx`; резервные копии
(`backups/`) и блокировка появятся рядом с ним.

`smb.conf` здесь нарочно без `vfs_fruit` и `streams_xattr` (их включает образ по умолчанию):
на папке, примонтированной с macOS, они отвечают `STATUS_NOT_SUPPORTED` на удаление и переименование,
а реальный сервер Windows так себя не ведёт.
