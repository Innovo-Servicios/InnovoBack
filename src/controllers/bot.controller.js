const {
  buildGmailBotWhatsAppMessage,
  extractBearerToken,
  getBotWhatsAppResultRecipient,
  isValidBotWhatsappWebhookToken,
  normalizeErrorMessage,
} = require('../utils/gmailBotWhatsappNotification.js');
const {
  sendWhatsAppMessageToRecipient,
} = require('../utils/whatsappClient.js');

const enviarResultadoBotGmailWhatsapp = async (req, res) => {
  const expectedToken = process.env.BOT_WHATSAPP_WEBHOOK_TOKEN;
  if (!expectedToken) {
    return res.status(503).json({
      message: 'BOT_WHATSAPP_WEBHOOK_TOKEN no configurado',
    });
  }

  const providedToken = extractBearerToken(req.headers.authorization);
  if (!providedToken) {
    return res.status(401).json({ message: 'No autorizado' });
  }

  if (!isValidBotWhatsappWebhookToken(providedToken, expectedToken)) {
    return res.status(403).json({ message: 'Token invalido' });
  }

  const message = buildGmailBotWhatsAppMessage(req.body);
  const recipient = getBotWhatsAppResultRecipient();

  try {
    const result = await sendWhatsAppMessageToRecipient(
      message,
      recipient,
      'BOT_WHATSAPP_RESULT_RECIPIENT'
    );

    return res.status(200).json({
      message: 'Resultado del bot enviado por WhatsApp',
      sent: result.sent,
      status: result.status || 'sent',
      chatId: result.chatId || null,
    });
  } catch (error) {
    return res.status(503).json({
      message: 'No se pudo enviar el resultado por WhatsApp',
      error: normalizeErrorMessage(error),
    });
  }
};

module.exports = {
  enviarResultadoBotGmailWhatsapp,
};
