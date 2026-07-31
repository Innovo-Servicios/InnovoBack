const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const {
    createNotificationRecord,
    createSignatureValidations,
} = require('../src/controllers/notificaciones.controller.js');
const {
    notificacion_validacion_MongooseModel: NotificacionValidacion,
} = require('../src/models/notificacion_validacion.model.js');

test('automatic signature marks every worker accepted without generating codes', async () => {
    const originalInsertMany = NotificacionValidacion.insertMany;
    const workers = [
        { _id: new mongoose.Types.ObjectId(), Rut: '11111111-1', Nombre: 'Uno' },
        { _id: new mongoose.Types.ObjectId(), Rut: '22222222-2', Nombre: 'Dos' },
    ];
    const notification = {
        _id: new mongoose.Types.ObjectId(),
        requiereFirma: true,
        firmaAutomatica: true,
    };
    let insertedRows = [];

    NotificacionValidacion.insertMany = async (rows) => {
        insertedRows = rows;
        return rows;
    };

    try {
        const batch = await createSignatureValidations({
            nuevaNotificacion: notification,
            trabajadores: workers,
            expiresAtBase: new Date('2026-06-22T12:00:00.000Z'),
        });

        assert.equal(batch.firmaAutomatica, true);
        assert.deepEqual(batch.codes, []);
        assert.equal(insertedRows.length, workers.length);
        assert.ok(insertedRows.every((row) => row.estado === 'aceptado'));
        assert.ok(insertedRows.every((row) => row.firmaAutomatica === true));
        assert.ok(insertedRows.every((row) => row.firmadoAt instanceof Date));
        assert.ok(insertedRows.every((row) => row.aceptadoAt instanceof Date));
        assert.ok(insertedRows.every((row) => row.codeHash === undefined));
    } finally {
        NotificacionValidacion.insertMany = originalInsertMany;
    }
});

test('automatic signature notification records no device delivery date', () => {
    const worker = { _id: new mongoose.Types.ObjectId() };
    const notification = createNotificationRecord({
        trabajadores: [worker],
        tipoId: new mongoose.Types.ObjectId(),
        titulo: 'Firma automática',
        mensaje: 'Mensaje',
        contenido: 'Contenido',
        fecha: new Date('2026-06-22T12:00:00.000Z'),
        requiereFirma: true,
        firmaAutomatica: true,
        isScheduled: false,
    });

    assert.equal(notification.firmaAutomatica, true);
    assert.equal(notification.requiereFirma, true);
    assert.equal(notification.fechaEnvio, undefined);
});
