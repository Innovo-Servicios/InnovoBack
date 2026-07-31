const path = require('node:path');
const { renderAssignmentProgramPdf, escapeHtml } = require('../utils/asignacionProgramacionPdf.js');
const { getExpirationStatus } = require('./companyDocuments.service.js');

const TIMEZONE = 'America/Santiago';

const formatDateTime = (value) => {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleString('es-CL', { timeZone: TIMEZONE });
};

const getValidationState = (validation) => {
    if (!validation) return 'pendiente';
    if (
        ['pendiente', 'firmado'].includes(validation.estado) &&
        validation.expiresAt &&
        new Date(validation.expiresAt).getTime() < Date.now()
    ) {
        return 'vencido';
    }
    return validation.estado || 'pendiente';
};

const buildEvidenceRows = ({
    document,
    notifications = [],
    validations = [],
    views = [],
    workers = [],
}) => {
    const notificationIds = new Set(notifications.map((notification) => String(notification._id)));
    const workerById = new Map(workers.map((worker) => [String(worker._id), worker]));
    const viewByWorker = new Map(views.map((view) => [String(view.trabajador), view]));

    return validations.map((validation) => {
        const worker = workerById.get(String(validation.trabajador));
        const view = viewByWorker.get(String(validation.trabajador));
        const state = getValidationState(validation);
        return {
            trabajadorId: String(validation.trabajador),
            rut: worker?.Rut || '',
            nombre: worker?.Nombre || '',
            cargo: worker?.arquetipo || worker?.cargo || '',
            notificacionId: notificationIds.has(String(validation.notificacion))
                ? String(validation.notificacion)
                : '',
            enviado: notificationIds.has(String(validation.notificacion)),
            vistoAt: view?.createdAt || view?.tiempo || null,
            estadoFirma: state,
            firmadoAt: validation.firmadoAt || null,
            aceptadoAt: validation.aceptadoAt || null,
            vencimientoCodigo: validation.expiresAt || null,
            intentos: validation.intentos || 0,
        };
    }).sort((left, right) => left.nombre.localeCompare(right.nombre, 'es'));
};

const summarizeEvidenceRows = (rows) => rows.reduce((summary, row) => {
    summary.enviados += row.enviado ? 1 : 0;
    summary.vistos += row.vistoAt ? 1 : 0;
    if (row.estadoFirma === 'firmado') summary.firmados += 1;
    else if (row.estadoFirma === 'aceptado') summary.aceptados += 1;
    else if (row.estadoFirma === 'vencido') summary.vencidos += 1;
    else if (row.estadoFirma === 'bloqueado') summary.bloqueados += 1;
    else summary.pendientes += 1;
    return summary;
}, {
    enviados: 0,
    vistos: 0,
    pendientes: 0,
    firmados: 0,
    aceptados: 0,
    vencidos: 0,
    bloqueados: 0,
});

const buildCompanyDocumentEvidence = ({
    document,
    notifications,
    validations,
    views,
    workers,
}) => {
    const rows = buildEvidenceRows({
        document,
        notifications,
        validations,
        views,
        workers,
    });
    return {
        generadoAt: new Date().toISOString(),
        documento: {
            id: String(document._id),
            titulo: document.titulo,
            codigoBase: document.codigoBase || '',
            codigoVersionado: document.codigoVersionado || '',
            version: document.version,
            categoria: document.categoria?.nombre || '',
            estado: document.estado,
            estadoVencimiento: getExpirationStatus(document),
            fechaEmision: document.fechaEmision || null,
            fechaVencimiento: document.fechaVencimiento || null,
            archivo: document.archivo?.nombreOriginal || '',
            responsableSistemaGestion: document.responsableSistemaGestion || null,
        },
        resumen: summarizeEvidenceRows(rows),
        filas: rows,
    };
};

