const ExcelJS = require('exceljs');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');

dayjs.extend(utc);

const MONTH_NAMES_ES = [
    'Enero',
    'Febrero',
    'Marzo',
    'Abril',
    'Mayo',
    'Junio',
    'Julio',
    'Agosto',
    'Septiembre',
    'Octubre',
    'Noviembre',
    'Diciembre',
];

const WEEKDAY_NAMES_ES = [
    'Domingo',
    'Lunes',
    'Martes',
    'Miércoles',
    'Jueves',
    'Viernes',
    'Sábado',
];

const PROGRAM_COLUMNS = [
    { key: 'lectura', column: 5, header: 'Lecturas' },
    { key: 'adelantoVerificacion', column: 6, header: 'Adelanto Verificaciones' },
    { key: 'verificacion', column: 7, header: 'Verificaciones' },
    { key: 'fechaEmision', column: 8, header: 'Fecha\nEmisión' },
    { key: 'reparto', column: 9, header: 'Reparto' },
];

const COMPANY_CODES = {
    Comercial: 'COM',
    GasValpo: 'GASVALPO',
    Energas: 'ENERGAS',
};

const thinBlackBorder = {
    left: { style: 'thin', color: { argb: 'FF000000' } },
    right: { style: 'thin', color: { argb: 'FF000000' } },
    top: { style: 'thin', color: { argb: 'FF000000' } },
    bottom: { style: 'thin', color: { argb: 'FF000000' } },
};

const verticalBorder = {
    left: { style: 'thin', color: { argb: 'FF000000' } },
    right: { style: 'thin', color: { argb: 'FF000000' } },
};

const greenFill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFCCFFCC' },
};

const whiteFill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFFFFFF' },
};

const baseFont = {
    name: 'Calibri',
    family: 2,
    size: 13,
    color: { argb: 'FF000000' },
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const safeText = (value) => String(value || '').trim();

const normalizeId = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (value._id) return String(value._id);
    return String(value);
};

const getRouteNumber = (sector) => {
    const route = sector?.NumeroRuta;
    if (typeof route?.NumeroRuta === 'number') return route.NumeroRuta;
    if (typeof route === 'number') return route;
    return null;
};

const getRouteId = (sector) => normalizeId(sector?.NumeroRuta?._id || sector?.NumeroRuta);

const getSectorNumber = (sector) => {
    const numero = Number(sector?.NumeroSector);
    return Number.isFinite(numero) ? numero : null;
};

const parseSectorRouteCode = (value) => {
    const match = safeText(value).match(/^(\d+)?R(\d+)S(\d+)\s+(.+)$/i);
    if (!match) return null;

    return {
        zonal: match[1] || null,
        routeNumber: Number(match[2]),
        sectorSequence: Number(match[3]),
        name: safeText(match[4]),
    };
};

const getSectorSortNumber = (sector) => {
    const parsed = parseSectorRouteCode(sector?.sector || sector?.nombre);
    return parsed?.sectorSequence || getSectorNumber(sector);
};

const getWorkerName = (worker) => safeText(worker?.Nombre || worker?.nombre);

const formatMonthName = (monthNumber) => MONTH_NAMES_ES[monthNumber - 1] || '';

const formatTitle = ({ month, zonal }) => {
    const parsed = dayjs.utc(`${month}-01`);
    const monthName = formatMonthName(parsed.month() + 1);
    const zonalText = zonal ? ` Zonal ${zonal}` : '';
    return `Programación Facturación ${monthName} ${parsed.year()}${zonalText}`;
};

const formatFileName = ({ empresa, month }) => {
    const parsed = dayjs.utc(`${month}-01`);
    const monthName = formatMonthName(parsed.month() + 1).toUpperCase();
    const companyCode = COMPANY_CODES[empresa] || 'ASIGNACIONES';
    return `PROGRAMACION ${companyCode} ${monthName} ${parsed.year()}.xlsx`;
};

