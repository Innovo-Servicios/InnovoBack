const crypto = require('node:crypto');
const path = require('node:path');
const QRCode = require('qrcode');
const {
  getAteWhatsAppStatus,
  getLatestAteWhatsAppQr,
  initializeAteWhatsAppClient,
  normalizeWhatsAppChatId,
  restartAteWhatsAppClient,
  sendWhatsAppMessageToRecipient,
} = require('../utils/whatsappClient.js');

const PANEL_SCRIPT_PATH = path.resolve(__dirname, '../../public/whatsapp-panel/panel.js');
const MAX_MESSAGE_LENGTH = 4096;

const getWhatsappPanelExpectedToken = () =>
  process.env.WHATSAPP_WEB_PANEL_TOKEN || process.env.BOT_WHATSAPP_WEBHOOK_TOKEN || '';

const extractBearerToken = (authorizationHeader) => {
  if (!authorizationHeader || typeof authorizationHeader !== 'string') {
    return null;
  }

  const [scheme, ...tokenParts] = authorizationHeader.trim().split(/\s+/);
  if (scheme !== 'Bearer' || tokenParts.length === 0) {
    return null;
  }

  return tokenParts.join(' ').trim() || null;
};

const extractWhatsappPanelToken = (req) =>
  extractBearerToken(req.headers.authorization) ||
  (typeof req.headers['x-whatsapp-panel-token'] === 'string'
    ? req.headers['x-whatsapp-panel-token'].trim()
    : null);

const timingSafeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const isValidWhatsappPanelToken = (providedToken, expectedToken = getWhatsappPanelExpectedToken()) => {
  if (!providedToken || !expectedToken) {
    return false;
  }

  return timingSafeEqual(providedToken, expectedToken);
};

const requireWhatsappPanelToken = (req, res, next) => {
  const expectedToken = getWhatsappPanelExpectedToken();
  if (!expectedToken) {
    return res.status(503).json({
      message: 'WHATSAPP_WEB_PANEL_TOKEN no configurado',
    });
  }

  const providedToken = extractWhatsappPanelToken(req);
  if (!providedToken) {
    return res.status(401).json({ message: 'No autorizado' });
  }

  if (!isValidWhatsappPanelToken(providedToken, expectedToken)) {
    return res.status(403).json({ message: 'Token invalido' });
  }

  return next();
};

