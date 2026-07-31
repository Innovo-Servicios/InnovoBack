const fs = require('node:fs');
const path = require('node:path');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

const DISABLED_VALUES = new Set(['false', '0', 'no', 'off']);
const ENABLED_VALUES = new Set(['true', '1', 'yes', 'on']);

let client = null;
let isReady = false;
let isInitializing = false;
let lastError = null;
let latestQr = null;
let latestQrAt = null;
let authenticatedAt = null;
let readyAt = null;
let disconnectedAt = null;

const parseBooleanEnv = (value, defaultValue) => {
  if (value === undefined || value === null || String(value).trim() === '') {
    return defaultValue;
  }

  const normalizedValue = String(value).trim().toLowerCase();
  if (ENABLED_VALUES.has(normalizedValue)) return true;
  if (DISABLED_VALUES.has(normalizedValue)) return false;
  return defaultValue;
};

const isAteWhatsAppEnabled = () =>
  !DISABLED_VALUES.has(String(process.env.WHATSAPP_ATE_ENABLED ?? 'true').trim().toLowerCase());

const getAteWhatsAppAuthPath = () =>
  path.resolve(process.cwd(), process.env.WHATSAPP_AUTH_PATH || 'storage/whatsapp-auth');

const normalizeWhatsAppChatId = (rawRecipient) => {
  const normalizedRecipient = String(rawRecipient || '').trim();
  if (!normalizedRecipient) return null;
  if (normalizedRecipient.includes('@')) return normalizedRecipient;

  const onlyDigits = normalizedRecipient.replace(/\D/g, '');
  return onlyDigits ? `${onlyDigits}@c.us` : null;
};

const getAteWhatsAppRecipient = () => process.env.WHATSAPP_ATE_RECIPIENT || '56977090807';

const getAteWhatsAppRecipientChatId = () => normalizeWhatsAppChatId(getAteWhatsAppRecipient());

const buildPuppeteerOptions = () => {
  const options = {
    headless: parseBooleanEnv(process.env.WHATSAPP_HEADLESS, true),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };

  if (process.env.WHATSAPP_CHROME_PATH) {
    options.executablePath = process.env.WHATSAPP_CHROME_PATH;
  }

  return options;
};

const formatDate = (date) => (date instanceof Date ? date.toISOString() : null);

const getClientAccount = () => {
  if (!client?.info) {
    return null;
  }

  return {
    pushname: client.info.pushname || null,
    wid: client.info.wid?._serialized || client.info.wid?.user || null,
    platform: client.info.platform || null,
  };
};

const getAteWhatsAppStatus = () => ({
  enabled: isAteWhatsAppEnabled(),
  ready: isReady,
  initializing: isInitializing,
  hasClient: Boolean(client),
  authPath: getAteWhatsAppAuthPath(),
  recipientChatId: getAteWhatsAppRecipientChatId(),
  account: getClientAccount(),
  lastError: lastError ? lastError.message : null,
  latestQrAt: formatDate(latestQrAt),
  authenticatedAt: formatDate(authenticatedAt),
  readyAt: formatDate(readyAt),
  disconnectedAt: formatDate(disconnectedAt),
  headless: parseBooleanEnv(process.env.WHATSAPP_HEADLESS, true),
});

const getLatestAteWhatsAppQr = () => {
  if (!latestQr) {
    return null;
  }

  return {
    value: latestQr,
    updatedAt: formatDate(latestQrAt),
  };
};