const formatWorksheetName = ({ month, zonal }) => {
    const parsed = dayjs.utc(`${month}-01`);
    const monthName = formatMonthName(parsed.month() + 1).slice(0, 3);
    const prefix = zonal ? `Zonal_${zonal}` : 'Programacion';
    return `${prefix}_${monthName}_${parsed.year()}`
        .replace(/[\\/?*:[\]]/g, '_')
        .slice(0, 31);
};

const getDateKey = (value) => {
    const parsed = dayjs.utc(value);
    return parsed.isValid() ? parsed.format('YYYY-MM-DD') : null;
};

const dateFromKey = (dateKey) => {
    const parsed = dayjs.utc(dateKey);
    if (!parsed.isValid()) return null;
    return new Date(Date.UTC(parsed.year(), parsed.month(), parsed.date()));
};

const getWeekdayName = (dateKey) => {
    const parsed = dayjs.utc(dateKey);
    return parsed.isValid() ? WEEKDAY_NAMES_ES[parsed.day()] : '';
};

const nextBusinessDay = (dateKey) => {
    let parsed = dayjs.utc(dateKey);
    if (!parsed.isValid()) return null;

    do {
        parsed = parsed.add(1, 'day');
    } while ([0, 6].includes(parsed.day()));

    return parsed.format('YYYY-MM-DD');
};

const previousBusinessDay = (dateKey) => {
    let parsed = dayjs.utc(dateKey);
    if (!parsed.isValid()) return null;

    do {
        parsed = parsed.subtract(1, 'day');
    } while ([0, 6].includes(parsed.day()));

    return parsed.format('YYYY-MM-DD');
};

const pickFirstDate = (dates) => {
    const sorted = Array.from(new Set(dates.filter(Boolean))).sort();
    return sorted[0] || null;
};

const buildSectorLabel = ({ sector, routeNumber, sequence, zonal }) => {
    const sectorName = safeText(sector?.sector || sector?.nombre || 'Sin sector');
    const parsedCode = parseSectorRouteCode(sectorName);
    if (parsedCode?.zonal) return sectorName;

    if (!zonal || routeNumber === null) return sectorName;

    const routePart = String(parsedCode?.routeNumber || routeNumber).padStart(2, '0');
    const sectorPart = String(parsedCode?.sectorSequence || sequence).padStart(2, '0');
    return `${zonal}R${routePart}S${sectorPart} ${parsedCode?.name || sectorName}`;
};

const sortByNumberThenName = (left, right) => {
    const leftNumber = left.sortNumber ?? Number.MAX_SAFE_INTEGER;
    const rightNumber = right.sortNumber ?? Number.MAX_SAFE_INTEGER;
    if (leftNumber !== rightNumber) return leftNumber - rightNumber;

    return safeText(left.name).localeCompare(safeText(right.name), 'es');
};

const ensureSector = ({ route, assignment }) => {
    const sector = assignment.NumeroSector || {};
    const sectorId = normalizeId(sector._id || assignment.NumeroSector);
    if (!sectorId) return null;

    if (!route.sectorsById.has(sectorId)) {
        route.sectorsById.set(sectorId, {
            id: sectorId,
            sector,
            name: safeText(sector.sector || sector.nombre || 'Sin sector'),
            sortNumber: getSectorSortNumber(sector),
            workersByType: new Map(),
            datesByType: new Map(),
        });
    }

    return route.sectorsById.get(sectorId);
};

