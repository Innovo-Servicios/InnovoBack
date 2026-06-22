const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildAssignmentProgramHtml,
    buildAssignmentProgramPdf,
} = require('../src/utils/asignacionProgramacionPdf.js');

const makeAssignment = ({ routeNumber, sectorNumber, sector, tipo, fecha, trabajador }) => ({
    tipo,
    fecha_asignacion: new Date(`${fecha}T00:00:00.000Z`),
    Trabajador: {
        _id: `worker-${routeNumber}-${sectorNumber}-${tipo}`,
        Nombre: trabajador,
    },
    NumeroSector: {
        _id: `sector-${routeNumber}-${sectorNumber}`,
        sector,
        NumeroSector: sectorNumber,
        NumeroRuta: {
            _id: `route-${routeNumber}`,
            NumeroRuta: routeNumber,
        },
        empresa: 'Comercial',
    },
});

test('buildAssignmentProgramHtml mirrors the workbook layout and escapes values', () => {
    const assignments = [
        makeAssignment({
            routeNumber: 1,
            sectorNumber: 1,
            sector: 'CASABLANCA & <CENTRO>',
            tipo: 'lectura',
            fecha: '2026-06-01',
            trabajador: 'ANA & LUIS',
        }),
        makeAssignment({
            routeNumber: 1,
            sectorNumber: 1,
            sector: 'CASABLANCA & <CENTRO>',
            tipo: 'adelantoVerificacion',
            fecha: '2026-06-02',
            trabajador: 'INSPECTOR',
        }),
        makeAssignment({
            routeNumber: 1,
            sectorNumber: 1,
            sector: 'CASABLANCA & <CENTRO>',
            tipo: 'verificacion',
            fecha: '2026-06-03',
            trabajador: 'INSPECTOR',
        }),
        makeAssignment({
            routeNumber: 1,
            sectorNumber: 1,
            sector: 'CASABLANCA & <CENTRO>',
            tipo: 'reparto',
            fecha: '2026-06-05',
            trabajador: 'ANA & LUIS',
        }),
    ];

    const html = buildAssignmentProgramHtml({
        assignments,
        empresa: 'Comercial',
        month: '2026-06',
        zonal: '4',
    });

    assert.match(html, /Programación Facturación Junio 2026 Zonal 4/);
    assert.match(html, /Adelanto Verificaciones/);
    assert.match(html, /Fecha<br>Emisión/);
    assert.match(html, /4R01S01 CASABLANCA &amp; &lt;CENTRO&gt;/);
    assert.match(html, /ANA &amp; LUIS/);
    assert.match(html, />Lunes</);
    assert.match(html, />1-jun</);
    assert.match(html, /tbody class="route-group"/);
    assert.match(html, /@page \{ size: A4 landscape/);
    assert.doesNotMatch(html, /CASABLANCA & <CENTRO>/);
});

test('buildAssignmentProgramPdf creates a multipage PDF with the expected filename', async () => {
    const assignments = [];

    for (let routeNumber = 1; routeNumber <= 30; routeNumber += 1) {
        for (let sectorNumber = 1; sectorNumber <= 3; sectorNumber += 1) {
            assignments.push(makeAssignment({
                routeNumber,
                sectorNumber,
                sector: `SECTOR ${routeNumber}-${sectorNumber}`,
                tipo: 'lectura',
                fecha: '2026-06-01',
                trabajador: `LECTOR ${routeNumber}-${sectorNumber}`,
            }));
        }
    }

    const { buffer, fileName } = await buildAssignmentProgramPdf({
        assignments,
        empresa: 'Comercial',
        month: '2026-06',
        zonal: '4',
    });
    const pdfText = buffer.toString('latin1');
    const pageObjects = pdfText.match(/\/Type\s*\/Page\b/g) || [];

    assert.equal(fileName, 'PROGRAMACION COM JUNIO 2026.pdf');
    assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
    assert.ok(buffer.length > 10_000);
    assert.ok(pageObjects.length > 1, 'el PDF debe tener más de una página');
});
