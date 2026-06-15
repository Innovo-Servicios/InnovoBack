const test = require('node:test');
const assert = require('node:assert/strict');
const moment = require('moment-timezone');

const {
    buildObtenerAtePendientesQuery,
    isAteAtrasada,
} = require('../src/middlewares/notificacion_asignacion.middleware.js');
const {
    buildOverdueAteReminderQuery,
    buildOverdueMessage,
    getOverdueDays,
} = require('../src/utils/ateOverdueNotifications.js');

test('obtenerATE query returns pending ATE up to the consulted day', () => {
    const trabajadorId = 'trabajador-1';
    const fechaFin = new Date('2026-06-08T23:59:59.999Z');

    assert.deepEqual(
        buildObtenerAtePendientesQuery({ trabajadorId, fechaFin }),
        {
            fecha_ate: { $lte: fechaFin },
            estado: { $ne: true },
            Trabajador: trabajadorId,
        }
    );
});

test('isAteAtrasada only marks ATE before the current local day', () => {
    const referenceDate = new Date('2026-06-08T16:00:00.000Z');

    assert.equal(isAteAtrasada('2026-06-07T12:00:00.000Z', referenceDate), true);
    assert.equal(isAteAtrasada('2026-06-08T04:30:00.000Z', referenceDate), false);
    assert.equal(isAteAtrasada('2026-06-09T04:00:00.000Z', referenceDate), false);
});

test('overdue reminder query excludes completed, future, and already-notified-today ATE', () => {
    const referenceDate = new Date('2026-06-08T16:00:00.000Z');
    const startOfToday = moment(referenceDate)
        .tz('America/Santiago')
        .startOf('day')
        .toDate();
    const query = buildOverdueAteReminderQuery(referenceDate);

    assert.deepEqual(query.estado, { $ne: true });
    assert.deepEqual(query.Trabajador, { $exists: true, $ne: null });
    assert.deepEqual(query.fecha_ate, { $lt: startOfToday });
    assert.deepEqual(query.$or, [
        { atrasoNotificacionEnviadaAt: { $exists: false } },
        { atrasoNotificacionEnviadaAt: null },
        { atrasoNotificacionEnviadaAt: { $lt: startOfToday } },
    ]);
});

test('overdue reminder message reports days late', () => {
    const referenceDate = new Date('2026-06-08T16:00:00.000Z');
    const ate = { fecha_ate: new Date('2026-06-06T04:00:00.000Z') };

    assert.equal(getOverdueDays(ate.fecha_ate, referenceDate), 2);
    assert.equal(
        buildOverdueMessage(ate, referenceDate),
        'Tienes una atención especial atrasada hace 2 días.'
    );
});