const buildProgramacionRoutes = (assignments = [], { zonal } = {}) => {
    const routesById = new Map();

    for (const assignment of assignments) {
        const sector = assignment.NumeroSector || {};
        const routeNumber = getRouteNumber(sector);
        const routeId = getRouteId(sector) || `ruta-${routeNumber ?? 'sin-ruta'}`;
        if (!routeNumber && !routeId) continue;

        if (!routesById.has(routeId)) {
            routesById.set(routeId, {
                id: routeId,
                routeNumber,
                sortNumber: routeNumber ?? Number.MAX_SAFE_INTEGER,
                sectorsById: new Map(),
                datesByType: new Map(),
            });
        }

        const route = routesById.get(routeId);
        const sectorEntry = ensureSector({ route, assignment });
        if (!sectorEntry) continue;

        const type = safeText(assignment.tipo);
        const dateKey = getDateKey(assignment.fecha_asignacion);
        const workerName = getWorkerName(assignment.Trabajador);

        if (type && dateKey) {
            if (!route.datesByType.has(type)) route.datesByType.set(type, []);
            route.datesByType.get(type).push(dateKey);
            sectorEntry.datesByType.set(type, dateKey);
        }

        if (type && workerName && !sectorEntry.workersByType.has(type)) {
            sectorEntry.workersByType.set(type, workerName);
        }
    }

    return Array.from(routesById.values())
        .sort(sortByNumberThenName)
        .map((route) => {
            const dates = Object.fromEntries(
                PROGRAM_COLUMNS
                    .filter((item) => item.key !== 'fechaEmision')
                    .map((item) => [item.key, pickFirstDate(route.datesByType.get(item.key) || [])])
            );
            dates.fechaEmision = dates.verificacion
                ? nextBusinessDay(dates.verificacion)
                : previousBusinessDay(dates.reparto);

            const sectors = Array.from(route.sectorsById.values())
                .sort(sortByNumberThenName)
                .map((sectorEntry, index) => {
                    const lecturaWorker = sectorEntry.workersByType.get('lectura') || '';
                    const repartoWorker = sectorEntry.workersByType.get('reparto') || '';

                    return {
                        ...sectorEntry,
                        label: buildSectorLabel({
                            sector: sectorEntry.sector,
                            routeNumber: route.routeNumber,
                            sequence: index + 1,
                            zonal,
                        }),
                        lecturaWorker,
                        repartoWorker,
                    };
                });

            return {
                ...route,
                dates,
                sectors,
            };
        });
};

const setCellStyle = (cell, style) => {
    cell.style = clone(style);
};

const applyAreaStyle = (worksheet, rowNumber, startColumn, endColumn, style) => {
    for (let column = startColumn; column <= endColumn; column += 1) {
        setCellStyle(worksheet.getCell(rowNumber, column), style);
    }
};

const headerStyle = {
    font: baseFont,
    fill: greenFill,
    border: thinBlackBorder,
    alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
};

const routeStyle = {
    font: baseFont,
    fill: greenFill,
    border: thinBlackBorder,
    alignment: { horizontal: 'center', vertical: 'middle' },
};

const sectorStyle = {
    font: baseFont,
    fill: greenFill,
    border: thinBlackBorder,
    alignment: { vertical: 'middle' },
};

const valueStyle = {
    font: baseFont,
    fill: whiteFill,
    border: thinBlackBorder,
    alignment: { horizontal: 'center', vertical: 'middle' },
};

const calendarStyle = {
    font: baseFont,
    fill: whiteFill,
    border: verticalBorder,
    alignment: { horizontal: 'center', vertical: 'middle' },
};

const setupWorksheet = (worksheet, { month, zonal }) => {
    worksheet.properties.defaultRowHeight = 19.2;
    worksheet.columns = [
        { width: 4.5546875 },
        { width: 5.5546875 },
        { width: 46.44140625 },
        { width: 19.109375 },
        { width: 14.109375 },
        { width: 15.77734375 },
        { width: 15.77734375 },
        { width: 14.109375 },
        { width: 14.109375 },
    ];
    worksheet.views = [{ state: 'normal', showGridLines: true }];
    worksheet.pageSetup = {
        orientation: 'portrait',
        scale: 65,
        fitToWidth: 1,
        fitToHeight: 1,
        horizontalCentered: true,
        verticalCentered: true,
        margins: {
            left: 0.2362204724409449,
            right: 0.2362204724409449,
            top: 0.7480314960629921,
            bottom: 0.7480314960629921,
            header: 0.31496062992125984,
            footer: 0.31496062992125984,
        },
    };

    worksheet.mergeCells('B1:I1');
    worksheet.getCell('B1').value = formatTitle({ month, zonal });
    applyAreaStyle(worksheet, 1, 2, 9, headerStyle);

    const headers = ['Ruta', 'Sector', 'Lector', ...PROGRAM_COLUMNS.map((item) => item.header)];
    headers.forEach((header, index) => {
        const cell = worksheet.getCell(2, index + 2);
        cell.value = header;
        setCellStyle(cell, headerStyle);
    });
};

