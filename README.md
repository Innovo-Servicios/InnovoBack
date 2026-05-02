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
export BOT_EMAIL_SINCE="2026-05-02"
export BOT_DOWNLOAD_FOLDER="/home/innovo/backend/GPI/storage/descargas"
```

Ejecucion local sin conectar a Gmail:

```bash
python scripts/bot.py --local-only
```

Ejecucion completa:

```bash
python scripts/bot.py
```