const buildEvidenceCsv = (evidence) => {
    const headers = [
        'rut',
        'nombre',
        'cargo',
        'enviado',
        'visto_at',
        'estado_firma',
        'firmado_at',
        'aceptado_at',
        'vencimiento_codigo',
        'intentos',
    ];
    const escapeCsv = (value) => {
        const text = String(value ?? '');
        return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const rows = evidence.filas.map((row) => [
        row.rut,
        row.nombre,
        row.cargo,
        row.enviado ? 'si' : 'no',
        formatDateTime(row.vistoAt),
        row.estadoFirma,
        formatDateTime(row.firmadoAt),
        formatDateTime(row.aceptadoAt),
        formatDateTime(row.vencimientoCodigo),
        row.intentos,
    ].map(escapeCsv).join(';'));

    return [headers.join(';'), ...rows].join('\n');
};

const renderSummaryChip = (label, value) => `
    <div class="chip">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
    </div>
`;

const buildEvidenceHtml = (evidence) => {
    const { documento, resumen, filas } = evidence;
    const rows = filas.map((row) => `
        <tr>
            <td>${escapeHtml(row.rut)}</td>
            <td>${escapeHtml(row.nombre)}</td>
            <td>${escapeHtml(row.cargo)}</td>
            <td>${row.enviado ? 'Si' : 'No'}</td>
            <td>${escapeHtml(formatDateTime(row.vistoAt))}</td>
            <td>${escapeHtml(row.estadoFirma)}</td>
            <td>${escapeHtml(formatDateTime(row.firmadoAt))}</td>
            <td>${escapeHtml(formatDateTime(row.aceptadoAt))}</td>
        </tr>
    `).join('');
    const title = `Evidencia documental ${documento.codigoVersionado || documento.titulo}`;

    return `<!doctype html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <title>${escapeHtml(title)}</title>
    <style>
        @page { size: A4 portrait; margin: 12mm; }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            color: #1f2937;
            font-family: Arial, sans-serif;
            font-size: 11px;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        header { border-bottom: 2px solid #111827; padding-bottom: 10px; margin-bottom: 14px; }
        h1 { margin: 0 0 4px; font-size: 20px; }
        h2 { margin: 16px 0 8px; font-size: 14px; }
        p { margin: 2px 0; }
        .meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 18px; }
        .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 14px 0; }
        .chip { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; }
        .chip span { display: block; color: #64748b; font-size: 9px; text-transform: uppercase; }
        .chip strong { display: block; margin-top: 2px; font-size: 16px; color: #111827; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        th, td { border: 1px solid #cbd5e1; padding: 5px; text-align: left; vertical-align: top; word-wrap: break-word; }
        th { background: #e5eef8; color: #0f172a; font-size: 9px; text-transform: uppercase; }
        footer { margin-top: 14px; color: #64748b; font-size: 9px; }
    </style>
</head>
<body>
    <header>
        <h1>${escapeHtml(title)}</h1>
        <div class="meta">
            <p><strong>Documento:</strong> ${escapeHtml(documento.titulo)}</p>
            <p><strong>Codigo:</strong> ${escapeHtml(documento.codigoVersionado || documento.codigoBase || '-')}</p>
            <p><strong>Categoria:</strong> ${escapeHtml(documento.categoria || '-')}</p>
            <p><strong>Version:</strong> ${escapeHtml(documento.version)}</p>
            <p><strong>Estado:</strong> ${escapeHtml(documento.estado)}</p>
            <p><strong>Vencimiento:</strong> ${escapeHtml(formatDateTime(documento.fechaVencimiento) || 'Sin vencimiento')}</p>
            <p><strong>Responsable SGI:</strong> ${escapeHtml(documento.responsableSistemaGestion?.nombre || '')}</p>
            <p><strong>Cargo:</strong> ${escapeHtml(documento.responsableSistemaGestion?.cargo || '')}</p>
        </div>
    </header>

    <section class="summary">
        ${renderSummaryChip('Enviados', resumen.enviados)}
        ${renderSummaryChip('Vistos', resumen.vistos)}
        ${renderSummaryChip('Firmados', resumen.firmados)}
        ${renderSummaryChip('Aceptados', resumen.aceptados)}
        ${renderSummaryChip('Pendientes', resumen.pendientes)}
        ${renderSummaryChip('Vencidos', resumen.vencidos)}
        ${renderSummaryChip('Bloqueados', resumen.bloqueados)}
    </section>

    <h2>Detalle por trabajador</h2>
    <table>
        <thead>
            <tr>
                <th>RUT</th>
                <th>Nombre</th>
                <th>Cargo</th>
                <th>Enviado</th>
                <th>Visto</th>
                <th>Firma</th>
                <th>Firmado</th>
                <th>Aceptado</th>
            </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="8">Sin registros de difusion.</td></tr>'}</tbody>
    </table>

    <footer>
        Generado el ${escapeHtml(formatDateTime(evidence.generadoAt))}. Este reporte acredita entrega, difusion, lectura, firma y aceptacion electronica dentro de App Innovo.
    </footer>
</body>
</html>`;
};

const buildEvidencePdf = async (evidence) => {
    const html = buildEvidenceHtml(evidence);
    const buffer = await renderAssignmentProgramPdf(html);
    const safeCode = String(evidence.documento.codigoVersionado || evidence.documento.titulo || 'documento')
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .slice(0, 80);
    return {
        buffer,
        html,
        fileName: `evidencia-${path.basename(safeCode)}.pdf`,
    };
};

module.exports = {
    buildCompanyDocumentEvidence,
    buildEvidenceCsv,
    buildEvidenceHtml,
    buildEvidencePdf,
};
