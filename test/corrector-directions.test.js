const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildCalderaCorrectorLecturas,
    CALDERA_CORRECTOR_TAG,
    hasCalderaCorrectorTag,
    parseCorrectorLine,
    parseCorrectorRecordsFromRows,
    parseMeterFromLine,
} = require('../src/utils/correctorDirections.js');

test('parseMeterFromLine handles corrector spreadsheet meter variants', () => {
    assert.deepEqual(parseMeterFromLine('CL 1038039*WADDINGTON*714*MED-08K083612'), {
        meterRaw: '08K083612',
        meterDigits: 8083612,
    });
    assert.deepEqual(parseMeterFromLine('CL 1026896*BLANCA 611*MED 03-299519'), {
        meterRaw: '03-299519',
        meterDigits: 3299519,
    });
    assert.deepEqual(parseMeterFromLine('CL 8084715*PINARES 410 BLK A*MED* X240551'), {
        meterRaw: 'X240551',
        meterDigits: 240551,
    });
});

test('parseCorrectorLine extracts client, address, and meter data', () => {
    const record = parseCorrectorLine('CL 8078715 DECIMA 734 EDI TERRASOL 3* MED 21T464002');

    assert.equal(record.clienteNumero, 8078715);
    assert.equal(record.direccionTexto, 'DECIMA 734 EDI TERRASOL 3');
    assert.equal(record.meterRaw, '21T464002');
    assert.equal(record.meterDigits, 21464002);
});

test('parseCorrectorRecordsFromRows binds route, sector, and markers to records', () => {
    const records = parseCorrectorRecordsFromRows([
        ['', 'RUTA 3'],
        ['', 'STE: 04R03S02 QUILPUE CONDELL SUR'],
        ['', 'CL 8078715 DECIMA 734 EDI TERRASOL 3* MED 21T464002'],
        ['', 'CORRECTOR'],
        ['', 'CALDERA'],
    ], { file: 'CORRECTORES COMERCIAL.xlsx', sheet: 'Hoja1' });

    assert.equal(records.length, 1);
    assert.equal(records[0].ruta, 'RUTA 3');
    assert.equal(records[0].sector, 'STE: 04R03S02 QUILPUE CONDELL SUR');
    assert.deepEqual(records[0].markers, ['CORRECTOR', 'CALDERA']);
});

test('hasCalderaCorrectorTag detects persisted address tags', () => {
    assert.equal(hasCalderaCorrectorTag({ tags: [CALDERA_CORRECTOR_TAG] }), true);
    assert.equal(hasCalderaCorrectorTag({ tags: ['otro'] }), false);
});

test('buildCalderaCorrectorLecturas creates linked caldera and corrector readings', () => {
    const fecha = new Date('2026-06-18T12:00:00.000Z');
    const lecturas = buildCalderaCorrectorLecturas({
        lecturaCaldera: 111,
        lecturaCorrector: 222,
        fotoCaldera: 'caldera.jpg',
        fotoCorrector: 'corrector.jpg',
        fecha,
        medidorId: 'medidor-1',
        rutaId: 'ruta-1',
        sectorId: 'sector-1',
        trabajadorId: 'trabajador-1',
        novedadId: 'novedad-1',
    });

    assert.deepEqual(lecturas.map((lectura) => lectura.tipoLectura), ['caldera', 'corrector']);
    assert.equal(lecturas[0].lectura, 111);
    assert.equal(lecturas[1].lectura, 222);
    assert.equal(lecturas[0].novedad, 'novedad-1');
    assert.equal(lecturas[1].origen, 'novedad_caldera_corrector');
});
