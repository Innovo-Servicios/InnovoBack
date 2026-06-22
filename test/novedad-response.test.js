const test = require('node:test');
const assert = require('node:assert/strict');

const { _test } = require('../src/controllers/novedad.controller.js');

test('formatNovedadResponse includes caldera/corrector readings and multiple photos', () => {
    const response = _test.formatNovedadResponse({
        novedad: {
            _id: 'novedad-1',
            TipoNovedad: 'tipo-1',
            Fotografia: ['/tmp/caldera.jpg', '/tmp/corrector.jpg'],
            Lecturacorrecta: 0,
            lecturaCaldera: 123,
            lecturaCorrector: 456,
            Comentario: 'ok',
            Fecha: new Date('2026-06-18T12:00:00.000Z'),
        },
        direccion: {
            calle: 'ALZERRECA 47',
            LAT: -33,
            LNG: -71,
        },
        trabajador: {
            _id: 'trabajador-1',
            Rut: '1-9',
            Nombre: 'Cristian Donoso',
            cargo: 'lector',
            correo: 'cristian@example.com',
        },
    });

    assert.equal(response.lecturaCaldera, 123);
    assert.equal(response.lecturaCorrector, 456);
    assert.deepEqual(response.Fotografia, [
        '/assets/novedades/caldera.jpg',
        '/assets/novedades/corrector.jpg',
    ]);
    assert.equal(response.direccion, 'ALZERRECA 47');
    assert.deepEqual(response.coordenadas, [-33, -71]);
    assert.equal(response.emisor.nombre, 'Cristian Donoso');
});
