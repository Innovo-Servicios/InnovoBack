const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const puppeteer = require('puppeteer');
const {
    PROGRAM_COLUMNS,
    buildProgramacionRoutes,
    formatPdfFileName,
    formatTitle,
    getWeekdayName,
} = require('./asignacionProgramacionExport.js');

dayjs.extend(utc);

const MONTH_SHORT_NAMES_ES = [
    'ene',
    'feb',
    'mar',
    'abr',
    'may',
    'jun',
    'jul',
    'ago',
    'sept',
    'oct',
    'nov',
    'dic',
];

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatShortDate = (dateKey) => {
    const parsed = dayjs.utc(dateKey);
    if (!parsed.isValid()) return '';
    return `${parsed.date()}-${MONTH_SHORT_NAMES_ES[parsed.month()]}`;
};

const renderCalendarCell = ({ route, column, rowOffset, sector }) => {
    const dateKey = route.dates[column.key];

    if (rowOffset === 0) {
        return escapeHtml(dateKey ? getWeekdayName(dateKey) : '');
    }

    if (rowOffset === 1) {
        return escapeHtml(dateKey ? formatShortDate(dateKey) : '');
    }

    if (column.key === 'reparto') {
        const repartoWorker = sector?.repartoWorker || '';
        const lecturaWorker = sector?.lecturaWorker || '';
        return escapeHtml(
            repartoWorker && repartoWorker !== lecturaWorker ? repartoWorker : ''
        );
    }

    return '';
};

const renderRouteGroup = (route, routeIndex, totalRoutes) => {
    const rowCount = Math.max(route.sectors.length, 2);
    const rows = [];

    for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
        const sector = route.sectors[rowOffset] || null;
        const routeCell = rowOffset === 0
            ? `<td class="route" rowspan="${rowCount}">${escapeHtml(route.routeNumber ?? '')}</td>`
            : '';
        const calendarCells = PROGRAM_COLUMNS.map((column) => (
            `<td class="calendar">${renderCalendarCell({ route, column, rowOffset, sector })}</td>`
        )).join('');

        rows.push(`
            <tr class="program-row">
                ${routeCell}
                <td class="sector">${escapeHtml(sector?.label || '')}</td>
                <td class="reader">${escapeHtml(sector?.lecturaWorker || '')}</td>
                ${calendarCells}
            </tr>
        `);
    }

    if (routeIndex < totalRoutes - 1) {
        rows.push('<tr class="separator"><td colspan="8"></td></tr>');
    }

    return `<tbody class="route-group">${rows.join('')}</tbody>`;
};

const buildAssignmentProgramHtml = ({ assignments = [], empresa, month, zonal = '4' }) => {
    const routes = buildProgramacionRoutes(assignments, { zonal });
    const title = formatTitle({ month, zonal });
    const routeGroups = routes.map((route, index) => (
        renderRouteGroup(route, index, routes.length)
    )).join('');
    const headers = ['Ruta', 'Sector', 'Lector', ...PROGRAM_COLUMNS.map((column) => column.header)]
        .map((header) => `<th>${escapeHtml(header).replace(/\n/g, '<br>')}</th>`)
        .join('');

    return `<!doctype html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <title>${escapeHtml(title)}</title>
    <style>
        @page { size: A4 landscape; margin: 8mm; }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; }
        body {
            color: #000;
            font-family: "Noto Sans", Arial, sans-serif;
            font-size: 8.5px;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        col.route-col { width: 4%; }
        col.sector-col { width: 32%; }
        col.reader-col { width: 13%; }
        col.date-col { width: 10.2%; }
        thead { display: table-header-group; }
        thead th {
            height: 25px;
            padding: 3px 4px;
            border: 0.7px solid #000;
            background: #ccffcc;
            font-weight: 600;
            text-align: center;
            vertical-align: middle;
        }
        thead .title {
            height: 28px;
            font-size: 11px;
            font-weight: 600;
        }
        tbody.route-group {
            break-inside: avoid;
            page-break-inside: avoid;
        }
        tr.program-row { height: 19px; }
        td {
            height: 19px;
            padding: 2px 4px;
            border: 0.7px solid #000;
            vertical-align: middle;
        }
        td.route, td.sector { background: #ccffcc; }
        td.route, td.reader, td.calendar { text-align: center; }
        td.sector { text-align: left; }
        tr.separator { height: 9px; }
        tr.separator td {
            height: 9px;
            padding: 0;
            border-left: 0.7px solid #000;
            border-right: 0.7px solid #000;
        }
    </style>
</head>
<body>
    <table aria-label="${escapeHtml(title)}">
        <colgroup>
            <col class="route-col">
            <col class="sector-col">
            <col class="reader-col">
            ${PROGRAM_COLUMNS.map(() => '<col class="date-col">').join('')}
        </colgroup>
        <thead>
            <tr><th class="title" colspan="8">${escapeHtml(title)}</th></tr>
            <tr>${headers}</tr>
        </thead>
        ${routeGroups || '<tbody><tr><td colspan="8">Sin asignaciones para el período.</td></tr></tbody>'}
    </table>
</body>
</html>`;
};

const getExecutablePath = () => (
    process.env.PDF_CHROME_PATH
    || process.env.WHATSAPP_CHROME_PATH
    || puppeteer.executablePath()
);

const renderAssignmentProgramPdf = async (html) => {
    let browser;
    let page;

    try {
        browser = await puppeteer.launch({
            headless: true,
            executablePath: getExecutablePath(),
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-breakpad',
                '--disable-crash-reporter',
                '--noerrdialogs',
            ],
        });
        page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'domcontentloaded' });
        await page.emulateMediaType('print');

        const pdf = await page.pdf({
            format: 'A4',
            landscape: true,
            printBackground: true,
            preferCSSPageSize: true,
            margin: {
                top: '8mm',
                right: '8mm',
                bottom: '8mm',
                left: '8mm',
            },
        });

        return Buffer.from(pdf);
    } finally {
        if (page) await page.close().catch(() => {});
        if (browser) await browser.close().catch(() => {});
    }
};

const buildAssignmentProgramPdf = async ({ assignments = [], empresa, month, zonal = '4' }) => {
    const html = buildAssignmentProgramHtml({ assignments, empresa, month, zonal });
    const buffer = await renderAssignmentProgramPdf(html);

    return {
        buffer,
        fileName: formatPdfFileName({ empresa, month }),
        html,
    };
};

module.exports = {
    buildAssignmentProgramHtml,
    buildAssignmentProgramPdf,
    escapeHtml,
    renderAssignmentProgramPdf,
};
