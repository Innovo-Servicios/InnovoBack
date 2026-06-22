const crypto = require('node:crypto');
const moment = require('moment-timezone');

const CHILE_TZ = 'America/Santiago';
const DEFAULT_RESULT_RECIPIENT = '56992960138';
const MAX_ERROR_LENGTH = 600;

const getBotWhatsAppResultRecipient = () =>
  process.env.BOT_WHATSAPP_RESULT_RECIPIENT || DEFAULT_RESULT_RECIPIENT;

const normalizeErrorMessage = (error) => {
  if (!error) return 'Sin detalle';
  const message = error instanceof Error ? error.message : String(error);
  return message.length > MAX_ERROR_LENGTH
    ? `${message.slice(0, MAX_ERROR_LENGTH - 3)}...`
    : message;
};

const firstNumber = (summary, keys) => {
  for (const key of keys) {
    const value = summary?.[key];
    if (Number.isFinite(Number(value))) {
      return Number(value);
    }
  }

  return 0;
};

const countErrors = (summary) => {
  if (Array.isArray(summary?.errors)) {
    return summary.errors.length;
  }

  return firstNumber(summary, ['errors', 'failedFiles']);
};

const formatChileDate = (value) => {
  const date = value ? moment(value) : moment();
  return date.isValid()
    ? date.tz(CHILE_TZ).format('DD-MM-YYYY HH:mm')
    : moment().tz(CHILE_TZ).format('DD-MM-YYYY HH:mm');
};

const buildSummaryLines = (summary = {}) => {
  const lines = [
    `Correos encontrados: ${firstNumber(summary, ['emailsMatched'])}`,
    `Adjuntos nuevos: ${firstNumber(summary, ['attachmentsDownloaded'])}`,
    `Adjuntos ya procesados: ${firstNumber(summary, ['attachmentsAlreadyProcessed'])}`,
    `Archivos procesados: ${firstNumber(summary, ['filesProcessed'])}`,
    `ATE creadas: ${firstNumber(summary, ['atesCreated', 'created'])}`,
    `ATE existentes omitidas: ${firstNumber(summary, ['atesSkippedExisting', 'skippedExisting'])}`,
  ];

  if (summary?.dryRun) {
    lines.push(`ATE que se crearian: ${firstNumber(summary, ['wouldCreate'])}`);
  }

  lines.push(`Errores: ${countErrors(summary)}`);
  return lines;
};

const buildGmailBotWhatsAppMessage = ({
  status = 'ok',
  finishedAt,
  summary = {},
  error = null,
} = {}) => {
  const isError = String(status).toLowerCase() !== 'ok' || Boolean(error);
  const lines = [
    isError ? '*Bot ATE Gmail fallo*' : '*Bot ATE Gmail analizado*',
    `Fecha: ${formatChileDate(finishedAt)}`,
    `Estado: ${isError ? 'ERROR' : 'OK'}`,
  ];

  if (summary?.mode) {
    lines.push(`Modo: ${summary.mode}`);
  }

  if (summary?.dryRun) {
    lines.push('Ejecucion: dry-run');
  }

  if (isError) {
    lines.push(`Error: ${normalizeErrorMessage(error)}`);
  }

  lines.push(...buildSummaryLines(summary));
  return lines.join('\n');
};

const extractBearerToken = (authorizationHeader) => {
  const match = String(authorizationHeader || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
};

const safeTokenEquals = (provided, expected) => {
  if (!provided || !expected) return false;

  const providedBuffer = Buffer.from(String(provided));
  const expectedBuffer = Buffer.from(String(expected));

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
};

const isValidBotWhatsappWebhookToken = (
  provided,
  expected = process.env.BOT_WHATSAPP_WEBHOOK_TOKEN
) => safeTokenEquals(provided, expected);

module.exports = {
  buildGmailBotWhatsAppMessage,
  countErrors,
  extractBearerToken,
  getBotWhatsAppResultRecipient,
  isValidBotWhatsappWebhookToken,
  normalizeErrorMessage,
};
