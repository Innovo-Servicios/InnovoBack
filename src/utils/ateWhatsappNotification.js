const moment = require('moment-timezone');
const { ate_MongooseModel } = require('../models/ATE.model.js');
const { direccion_MongooseModel: DIRECCION } = require('../models/direccion.model.js');
const { medidor_MongooseModel: MEDIDOR } = require('../models/medidor.model.js');
const { cliente_MongooseModel: CLIENTE } = require('../models/cliente.model.js');
const { trabajador_MongooseModel } = require('../models/trabajador.model.js');
const { TipoNovedad } = require('../models/tipoNovedad.model.js');
const {
  isAteWhatsAppEnabled,
  sendAteWhatsAppMessage,
} = require('./whatsappClient.js');

const CHILE_TZ = 'America/Santiago';
const ERROR_MAX_LENGTH = 1000;

const formatOptional = (value, fallback = 'Sin informacion') => {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }

  return String(value).trim();
};

const formatDate = (value) => {
  if (!value) return 'Sin fecha';
  const date = moment(value).tz(CHILE_TZ);
  return date.isValid() ? date.format('DD-MM-YYYY HH:mm') : 'Fecha invalida';
};

const normalizeError = (error) => {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > ERROR_MAX_LENGTH ? `${message.slice(0, ERROR_MAX_LENGTH - 3)}...` : message;
};

const claimAteWhatsappNotification = (ateId) =>
  ate_MongooseModel.findOneAndUpdate(
    {
      _id: ateId,
      estado: true,
      $or: [
        { whatsappNotificacionIntentadaAt: { $exists: false } },
        { whatsappNotificacionIntentadaAt: null },
      ],
    },
    {
      $set: {
        whatsappNotificacionIntentadaAt: moment().tz(CHILE_TZ).toDate(),
        whatsappNotificacionEstado: 'pendiente',
        whatsappNotificacionError: null,
      },
    },
    { new: true }
  ).lean();

const loadAteWhatsappContext = async (ate) => {
  const [direccion, tipo, trabajador] = await Promise.all([
    ate.direccion ? DIRECCION.findById(ate.direccion).lean() : Promise.resolve(null),
    ate.tipo ? TipoNovedad.findById(ate.tipo).lean() : Promise.resolve(null),
    ate.Trabajador ? trabajador_MongooseModel.findById(ate.Trabajador).lean() : Promise.resolve(null),
  ]);

  const medidor = direccion?.NumeroMedidor
    ? await MEDIDOR.findById(direccion.NumeroMedidor).lean()
    : null;
  const cliente = medidor?.NumeroCliente
    ? await CLIENTE.findById(medidor.NumeroCliente).lean()
    : null;

  return { ate, cliente, direccion, medidor, tipo, trabajador };
};

const buildAteWhatsappMessage = ({
  ate,
  cliente,
  direccion,
  medidor,
  tipo,
  trabajador,
}) => {
  const lines = [
    '*Atencion especial completada*',
    `Tipo: ${formatOptional(tipo?.value)}`,
    `Direccion: ${formatOptional(direccion?.calle)}`,
    `Medidor: ${formatOptional(medidor?.NumeroMedidor)}`,
    `Cliente: ${formatOptional(cliente?.NumeroCliente)}`,
    `Trabajador: ${formatOptional(trabajador?.Nombre, 'Sin trabajador asignado')}`,
    `Fecha ATE: ${formatDate(ate.fecha_ate)}`,
    `Respondida: ${formatDate(ate.respuesta)}`,
  ];

  if (ate.comentario) {
    lines.push(`Observacion ATE: ${formatOptional(ate.comentario)}`);
  }

  if (ate.respuestaComentario) {
    lines.push(`Comentario respuesta: ${formatOptional(ate.respuestaComentario)}`);
  }

  if (ate.Lecturacorrecta !== undefined && ate.Lecturacorrecta !== null) {
    lines.push(`Lectura correcta: ${ate.Lecturacorrecta}`);
  }

  lines.push(`ID ATE: ${ate._id}`);
  return lines.join('\n');
};

const markAteWhatsappSent = (ateId) =>
  ate_MongooseModel.findByIdAndUpdate(ateId, {
    $set: {
      whatsappNotificacionEstado: 'enviada',
      whatsappNotificacionEnviadaAt: moment().tz(CHILE_TZ).toDate(),
      whatsappNotificacionError: null,
    },
  });

const markAteWhatsappError = (ateId, error) =>
  ate_MongooseModel.findByIdAndUpdate(ateId, {
    $set: {
      whatsappNotificacionEstado: 'error',
      whatsappNotificacionError: normalizeError(error),
    },
  });

const notifyAteCompletedByWhatsApp = async (ateId) => {
  if (!isAteWhatsAppEnabled()) {
    return { sent: false, skipped: 'disabled' };
  }

  const ate = await claimAteWhatsappNotification(ateId);
  if (!ate) {
    return { sent: false, skipped: 'already_attempted' };
  }

  try {
    const context = await loadAteWhatsappContext(ate);
    const message = buildAteWhatsappMessage(context);
    const result = await sendAteWhatsAppMessage(message);
    await markAteWhatsappSent(ate._id);
    console.log(`[WhatsApp ATE] Notificacion enviada para ATE ${ate._id}`);
    return result;
  } catch (error) {
    await markAteWhatsappError(ate._id, error);
    console.error(`[WhatsApp ATE] Error al enviar ATE ${ate._id}: ${normalizeError(error)}`);
    return { sent: false, error: normalizeError(error) };
  }
};

const scheduleAteWhatsappNotification = (ateId) => {
  if (!isAteWhatsAppEnabled()) return;

  setImmediate(() => {
    notifyAteCompletedByWhatsApp(ateId).catch((error) => {
      console.error(`[WhatsApp ATE] Error inesperado al notificar ATE ${ateId}: ${normalizeError(error)}`);
    });
  });
};

module.exports = {
  buildAteWhatsappMessage,
  notifyAteCompletedByWhatsApp,
  scheduleAteWhatsappNotification,
};
