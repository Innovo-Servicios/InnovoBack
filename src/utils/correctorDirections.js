const path = require('path');
const XLSX = require('xlsx');

const CALDERA_CORRECTOR_TAG = 'caldera_corrector';

const normalizeText = (value) =>
    String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ')
        .toUpperCase();

const normalizeTagList = (tags) =>
    Array.isArray(tags)
        ? tags.map((tag) => String(tag || '').trim()).filter(Boolean)
        : [];

const hasCalderaCorrectorTag = (direccion) =>
    normalizeTagList(direccion?.tags).includes(CALDERA_CORRECTOR_TAG);

const parseNumberField = (value) => {
    if (value === undefined || value === null || value === '') {
        return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const parseRequiredNumberField = (value) => {
    const parsed = parseNumberField(value);
    return parsed === null ? null : parsed;
};

const buildCalderaCorrectorLecturas = ({
    lecturaCaldera,
    lecturaCorrector,
    fotoCaldera,
    fotoCorrector,
    clave = 'caldera_corrector',
    fecha = new Date(),
    medidorId,
    rutaId,
    sectorId,
    trabajadorId,
    novedadId,
}) => ([
    {
        lectura: lecturaCaldera,
        foto: fotoCaldera || 'sin_fotografia',
        clave,
        fecha,
        tipoLectura: 'caldera',
        origen: 'novedad_caldera_corrector',
        novedad: novedadId,
        NumeroMedidor: medidorId,
        NumeroRuta: rutaId,
        NumeroSector: sectorId,
        trabajador: trabajadorId,
    },
    {
        lectura: lecturaCorrector,
        foto: fotoCorrector || fotoCaldera || 'sin_fotografia',
        clave,
        fecha,
        tipoLectura: 'corrector',
        origen: 'novedad_caldera_corrector',
        novedad: novedadId,
        NumeroMedidor: medidorId,
        NumeroRuta: rutaId,
        NumeroSector: sectorId,
        trabajador: trabajadorId,
    },
]);

const parseMeterFromLine = (line) => {
    const normalized = String(line || '').replace(/\u00a0/g, ' ');
    const medIndex = normalized.toUpperCase().lastIndexOf('MED');
    if (medIndex === -1) {
        return { meterRaw: '', meterDigits: null };
    }

    const meterText = normalized
        .slice(medIndex + 3)
        .trim()
        .replace(/^[\s*:-]+/, '');
    const meterRaw = (meterText.match(/[A-Z0-9][A-Z0-9-]*/i)?.[0] || '').toUpperCase();
    const meterDigitsText = meterRaw.replace(/\D/g, '');

    return {
        meterRaw,
        meterDigits: meterDigitsText ? Number(meterDigitsText) : null,
    };
};

const parseAddressFromLine = (line) => {
    const normalized = String(line || '').replace(/\u00a0/g, ' ');
    const medIndex = normalized.toUpperCase().lastIndexOf('MED');
    const beforeMeter = medIndex === -1 ? normalized : normalized.slice(0, medIndex);
    const cleaned = beforeMeter.replace(/\*/g, ' ').replace(/^CL\s+/i, '').trim();
    const clientMatch = cleaned.match(/^(\d+)\s+(.*)$/);

    if (!clientMatch) {
        return {
            clienteNumero: null,
            direccionTexto: normalizeText(cleaned),
        };
    }

    return {
        clienteNumero: Number(clientMatch[1]),
        direccionTexto: normalizeText(clientMatch[2]),
    };
};

const parseCorrectorLine = (line, context = {}) => {
    const { meterRaw, meterDigits } = parseMeterFromLine(line);
    const { clienteNumero, direccionTexto } = parseAddressFromLine(line);

    return {
        ...context,
        raw: String(line || '').replace(/\u00a0/g, ' ').trim(),
        clienteNumero,
        direccionTexto,
        meterRaw,
        meterDigits,
        markers: [],
    };
};

const parseCorrectorRecordsFromRows = (rows, context = {}) => {
    const records = [];
    let ruta = null;
    let sector = null;
    let pendingRecord = null;

    for (const [index, row] of rows.entries()) {
        const cells = row
            .map((value) => String(value ?? '').trim())
            .filter(Boolean);
        if (!cells.length) {
            continue;
        }

        const text = cells.join(' ').replace(/\u00a0/g, ' ').trim();
        const upperText = text.toUpperCase();

        if (/^RUTA\s+\d+/.test(upperText)) {
            ruta = text;
            continue;
        }

        if (/R\d+S\d+/.test(upperText) || upperText.startsWith('STE:')) {
            sector = text;
            continue;
        }

        if (upperText === 'CORRECTOR' || upperText === 'CALDERA') {
            if (pendingRecord) {
                pendingRecord.markers.push(upperText);
            }
            continue;
        }

        if (/MED/i.test(text)) {
            if (pendingRecord) {
                records.push(pendingRecord);
            }

            pendingRecord = parseCorrectorLine(text, {
                ...context,
                row: index + 1,
                ruta,
                sector,
            });
        }
    }

    if (pendingRecord) {
        records.push(pendingRecord);
    }

    return records;
};

const parseCorrectorWorkbook = (filePath) => {
    const workbook = XLSX.readFile(filePath, { cellDates: false });
    return workbook.SheetNames.flatMap((sheetName) => {
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
            header: 1,
            raw: false,
            blankrows: false,
        });

        return parseCorrectorRecordsFromRows(rows, {
            file: path.basename(filePath),
            sheet: sheetName,
        });
    });
};

module.exports = {
    CALDERA_CORRECTOR_TAG,
    buildCalderaCorrectorLecturas,
    hasCalderaCorrectorTag,
    normalizeTagList,
    normalizeText,
    parseCorrectorLine,
    parseCorrectorRecordsFromRows,
    parseCorrectorWorkbook,
    parseMeterFromLine,
    parseRequiredNumberField,
};