const styleProgramRow = (worksheet, rowNumber) => {
    worksheet.getRow(rowNumber).height = 19.2;
    setCellStyle(worksheet.getCell(rowNumber, 2), routeStyle);
    setCellStyle(worksheet.getCell(rowNumber, 3), sectorStyle);
    setCellStyle(worksheet.getCell(rowNumber, 4), valueStyle);
    PROGRAM_COLUMNS.forEach((item) => {
        setCellStyle(worksheet.getCell(rowNumber, item.column), calendarStyle);
    });
};

const writeRouteGroup = (worksheet, route, startRow) => {
    const rowCount = Math.max(route.sectors.length, 2);
    const endRow = startRow + rowCount - 1;

    for (let offset = 0; offset < rowCount; offset += 1) {
        const rowNumber = startRow + offset;
        const sector = route.sectors[offset] || null;
        styleProgramRow(worksheet, rowNumber);

        worksheet.getCell(rowNumber, 3).value = sector?.label || '';
        worksheet.getCell(rowNumber, 4).value = sector?.lecturaWorker || '';

        if (offset === 0) {
            PROGRAM_COLUMNS.forEach((item) => {
                const dateKey = route.dates[item.key];
                worksheet.getCell(rowNumber, item.column).value = dateKey ? getWeekdayName(dateKey) : '';
            });
        } else if (offset === 1) {
            PROGRAM_COLUMNS.forEach((item) => {
                const dateKey = route.dates[item.key];
                const cell = worksheet.getCell(rowNumber, item.column);
                cell.value = dateKey ? dateFromKey(dateKey) : '';
                cell.numFmt = dateKey ? 'd-mmm' : 'General';
            });
        } else {
            const repartoWorker = sector?.repartoWorker || '';
            const lecturaWorker = sector?.lecturaWorker || '';
            worksheet.getCell(rowNumber, 9).value =
                repartoWorker && repartoWorker !== lecturaWorker ? repartoWorker : '';
        }
    }

    worksheet.getCell(startRow, 2).value = route.routeNumber ?? '';
    if (endRow > startRow) {
        worksheet.mergeCells(startRow, 2, endRow, 2);
    }

    return endRow + 1;
};

const writeSeparatorRow = (worksheet, rowNumber) => {
    worksheet.getRow(rowNumber).height = 19.2;
    setCellStyle(worksheet.getCell(rowNumber, 2), routeStyle);
    setCellStyle(worksheet.getCell(rowNumber, 3), sectorStyle);
    for (let column = 4; column <= 9; column += 1) {
        setCellStyle(worksheet.getCell(rowNumber, column), calendarStyle);
    }
};

const buildAssignmentProgramWorkbook = ({ assignments = [], empresa, month, zonal = '4' }) => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Innovo';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet(formatWorksheetName({ month, zonal }));
    setupWorksheet(worksheet, { month, zonal });

    const routes = buildProgramacionRoutes(assignments, { zonal });
    let currentRow = 3;

    routes.forEach((route, index) => {
        currentRow = writeRouteGroup(worksheet, route, currentRow);
        if (index < routes.length - 1) {
            writeSeparatorRow(worksheet, currentRow);
            currentRow += 1;
        }
    });

    const lastRow = Math.max(currentRow - 1, 2);
    worksheet.pageSetup.printArea = `B1:I${lastRow}`;

    return {
        workbook,
        routes,
        fileName: formatFileName({ empresa, month }),
    };
};

module.exports = {
    buildAssignmentProgramWorkbook,
    buildProgramacionRoutes,
    formatFileName,
    formatTitle,
};
