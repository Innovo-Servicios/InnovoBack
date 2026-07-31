const assert = require('node:assert/strict');
const test = require('node:test');
const {
  extractBearerToken,
  getWhatsappPanelExpectedToken,
  isValidWhatsappPanelToken,
} = require('../src/controllers/whatsappPanel.controller.js');

test('extracts WhatsApp panel bearer token', () => {
  assert.equal(extractBearerToken('Bearer panel-secret'), 'panel-secret');
  assert.equal(extractBearerToken('Basic panel-secret'), null);
  assert.equal(extractBearerToken(''), null);
});

test('validates WhatsApp panel token with timing-safe comparison', () => {
  assert.equal(isValidWhatsappPanelToken('panel-secret', 'panel-secret'), true);
  assert.equal(isValidWhatsappPanelToken('panel-secret', 'other-secret'), false);
  assert.equal(isValidWhatsappPanelToken('', 'panel-secret'), false);
  assert.equal(isValidWhatsappPanelToken('panel-secret', ''), false);
});

test('prefers dedicated WhatsApp panel token over bot webhook token', () => {
  const previousPanelToken = process.env.WHATSAPP_WEB_PANEL_TOKEN;
  const previousBotToken = process.env.BOT_WHATSAPP_WEBHOOK_TOKEN;

  process.env.WHATSAPP_WEB_PANEL_TOKEN = 'panel-token';
  process.env.BOT_WHATSAPP_WEBHOOK_TOKEN = 'bot-token';
  assert.equal(getWhatsappPanelExpectedToken(), 'panel-token');

  if (previousPanelToken === undefined) {
    delete process.env.WHATSAPP_WEB_PANEL_TOKEN;
  } else {
    process.env.WHATSAPP_WEB_PANEL_TOKEN = previousPanelToken;
  }

  if (previousBotToken === undefined) {
    delete process.env.BOT_WHATSAPP_WEBHOOK_TOKEN;
  } else {
    process.env.BOT_WHATSAPP_WEBHOOK_TOKEN = previousBotToken;
  }
});
