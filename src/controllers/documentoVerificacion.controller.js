const { buildPublicVerification } = require('../services/companyDocumentSignedPdf.service.js');
const { escapeHtml } = require('../utils/asignacionProgramacionPdf.js');

const formatDateTime = (value) => {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '-';
    return parsed.toLocaleString('es-CL', { timeZone: 'America/Santiago' });
};

const renderVerificationHtml = (verification) => `<!doctype html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Verificacion documental Innovo</title>
    <style>
        body { margin: 0; background: #f8fafc; color: #172033; font-family: Arial, sans-serif; }
        main { max-width: 760px; margin: 0 auto; padding: 28px 18px; }
        section { border: 1px solid #cbd5e1; border-radius: 8px; background: white; padding: 20px; }
        h1 { margin: 0 0 6px; font-size: 24px; color: #0f766e; }
        h2 { margin: 18px 0 8px; font-size: 16px; }
        p { margin: 6px 0; }
        .code { display: inline-block; margin: 10px 0; padding: 8px 10px; border: 1px solid #0f766e; border-radius: 6px; font-weight: 800; }
        .ok { color: #0f766e; font-weight: 800; }
    </style>
</head>
<body>
    <main>
        <section>
            <h1>Documento verificado</h1>
            <p class="ok">El codigo existe en los registros de Innovo Servicios.</p>
            <span class="code">${escapeHtml(verification.codigoValidacion)}</span>
            <h2>Documento</h2>
            <p><strong>Titulo:</strong> ${escapeHtml(verification.documento?.titulo || '-')}</p>
            <p><strong>Codigo:</strong> ${escapeHtml(verification.documento?.codigoVersionado || '-')}</p>
            <p><strong>Version:</strong> ${escapeHtml(verification.documento?.version || '-')}</p>
            <h2>Trabajador</h2>
            <p><strong>Nombre:</strong> ${escapeHtml(verification.trabajador?.nombre || '-')}</p>
            <p><strong>RUT:</strong> ${escapeHtml(verification.trabajador?.rut || '-')}</p>
            <p><strong>Cargo:</strong> ${escapeHtml(verification.trabajador?.cargo || '-')}</p>
            <h2>Firma</h2>
            <p><strong>Estado:</strong> ${escapeHtml(verification.estado || '-')}</p>
            <p><strong>Firmado:</strong> ${escapeHtml(formatDateTime(verification.firmadoAt))}</p>
            <p><strong>Aceptado:</strong> ${escapeHtml(formatDateTime(verification.aceptadoAt))}</p>
        </section>
    </main>
</body>
</html>`;

const verificarDocumento = async (req, res) => {
    const codigo = String(req.params.codigo || '').trim().toUpperCase();
    if (!/^FES-\d{4}-[A-F0-9]{10}$/.test(codigo)) {
        return res.status(400).send('Codigo de verificacion invalido');
    }

    const verification = await buildPublicVerification(codigo);
    if (!verification) {
        return res.status(404).send('Documento no encontrado');
    }

    if (String(req.headers.accept || '').includes('application/json')) {
        return res.json(verification);
    }
    return res.type('html').send(renderVerificationHtml(verification));
};

module.exports = { verificarDocumento };
