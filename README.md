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
export BOT_WHATSAPP_RESULT_RECIPIENT="56992960138"
export BOT_WHATSAPP_WEBHOOK_TOKEN="secreto-compartido-con-el-backend"
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

## WhatsApp para ATE completadas

Cuando una atencion especial queda completada, el backend puede enviar un WhatsApp
desde WhatsApp Web. La sesion se inicia con QR por consola y se guarda localmente
en `storage/whatsapp-auth`.

Variables opcionales:

```bash
WHATSAPP_ATE_ENABLED=true
WHATSAPP_ATE_RECIPIENT=56977090807
WHATSAPP_AUTH_PATH=storage/whatsapp-auth
WHATSAPP_HEADLESS=true
WHATSAPP_WEB_PANEL_TOKEN=token-seguro-para-el-panel
```

Al iniciar el backend por primera vez, escanea el QR que aparece en consola. Una
vez autenticado, el log debe mostrar `WhatsApp listo`.

El backend tambien expone un panel grafico en `/whatsapp-web` para ver el estado
de la sesion local, mostrar el QR cuando exista uno pendiente, reiniciar el
cliente y enviar un mensaje de prueba. Las APIs del panel requieren
`Authorization: Bearer <WHATSAPP_WEB_PANEL_TOKEN>`. Si esa variable no esta
definida, se usa `BOT_WHATSAPP_WEBHOOK_TOKEN` como compatibilidad.

## WhatsApp con resultado del bot Gmail

Cada ejecucion de `scripts/bot.py` puede avisar el resultado al WhatsApp
configurado en `BOT_WHATSAPP_RESULT_RECIPIENT`. El bot llama al backend local en
`POST /bot/gmail-ate/whatsapp-result`, protegido con `BOT_WHATSAPP_WEBHOOK_TOKEN`,
para reutilizar la misma sesion de WhatsApp Web.
