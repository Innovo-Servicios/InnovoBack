const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildLastUbicationUpdate,
    mergeWorkerLocationSnapshots,
    normalizeLocation,
} = require('../src/utils/workerTracking.js');

test('normalizeLocation returns numbers and rejects invalid coordinates', () => {
    assert.deepEqual(normalizeLocation({ lat: '-33.0411', lng: '-71.6341' }), {
        lat: -33.0411,
        lng: -71.6341,
    });

    assert.equal(normalizeLocation({ lat: 'nope', lng: '-71.6341' }), null);
    assert.equal(normalizeLocation({ lat: '-33.0411' }), null);
});

test('mergeWorkerLocationSnapshots keeps persisted last location for disconnected workers', () => {
    const snapshots = mergeWorkerLocationSnapshots({
        workers: [
            {
                Rut: '11111111-1',
                Nombre: 'Trabajador Uno',
                lastUbication: {
                    lat: '-33.04',
                    lng: '-71.63',
                    date: new Date('2026-06-08T12:00:00.000Z'),
                },
            },
        ],
        connectedWorkers: [],
    });

    assert.deepEqual(snapshots, [
        {
            id_trabajador: '11111111-1',
            nombre: 'Trabajador Uno',
            ubicacion: { lat: -33.04, lng: -71.63 },
            conectado: false,
            ultimaActualizacion: '2026-06-08T12:00:00.000Z',
        },
    ]);
});

test('mergeWorkerLocationSnapshots gives connected worker location priority', () => {
    const snapshots = mergeWorkerLocationSnapshots({
        workers: [
            {
                Rut: '11111111-1',
                Nombre: 'Trabajador Uno',
                lastUbication: {
                    lat: '-33.04',
                    lng: '-71.63',
                    date: '2026-06-08T12:00:00.000Z',
                },
            },
        ],
        connectedWorkers: [
            {
                id_trabajador: '11111111-1',
                nombre: 'Trabajador Uno',
                ubicacion: { lat: -33.05, lng: -71.64 },
                ultimaActualizacion: new Date('2026-06-08T12:05:00.000Z'),
            },
        ],
    });

    assert.deepEqual(snapshots, [
        {
            id_trabajador: '11111111-1',
            nombre: 'Trabajador Uno',
            ubicacion: { lat: -33.05, lng: -71.64 },
            conectado: true,
            ultimaActualizacion: '2026-06-08T12:05:00.000Z',
        },
    ]);
});

test('mergeWorkerLocationSnapshots omits invalid persisted and connected locations', () => {
    const snapshots = mergeWorkerLocationSnapshots({
        workers: [
            {
                Rut: '11111111-1',
                Nombre: 'Trabajador Uno',
                lastUbication: { lat: '', lng: '-71.63' },
            },
        ],
        connectedWorkers: [
            {
                id_trabajador: '22222222-2',
                nombre: 'Trabajador Dos',
                ubicacion: { lat: '-33.05', lng: null },
            },
        ],
    });

    assert.deepEqual(snapshots, []);
});

test('buildLastUbicationUpdate normalizes coordinates before persistence', () => {
    const date = new Date('2026-06-08T12:00:00.000Z');

    assert.deepEqual(buildLastUbicationUpdate({ lat: '-33.04', lng: '-71.63' }, date), {
        lat: -33.04,
        lng: -71.63,
        date,
    });

    assert.equal(buildLastUbicationUpdate({ lat: 'x', lng: '-71.63' }, date), null);
});