const initializeAteWhatsAppClient = () => {
  if (!isAteWhatsAppEnabled()) {
    console.log('[WhatsApp ATE] Envio deshabilitado por WHATSAPP_ATE_ENABLED');
    return null;
  }

  if (client || isInitializing) {
    return client;
  }

  try {
    const dataPath = getAteWhatsAppAuthPath();
    fs.mkdirSync(dataPath, { recursive: true });

    isInitializing = true;
    isReady = false;
    lastError = null;

    const nextClient = new Client({
      authStrategy: new LocalAuth({
        clientId: 'ate-notifier',
        dataPath,
      }),
      puppeteer: buildPuppeteerOptions(),
    });
    client = nextClient;
    const isCurrentClient = () => client === nextClient;

    nextClient.on('qr', (qr) => {
      if (!isCurrentClient()) return;
      latestQr = qr;
      latestQrAt = new Date();
      isReady = false;
      console.log('[WhatsApp ATE] Escanea este QR con WhatsApp Web para iniciar sesion:');
      qrcode.generate(qr, { small: true });
    });

    nextClient.on('authenticated', () => {
      if (!isCurrentClient()) return;
      authenticatedAt = new Date();
      console.log('[WhatsApp ATE] WhatsApp autenticado');
    });

    nextClient.on('ready', () => {
      if (!isCurrentClient()) return;
      isReady = true;
      isInitializing = false;
      lastError = null;
      latestQr = null;
      latestQrAt = null;
      readyAt = new Date();
      console.log('[WhatsApp ATE] WhatsApp listo');
    });

    nextClient.on('auth_failure', (message) => {
      if (!isCurrentClient()) return;
      isReady = false;
      isInitializing = false;
      lastError = new Error(`Fallo de autenticacion: ${message || 'sin detalle'}`);
      latestQr = null;
      latestQrAt = null;
      console.error(`[WhatsApp ATE] ${lastError.message}`);
    });

    nextClient.on('disconnected', (reason) => {
      if (!isCurrentClient()) return;
      isReady = false;
      isInitializing = false;
      lastError = new Error(`Cliente desconectado: ${reason || 'sin detalle'}`);
      client = null;
      disconnectedAt = new Date();
      console.warn(`[WhatsApp ATE] ${lastError.message}`);
    });

    nextClient.initialize().catch((error) => {
      if (!isCurrentClient()) return;
      isReady = false;
      isInitializing = false;
      lastError = error instanceof Error ? error : new Error(String(error));
      client = null;
      console.error(`[WhatsApp ATE] Error al inicializar WhatsApp: ${lastError.message}`);
    });

    return nextClient;
  } catch (error) {
    isReady = false;
    isInitializing = false;
    lastError = error instanceof Error ? error : new Error(String(error));
    client = null;
    console.error(`[WhatsApp ATE] Error al preparar WhatsApp: ${lastError.message}`);
    return null;
  }
};

const restartAteWhatsAppClient = async () => {
  const activeClient = client;
  client = null;
  isReady = false;
  isInitializing = false;
  latestQr = null;
  latestQrAt = null;

  if (activeClient) {
    try {
      await activeClient.destroy();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  return initializeAteWhatsAppClient();
};

const sendWhatsAppMessageToRecipient = async (
  message,
  recipient,
  recipientLabel = 'WHATSAPP_ATE_RECIPIENT'
) => {
  if (!isAteWhatsAppEnabled()) {
    return { sent: false, status: 'disabled' };
  }

  if (!client && !isInitializing) {
    initializeAteWhatsAppClient();
  }

  if (!client || !isReady) {
    const reason = lastError ? ` ${lastError.message}` : ' Escanea el QR en consola.';
    throw new Error(`WhatsApp no esta listo.${reason}`);
  }

  const chatId = normalizeWhatsAppChatId(recipient);
  if (!chatId) {
    throw new Error(`${recipientLabel} no contiene un numero valido`);
  }

  await client.sendMessage(chatId, message);
  return { sent: true, chatId };
};

const sendAteWhatsAppMessage = async (message, options = {}) =>
  sendWhatsAppMessageToRecipient(
    message,
    options.recipient ?? getAteWhatsAppRecipient(),
    options.recipientLabel || 'WHATSAPP_ATE_RECIPIENT'
  );

module.exports = {
  getAteWhatsAppStatus,
  getAteWhatsAppRecipientChatId,
  getLatestAteWhatsAppQr,
  initializeAteWhatsAppClient,
  isAteWhatsAppEnabled,
  normalizeWhatsAppChatId,
  restartAteWhatsAppClient,
  sendAteWhatsAppMessage,
  sendWhatsAppMessageToRecipient,
};
