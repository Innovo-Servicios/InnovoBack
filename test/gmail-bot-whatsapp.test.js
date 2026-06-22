const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeWhatsAppChatId,
} = require('../src/utils/whatsappClient.js');
const {
  buildGmailBotWhatsAppMessage,
  countErrors,
  extractBearerToken,
  isValidBotWhatsappWebhookToken,
} = require('../src/utils/gmailBotWhatsappNotification.js');

test('normalizes Chilean WhatsApp recipient to chat id', () => {
  assert.equal(normalizeWhatsAppChatId('+56 9 9296 0138'), '56992960138@c.us');
  assert.equal(normalizeWhatsAppChatId('56992960138@c.us'), '56992960138@c.us');
  assert.equal(normalizeWhatsAppChatId(''), null);
});

test('validates bot WhatsApp webhook bearer token', () => {
  assert.equal(extractBearerToken('Bearer shared-secret'), 'shared-secret');
  assert.equal(isValidBotWhatsappWebhookToken('shared-secret', 'shared-secret'), true);
  assert.equal(isValidBotWhatsappWebhookToken('wrong-secret', 'shared-secret'), false);
  assert.equal(isValidBotWhatsappWebhookToken(null, 'shared-secret'), false);
});

test('builds successful Gmail bot WhatsApp result message', () => {
  const message = buildGmailBotWhatsAppMessage({
    status: 'ok',
    finishedAt: '2026-06-19T09:00:00.000Z',
    summary: {
      mode: 'gmail',
      emailsMatched: 13,
      attachmentsDownloaded: 13,
      attachmentsAlreadyProcessed: 0,
      filesProcessed: 13,
      created: 25,
      skippedExisting: 10,
      errors: [],
    },
  });

  assert.match(message, /\*Bot ATE Gmail analizado\*/);
  assert.match(message, /Fecha: 19-06-2026 05:00/);
  assert.match(message, /Estado: OK/);
  assert.match(message, /Correos encontrados: 13/);
  assert.match(message, /ATE creadas: 25/);
  assert.match(message, /ATE existentes omitidas: 10/);
  assert.match(message, /Errores: 0/);
});

test('builds failed Gmail bot WhatsApp result message with partial summary', () => {
  const message = buildGmailBotWhatsAppMessage({
    status: 'error',
    finishedAt: '2026-06-19T09:00:00.000Z',
    error: 'Gmail no pudo buscar correos',
    summary: {
      emailsMatched: 2,
      errors: ['archivo.xls: fila invalida'],
    },
  });

  assert.equal(countErrors({ errors: ['uno', 'dos'] }), 2);
  assert.match(message, /\*Bot ATE Gmail fallo\*/);
  assert.match(message, /Estado: ERROR/);
  assert.match(message, /Error: Gmail no pudo buscar correos/);
  assert.match(message, /Correos encontrados: 2/);
  assert.match(message, /Errores: 1/);
});
