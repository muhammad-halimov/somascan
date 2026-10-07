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
или `127.0.0.1:1445` для симулятора iOS, общая папка `Warehouse`, путь `Somascan\labels.xlsx`,
пользователь `scanner`, пароль `scanner123`. Файлы появляются в папке `share` на компьютере.

`smb.conf` здесь нарочно без `vfs_fruit` и `streams_xattr` (их включает образ по умолчанию):
на папке, примонтированной с macOS, они отвечают `STATUS_NOT_SUPPORTED` на удаление и переименование,
а реальный сервер Windows так себя не ведёт.
