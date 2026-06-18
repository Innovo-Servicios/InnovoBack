const moment = require('moment-timezone');
const { ate_MongooseModel } = require('../models/ATE.model.js');
const { direccion_MongooseModel: DIRECCION } = require('../models/direccion.model.js');
const { medidor_MongooseModel: MEDIDOR } = require('../models/medidor.model.js');
const { sector_MongooseModel: SECTOR } = require('../models/sector.model.js');
const { trabajador_MongooseModel } = require('../models/trabajador.model.js');
const { TipoNovedad } = require('../models/tipoNovedad.model.js');
const {
    createSystemNotificationForWorkers,
} = require('../controllers/notificaciones.controller.js');

const ATE_OVERDUE_TIMEZONE = 'America/Santiago';
const ATE_OVERDUE_BATCH_SIZE = Number.parseInt(
    process.env.ATE_OVERDUE_NOTIFICATION_BATCH_SIZE || '100',
    10
);
const ATE_OVERDUE_NOTIFICATIONS_PAUSED_VALUES = new Set(['1', 'true', 'yes', 'on', 'si', 'sí']);

const isAteOverdueNotificationsPaused = () =>
    ATE_OVERDUE_NOTIFICATIONS_PAUSED_VALUES.has(
        String(process.env.ATE_OVERDUE_NOTIFICATIONS_PAUSED || '')
            .trim()
            .toLowerCase()
    );

const buildAteOverdueWindow = (referenceDate = new Date()) => {
    const now = moment(referenceDate).tz(ATE_OVERDUE_TIMEZONE);
    return {
        now: now.toDate(),
        startOfToday: now.clone().startOf('day').toDate(),
    };
};

const buildNotNotifiedTodayQuery = (startOfToday) => ({
    $or: [
        { atrasoNotificacionEnviadaAt: { $exists: false } },
        { atrasoNotificacionEnviadaAt: null },
        { atrasoNotificacionEnviadaAt: { $lt: startOfToday } },
    ],
});

const buildOverdueAteReminderQuery = (referenceDate = new Date()) => {
    const { startOfToday } = buildAteOverdueWindow(referenceDate);

    return {
        Trabajador: { $exists: true, $ne: null },
        estado: { $ne: true },
        fecha_ate: { $lt: startOfToday },
        ...buildNotNotifiedTodayQuery(startOfToday),
    };
};

const formatAteDate = (date) =>
    moment(date).tz(ATE_OVERDUE_TIMEZONE).format('DD/MM/YYYY');

const getOverdueDays = (ateDate, referenceDate = new Date()) => {
    if (!ateDate) {
        return 0;
    }

    const currentDay = moment(referenceDate).tz(ATE_OVERDUE_TIMEZONE).startOf('day');
    const ateDay = moment(ateDate).tz(ATE_OVERDUE_TIMEZONE).startOf('day');
    return Math.max(1, currentDay.diff(ateDay, 'days'));
};

const buildOverdueMessage = (ate, referenceDate = new Date()) => {
    const overdueDays = getOverdueDays(ate.fecha_ate, referenceDate);
    const dayLabel = overdueDays === 1 ? '1 día' : `${overdueDays} días`;
    return `Tienes una atención especial atrasada hace ${dayLabel}.`;
};

const getAteContext = async (ate) => {
    const direccion = ate.direccion
        ? await DIRECCION.findById(ate.direccion).lean()
        : null;
    const [medidor, sector, tipo] = await Promise.all([
        direccion?.NumeroMedidor ? MEDIDOR.findById(direccion.NumeroMedidor).lean() : null,
        direccion?.NumeroSector ? SECTOR.findById(direccion.NumeroSector).lean() : null,
        ate.tipo ? TipoNovedad.findById(ate.tipo).lean() : null,
    ]);

    return { direccion, medidor, sector, tipo };
};