const renderWhatsappPanel = (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WhatsApp Web</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f6f8;
      --panel: #ffffff;
      --text: #172026;
      --muted: #65717b;
      --border: #d7dde2;
      --accent: #128c7e;
      --accent-dark: #0c6f63;
      --danger: #b42318;
      --warn: #b7791f;
      --ok: #16803c;
      --shadow: 0 1px 3px rgba(15, 23, 42, 0.12);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-size: 14px;
    }
    .shell {
      width: min(1180px, calc(100% - 32px));
      margin: 0 auto;
      padding: 24px 0 32px;
    }
    header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 18px;
    }
    h1 {
      margin: 0;
      font-size: 28px;
      line-height: 1.1;
      letter-spacing: 0;
    }
    .subtitle {
      margin: 6px 0 0;
      color: var(--muted);
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 0.95fr) minmax(340px, 1.05fr);
      gap: 16px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      box-shadow: var(--shadow);
    }
    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px 18px;
      border-bottom: 1px solid var(--border);
    }
    .panel-title {
      margin: 0;
      font-size: 16px;
      font-weight: 700;
      letter-spacing: 0;
    }
    .panel-body { padding: 18px; }
    .toolbar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      min-height: 32px;
      padding: 0 12px;
      border-radius: 999px;
      font-weight: 700;
      background: #eef2f5;
      color: var(--muted);
      white-space: nowrap;
    }
    .status-pill.ok { background: #dff7e8; color: var(--ok); }
    .status-pill.warn { background: #fff4d7; color: var(--warn); }
    .status-pill.danger { background: #fde7e4; color: var(--danger); }
    .fields {
      display: grid;
      gap: 12px;
    }
    label {
      display: grid;
      gap: 6px;
      color: var(--muted);
      font-weight: 650;
    }
    input, textarea {
      width: 100%;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 11px;
      font: inherit;
      color: var(--text);
      background: #fff;
    }
    textarea {
      min-height: 148px;
      resize: vertical;
      line-height: 1.45;
    }
    input:focus, textarea:focus {
      outline: 2px solid rgba(18, 140, 126, 0.18);
      border-color: var(--accent);
    }
    button {
      min-height: 38px;
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 0 13px;
      font: inherit;
      font-weight: 750;
      cursor: pointer;
      background: #edf1f3;
      color: var(--text);
    }
    button.primary {
      background: var(--accent);
      color: #fff;
    }
    button.primary:hover { background: var(--accent-dark); }
    button.ghost {
      border-color: var(--border);
      background: #fff;
    }
    button:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .meta-list {
      display: grid;
      gap: 10px;
      margin: 0;
    }
    .meta-row {
      display: grid;
      grid-template-columns: 150px minmax(0, 1fr);
      gap: 12px;
      padding-bottom: 10px;
      border-bottom: 1px solid #eef1f3;
    }
    .meta-row:last-child {
      border-bottom: 0;
      padding-bottom: 0;
    }
    .meta-label {
      color: var(--muted);
      font-weight: 700;
    }
    .meta-value {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .qr-frame {
      display: grid;
      place-items: center;
      min-height: 270px;
      border: 1px dashed var(--border);
      border-radius: 8px;
      background: #fbfcfd;
    }
    .qr-frame img {
      width: min(260px, 82vw);
      height: auto;
      image-rendering: pixelated;
    }
    .empty {
      color: var(--muted);
      text-align: center;
      padding: 0 16px;
      line-height: 1.45;
    }
    .notice {
      min-height: 40px;
      margin-top: 12px;
      padding: 10px 12px;
      border-radius: 6px;
      border: 1px solid var(--border);
      color: var(--muted);
      background: #fbfcfd;
    }
    .notice.ok { border-color: #9ad8ae; color: var(--ok); background: #f0fbf3; }
    .notice.warn { border-color: #e6c56b; color: #805400; background: #fff9e8; }
    .notice.danger { border-color: #eeaaa2; color: var(--danger); background: #fff1ef; }
    .hidden { display: none !important; }
    @media (max-width: 860px) {
      .shell { width: min(100% - 20px, 1180px); padding-top: 16px; }
      header { display: grid; }
      .grid { grid-template-columns: 1fr; }
      .meta-row { grid-template-columns: 1fr; gap: 4px; }
      .panel-header { align-items: flex-start; flex-direction: column; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <div>
        <h1>WhatsApp Web</h1>
        <p class="subtitle">Sesion local del backend GPI</p>
      </div>
      <span id="statusPill" class="status-pill">Sin token</span>
    </header>

    <section class="panel" id="tokenPanel">
      <div class="panel-header">
        <h2 class="panel-title">Acceso</h2>
      </div>
      <div class="panel-body">
        <div class="fields">
          <label>
            Token del panel
            <input id="tokenInput" type="password" autocomplete="current-password">
          </label>
          <div class="toolbar">
            <button id="saveTokenButton" class="primary" type="button">Conectar</button>
            <button id="clearTokenButton" class="ghost" type="button">Olvidar token</button>
          </div>
        </div>
        <div id="tokenNotice" class="notice hidden"></div>
      </div>
    </section>

    <section class="grid" id="appGrid">
      <section class="panel">
        <div class="panel-header">
          <h2 class="panel-title">Estado</h2>
          <div class="toolbar">
            <button id="refreshButton" class="ghost" type="button">Actualizar</button>
            <button id="initializeButton" type="button">Iniciar</button>
            <button id="restartButton" type="button">Reiniciar</button>
          </div>
        </div>
        <div class="panel-body">
          <dl class="meta-list">
            <div class="meta-row"><dt class="meta-label">Cuenta</dt><dd id="accountValue" class="meta-value">-</dd></div>
            <div class="meta-row"><dt class="meta-label">Destino ATE</dt><dd id="recipientValue" class="meta-value">-</dd></div>
            <div class="meta-row"><dt class="meta-label">Auth local</dt><dd id="authPathValue" class="meta-value">-</dd></div>
            <div class="meta-row"><dt class="meta-label">Ultimo listo</dt><dd id="readyAtValue" class="meta-value">-</dd></div>
            <div class="meta-row"><dt class="meta-label">Ultimo error</dt><dd id="errorValue" class="meta-value">-</dd></div>
          </dl>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2 class="panel-title">QR</h2>
          <span id="qrTimeValue" class="subtitle">-</span>
        </div>
        <div class="panel-body">
          <div class="qr-frame">
            <img id="qrImage" class="hidden" alt="QR de WhatsApp Web">
            <div id="qrEmpty" class="empty">No hay QR pendiente.</div>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2 class="panel-title">Mensaje</h2>
        </div>
        <div class="panel-body">
          <form id="sendForm" class="fields">
            <label>
              Numero o chat ID
              <input id="recipientInput" name="recipient" inputmode="tel" placeholder="+56 9 1234 5678">
            </label>
            <label>
              Texto
              <textarea id="messageInput" name="message" maxlength="4096"></textarea>
            </label>
            <div class="toolbar">
              <button id="sendButton" class="primary" type="submit">Enviar</button>
            </div>
          </form>
          <div id="sendNotice" class="notice hidden"></div>
        </div>
      </section>
    </section>
  </main>
  <script src="/whatsapp-web/panel.js"></script>
</body>
</html>`);
};

const sendPanelScript = (_req, res) => {
  res.type('application/javascript').sendFile(PANEL_SCRIPT_PATH);
};

const buildPanelStatusPayload = async () => {
  const status = getAteWhatsAppStatus();
  const latestQr = getLatestAteWhatsAppQr();

  if (!latestQr) {
    return {
      ...status,
      qr: null,
    };
  }

  const imageDataUrl = await QRCode.toDataURL(latestQr.value, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 260,
  });

  return {
    ...status,
    qr: {
      imageDataUrl,
      updatedAt: latestQr.updatedAt,
    },
  };
};

const getWhatsappPanelStatus = async (_req, res) => {
  const status = await buildPanelStatusPayload();
  return res.status(200).json(status);
};

const initializeWhatsappPanelClient = async (_req, res) => {
  initializeAteWhatsAppClient();
  const status = await buildPanelStatusPayload();
  return res.status(202).json(status);
};

const restartWhatsappPanelClient = async (_req, res) => {
  await restartAteWhatsAppClient();
  const status = await buildPanelStatusPayload();
  return res.status(202).json(status);
};

const sendWhatsappPanelMessage = async (req, res) => {
  const recipient = String(req.body?.recipient || '').trim();
  const message = String(req.body?.message || '').trim();

  if (!normalizeWhatsAppChatId(recipient)) {
    return res.status(400).json({ message: 'Numero o chat ID invalido' });
  }

  if (!message) {
    return res.status(400).json({ message: 'Mensaje requerido' });
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ message: `Mensaje demasiado largo. Maximo ${MAX_MESSAGE_LENGTH} caracteres` });
  }

  try {
    const result = await sendWhatsAppMessageToRecipient(message, recipient, 'WHATSAPP_PANEL_RECIPIENT');
    return res.status(200).json({
      message: 'Mensaje enviado',
      sent: result.sent,
      status: result.status || 'sent',
      chatId: result.chatId || null,
    });
  } catch (error) {
    return res.status(503).json({
      message: 'No se pudo enviar el mensaje',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

module.exports = {
  buildPanelStatusPayload,
  extractBearerToken,
  extractWhatsappPanelToken,
  getWhatsappPanelExpectedToken,
  getWhatsappPanelStatus,
  initializeWhatsappPanelClient,
  isValidWhatsappPanelToken,
  renderWhatsappPanel,
  requireWhatsappPanelToken,
  restartWhatsappPanelClient,
  sendPanelScript,
  sendWhatsappPanelMessage,
};
