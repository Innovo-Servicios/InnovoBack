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

    client = new Client({
      authStrategy: new LocalAuth({
        clientId: 'ate-notifier',
        dataPath,
      }),
      puppeteer: buildPuppeteerOptions(),
    });

    client.on('qr', (qr) => {
      console.log('[WhatsApp ATE] Escanea este QR con WhatsApp Web para iniciar sesion:');
      qrcode.generate(qr, { small: true });
    });

    client.on('authenticated', () => {
      console.log('[WhatsApp ATE] WhatsApp autenticado');
    });

    client.on('ready', () => {
      isReady = true;
      isInitializing = false;
      lastError = null;
      console.log('[WhatsApp ATE] WhatsApp listo');
    });

    client.on('auth_failure', (message) => {
      isReady = false;
      isInitializing = false;
      lastError = new Error(`Fallo de autenticacion: ${message || 'sin detalle'}`);
      console.error(`[WhatsApp ATE] ${lastError.message}`);
    });

    client.on('disconnected', (reason) => {
      isReady = false;
      isInitializing = false;
      lastError = new Error(`Cliente desconectado: ${reason || 'sin detalle'}`);
      client = null;
      console.warn(`[WhatsApp ATE] ${lastError.message}`);
    });

    client.initialize().catch((error) => {
      isReady = false;
      isInitializing = false;
      lastError = error instanceof Error ? error : new Error(String(error));
      client = null;
      console.error(`[WhatsApp ATE] Error al inicializar WhatsApp: ${lastError.message}`);
    });

    return client;
  } catch (error) {
    isReady = false;
    isInitializing = false;
    lastError = error instanceof Error ? error : new Error(String(error));
    client = null;
    console.error(`[WhatsApp ATE] Error al preparar WhatsApp: ${lastError.message}`);
    return null;
  }
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
  getAteWhatsAppRecipientChatId,
  initializeAteWhatsAppClient,
  isAteWhatsAppEnabled,
  normalizeWhatsAppChatId,
  sendAteWhatsAppMessage,
  sendWhatsAppMessageToRecipient,
};