const buildOverdueContent = (ate, context) => {
    const lines = [
        'Tienes una atención especial pendiente vencida.',
        ate.fecha_ate ? `Fecha ATE: ${formatAteDate(ate.fecha_ate)}` : null,
        context.tipo?.value ? `Tipo: ${context.tipo.value}` : null,
        context.direccion?.calle ? `Dirección: ${context.direccion.calle}` : null,
        context.medidor?.NumeroMedidor ? `Medidor: ${context.medidor.NumeroMedidor}` : null,
        context.sector?.sector ? `Sector: ${context.sector.sector}` : null,
        ate.comentario ? `Comentario: ${ate.comentario}` : null,
    ];

    return lines.filter(Boolean).join('\n');
};

const claimAteForDailyOverdueReminder = (ateId, referenceDate = new Date()) => {
    const { now, startOfToday } = buildAteOverdueWindow(referenceDate);
    return ate_MongooseModel.findOneAndUpdate(
        {
            _id: ateId,
            Trabajador: { $exists: true, $ne: null },
            estado: { $ne: true },
            fecha_ate: { $lt: startOfToday },
            ...buildNotNotifiedTodayQuery(startOfToday),
        },
        {
            $set: {
                atrasoNotificacionEnviadaAt: now,
            },
        },
        { new: true }
    );
};

const notifyOverdueAte = async ({ ate, io, referenceDate = new Date() }) => {
    const claimedAte = await claimAteForDailyOverdueReminder(ate._id, referenceDate);
    if (!claimedAte) {
        return { status: 'skipped' };
    }

    const trabajador = await trabajador_MongooseModel.findById(claimedAte.Trabajador);
    if (!trabajador) {
        return { status: 'skipped' };
    }

    const context = await getAteContext(claimedAte);
    const fecha = buildAteOverdueWindow(referenceDate).now;
    const metadata = {
        ateId: claimedAte._id.toString(),
        ateAtrasada: true,
        refreshAte: true,
        fechaAte: claimedAte.fecha_ate ? moment(claimedAte.fecha_ate).toISOString() : null,
    };
    const nuevaNotificacion = await createSystemNotificationForWorkers({
        trabajadores: [trabajador],
        tipo: 'alert',
        titulo: 'Atención especial atrasada',
        mensaje: buildOverdueMessage(claimedAte, referenceDate),
        contenido: buildOverdueContent(claimedAte, context),
        fecha,
        metadata,
        io,
    });

    await ate_MongooseModel.updateOne(
        { _id: claimedAte._id },
        {
            $set: {
                atrasoNotificacion: nuevaNotificacion._id,
                atrasoNotificacionEnviadaAt: fecha,
            },
        }
    );

    return {
        status: 'notified',
        ateId: claimedAte._id.toString(),
        notificationId: nuevaNotificacion._id.toString(),
    };
};

const dispatchAteOverdueNotifications = async ({
    io,
    referenceDate = new Date(),
} = {}) => {
    if (isAteOverdueNotificationsPaused()) {
        console.log('Notificaciones de ATE atrasadas pausadas por configuración.');
        return {
            total: 0,
            notified: 0,
            skipped: 0,
            failed: 0,
            paused: true,
        };
    }

    const batchSize = Number.isFinite(ATE_OVERDUE_BATCH_SIZE)
        ? ATE_OVERDUE_BATCH_SIZE
        : 100;
    const ates = await ate_MongooseModel
        .find(buildOverdueAteReminderQuery(referenceDate))
        .sort({ fecha_ate: 1, _id: 1 })
        .limit(batchSize)
        .lean();
    const summary = {
        total: ates.length,
        notified: 0,
        skipped: 0,
        failed: 0,
    };

    for (const ate of ates) {
        try {
            const result = await notifyOverdueAte({ ate, io, referenceDate });
            if (result.status === 'notified') {
                summary.notified += 1;
            } else {
                summary.skipped += 1;
            }
        } catch (error) {
            summary.failed += 1;
            console.error(
                `Error al notificar ATE atrasada ${ate._id}: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    return summary;
};

module.exports = {
    ATE_OVERDUE_TIMEZONE,
    buildAteOverdueWindow,
    buildOverdueAteReminderQuery,
    buildOverdueMessage,
    dispatchAteOverdueNotifications,
    getOverdueDays,
    isAteOverdueNotificationsPaused,
};
