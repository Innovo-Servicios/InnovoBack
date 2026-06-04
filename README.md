# InnovoBack

## Bot de Gmail

El script `scripts/bot.py` descarga adjuntos `.xls` desde Gmail y extrae numeros de medidor desde la columna `Direccion`.

Dependencias Python:

```bash
python3 -m venv .venv-bot
source .venv-bot/bin/activate
python -m pip install -r scripts/requirements-bot.txt
```

Variables requeridas para conectar a Gmail:

```bash
export BOT_GMAIL_USERNAME="correo@gmail.com"
export BOT_GMAIL_APP_PASSWORD="app-password-de-gmail"
```

Variables opcionales:

```bash
export BOT_EMAIL_SUBJECT="Atenciones Especiales"
export BOT_EMAIL_SINCE="YYYY-MM-DD" # opcional; omitir para buscar solo desde hoy
export BOT_DOWNLOAD_FOLDER="/home/innovo/backend/GPI/storage/descargas"
export BOT_BACKEND_URL="http://localhost:30001"
export BOT_ALERT_EMAIL_TO="morbemon2012@gmail.com"
export BOT_PROCESSED_STATE_FILE="/home/innovo/backend/GPI/storage/gmail-bot-processed-ates.json"
```

Validacion local sin conectar a Gmail ni crear ATE reales:

```bash
python scripts/bot.py --local-only --dry-run
```

Ejecucion completa:

```bash
python scripts/bot.py
```

### Automatizacion con systemd

El bot queda preparado para ejecutarse con `gpi-gmail-bot.timer` cada 8 horas:

```bash
systemctl status gpi-gmail-bot.timer
systemctl list-timers --all | grep gpi-gmail-bot
journalctl -u gpi-gmail-bot.service -n 100 --no-pager
```

El estado resumido de la ultima ejecucion se actualiza automaticamente en:

```bash
cat final_service_status.txt
cat service_error.txt
```

Tambien se puede refrescar manualmente con:

```bash
/usr/local/sbin/gpi-gmail-bot-status.sh write
```

Antes de que la ejecucion real contra Gmail funcione, completa en `.env`:

```bash
BOT_GMAIL_USERNAME="correo@gmail.com"
BOT_GMAIL_APP_PASSWORD="app-password-de-gmail"
```
