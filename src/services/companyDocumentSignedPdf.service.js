const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const QRCode = require('qrcode');
const { DocumentoEmpresa } = require('../models/documentoEmpresa.model.js');
const { notificacion_validacion_MongooseModel: NotificacionValidacion } = require('../models/notificacion_validacion.model.js');
const { renderAssignmentProgramPdf, escapeHtml } = require('../utils/asignacionProgramacionPdf.js');

const SIGNED_DOCUMENTS_ROOT = path.resolve(__dirname, '../../storage/documentos-firmados');
const TIMEZONE = 'America/Santiago';

const normalizeName = (value) => String(value || '').trim().replace(/\s+/g, ' ');

const safeFileSegment = (value, fallback = 'documento') => (
    normalizeName(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80) || fallback
);

const formatDateTime = (value) => {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleString('es-CL', { timeZone: TIMEZONE });
};

const formatDate = (value) => {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleDateString('es-CL', { timeZone: TIMEZONE });
};

const getPublicApiBase = () => (
    process.env.PUBLIC_API_URL ||
    process.env.API_PUBLIC_URL ||
    process.env.BACKEND_PUBLIC_URL ||
    'https://api.innovoservicios.cl'
).replace(/\/+$/, '');

const buildVerificationUrl = (codigoValidacion) =>
    `${getPublicApiBase()}/documento-verificacion/${encodeURIComponent(codigoValidacion)}`;

const generateValidationCode = async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const code = `FES-${new Date().getFullYear()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
        const exists = await NotificacionValidacion.exists({ codigoValidacion: code });
        if (!exists) return code;
    }
    throw new Error('No se pudo generar código único de validación');
};

const resolveInsideRoot = (relativePath) => {
    const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const resolved = path.resolve(SIGNED_DOCUMENTS_ROOT, normalized);
    if (resolved !== SIGNED_DOCUMENTS_ROOT && !resolved.startsWith(`${SIGNED_DOCUMENTS_ROOT}${path.sep}`)) {
        return null;
    }
    return resolved;
};

const resolveSignedDocumentPath = (relativePath) => {
    const resolved = resolveInsideRoot(relativePath);
    return resolved && fs.existsSync(resolved) ? resolved : null;
};

const getTemplateSnapshot = (document) => {
    const snapshot = document?.plantillaDocumental;
    if (snapshot?.contenido) {
        return {
            nombre: snapshot.nombre || document.titulo,
            contenido: snapshot.contenido,
            textoAceptacion: snapshot.textoAceptacion || '',
            version: snapshot.version || 1,
        };
    }

    return {
        nombre: document?.titulo || 'Documento empresarial',
        contenido: [
            `Documento: ${document?.titulo || ''}`,
            document?.descripcion || '',
            document?.codigoVersionado ? `Codigo: ${document.codigoVersionado}` : '',
            `Version: ${document?.version || ''}`,
        ].filter(Boolean).join('\n\n'),
        textoAceptacion: 'Declaro haber recibido, leido, comprendido y aceptado el contenido de este documento.',
        version: document?.version || 1,
    };
};

const buildTemplateContext = ({ document, trabajador, validation, codigoValidacion }) => {
    const signedAt = validation.aceptadoAt || validation.firmadoAt || new Date();
    const workerName = trabajador?.Nombre || trabajador?.nombre || '';
    const workerRut = trabajador?.Rut || trabajador?.rut || '';
    const workerRole = trabajador?.arquetipo || trabajador?.cargo || '';
    const categoryName = document?.categoria?.nombre || '';
    const responsible = document?.responsableSistemaGestion || {};

    return {
        'trabajador.nombre': workerName,
        'trabajador.rut': workerRut,
        'trabajador.cargo': workerRole,
        'nombre': workerName,
        'rut': workerRut,
        'cargo': workerRole,
        'documento.titulo': document?.titulo || '',
        'documento.codigo': document?.codigoVersionado || document?.codigoBase || '',
        'documento.version': String(document?.version || ''),
        'documento.categoria': categoryName,
        'documento.fechaEmision': formatDate(document?.fechaEmision),
        'documento.fechaVencimiento': formatDate(document?.fechaVencimiento),
        'responsable.nombre': responsible.nombre || '',
        'responsable.cargo': responsible.cargo || '',
        'firma.codigo': codigoValidacion || '',
        'firma.fecha': formatDateTime(signedAt),
        'fecha': formatDateTime(signedAt),
        'empresa': 'Innovo Servicios',
    };
};

const renderTemplateText = (templateText, context) => (
    String(templateText || '').replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => (
        context[key] !== undefined ? String(context[key]) : ''
    ))
);

const renderParagraphs = (value) => {
    const paragraphs = String(value || '')
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);

    return paragraphs.map((paragraph) =>
        `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`
    ).join('') || '<p>Sin contenido.</p>';
};

const buildSignedDocumentHtml = async ({ document, trabajador, validation, codigoValidacion }) => {
    const template = getTemplateSnapshot(document);
    const verificationUrl = buildVerificationUrl(codigoValidacion);
    const qrDataUrl = await QRCode.toDataURL(verificationUrl, {
        margin: 1,
        width: 180,
        errorCorrectionLevel: 'M',
    });
    const context = buildTemplateContext({ document, trabajador, validation, codigoValidacion });
    const renderedContent = renderTemplateText(template.contenido, context);
    const renderedAcceptance = renderTemplateText(template.textoAceptacion, context);

    return `<!doctype html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <title>${escapeHtml(document.titulo)} firmado</title>
    <style>
        @page { size: A4 portrait; margin: 14mm; }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            color: #172033;
            font-family: Arial, sans-serif;
            font-size: 12px;
            line-height: 1.45;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        header {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 16px;
            border-bottom: 3px solid #0f766e;
            padding-bottom: 12px;
            margin-bottom: 18px;
        }
        h1 { margin: 0 0 6px; font-size: 22px; color: #0f172a; }
        h2 { margin: 18px 0 8px; font-size: 14px; color: #0f172a; }
        p { margin: 0 0 8px; }
        .brand { font-weight: 800; letter-spacing: 0; color: #0f766e; text-transform: uppercase; }
        .meta {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 6px 18px;
            margin: 14px 0;
            padding: 10px;
            border: 1px solid #cbd5e1;
            background: #f8fafc;
        }
        .content {
            min-height: 330px;
            padding: 12px 0;
            white-space: normal;
        }
        .signature {
            display: grid;
            grid-template-columns: 1fr 190px;
            gap: 18px;
            margin-top: 20px;
            padding: 14px;
            border: 2px solid #0f766e;
            background: #ecfdf5;
            break-inside: avoid;
        }
        .code {
            display: inline-block;
            margin-top: 6px;
            padding: 6px 8px;
            border: 1px solid #0f766e;
            background: white;
            color: #0f172a;
            font-size: 15px;
            font-weight: 800;
            letter-spacing: 0;
        }
        .qr { text-align: center; font-size: 9px; color: #475569; }
        .qr img { width: 160px; height: 160px; }
        footer {
            margin-top: 18px;
            padding-top: 8px;
            border-top: 1px solid #cbd5e1;
            color: #64748b;
            font-size: 9px;
        }
    </style>
</head>
<body>
    <header>
        <div>
            <div class="brand">Innovo Servicios</div>
            <h1>${escapeHtml(document.titulo)}</h1>
            <p>${escapeHtml(document.codigoVersionado || document.codigoBase || `Version ${document.version}`)}</p>
        </div>
        <div>
            <p><strong>Version:</strong> ${escapeHtml(document.version)}</p>
            <p><strong>Emision:</strong> ${escapeHtml(formatDate(document.fechaEmision) || '-')}</p>
            <p><strong>Categoria:</strong> ${escapeHtml(document.categoria?.nombre || '-')}</p>
        </div>
    </header>

    <section class="meta">
        <p><strong>Trabajador:</strong> ${escapeHtml(context['trabajador.nombre'])}</p>
        <p><strong>RUT:</strong> ${escapeHtml(context['trabajador.rut'])}</p>
        <p><strong>Cargo:</strong> ${escapeHtml(context['trabajador.cargo'] || '-')}</p>
        <p><strong>Fecha validacion:</strong> ${escapeHtml(context['firma.fecha'])}</p>
        <p><strong>Responsable SGI:</strong> ${escapeHtml(context['responsable.nombre'] || '-')}</p>
        <p><strong>Cargo responsable:</strong> ${escapeHtml(context['responsable.cargo'] || '-')}</p>
    </section>

    <section class="content">
        ${renderParagraphs(renderedContent)}
    </section>

    <section class="signature">
        <div>
            <h2>Firma electronica simple por codigo</h2>
            ${renderParagraphs(renderedAcceptance)}
            <p><strong>Codigo de validacion:</strong></p>
            <span class="code">${escapeHtml(codigoValidacion)}</span>
            <p style="margin-top:10px;">Validado desde la sesion personal del trabajador en App Innovo.</p>
        </div>
        <div class="qr">
            <img alt="QR de verificacion" src="${qrDataUrl}">
            <p>Escanear para verificar autenticidad.</p>
        </div>
    </section>

    <footer>
        Este documento fue generado electronicamente y conserva trazabilidad de trabajador, documento, version, fecha, codigo y registro de validacion.
    </footer>
</body>
</html>`;
};

const saveSignedPdf = async ({ html, document, trabajador, validation }) => {
    const buffer = await renderAssignmentProgramPdf(html);
    const now = new Date();
    const relativeDir = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
    const directory = resolveInsideRoot(relativeDir);
    if (!directory) throw new Error('Ruta de documento firmado invalida');
    await fs.promises.mkdir(directory, { recursive: true });

    const fileName = `${Date.now()}-${safeFileSegment(document.codigoVersionado || document.titulo)}-${safeFileSegment(trabajador?.Rut || trabajador?.rut || validation.trabajador)}.pdf`;
    const absolutePath = path.join(directory, fileName);
    await fs.promises.writeFile(absolutePath, buffer, { flag: 'wx' });

    return {
        nombreOriginal: `firmado-${safeFileSegment(document.codigoVersionado || document.titulo)}-${safeFileSegment(trabajador?.Rut || trabajador?.rut || 'trabajador')}.pdf`,
        nombreAlmacenado: fileName,
        rutaRelativa: `${relativeDir}/${fileName}`,
        mimeType: 'application/pdf',
        tamano: buffer.length,
        generadoAt: now,
    };
};

const ensureCompanyDocumentSignedPdf = async ({ validation, trabajador }) => {
    if (!validation?.documentoEmpresa) return null;

    if (validation.documentoFirmado?.rutaRelativa && validation.codigoValidacion) {
        return validation.documentoFirmado;
    }

    const document = await DocumentoEmpresa.findById(validation.documentoEmpresa).populate('categoria');
    if (!document) return null;

    const codigoValidacion = validation.codigoValidacion || await generateValidationCode();
    const html = await buildSignedDocumentHtml({
        document,
        trabajador,
        validation,
        codigoValidacion,
    });
    const saved = await saveSignedPdf({ html, document, trabajador, validation });
    const verificationUrl = buildVerificationUrl(codigoValidacion);

    validation.codigoValidacion = codigoValidacion;
    validation.documentoFirmado = {
        ...saved,
        verificationUrl,
    };
    await validation.save();

    return validation.documentoFirmado;
};

const buildTemplateMasterPdf = async ({ template, documentData = {} }) => {
    const now = new Date();
    const context = {
        'trabajador.nombre': 'Nombre del trabajador',
        'trabajador.rut': 'RUT del trabajador',
        'trabajador.cargo': 'Cargo del trabajador',
        'nombre': 'Nombre del trabajador',
        'rut': 'RUT del trabajador',
        'cargo': 'Cargo del trabajador',
        'documento.titulo': documentData.titulo || template.nombre,
        'documento.codigo': documentData.codigoVersionado || documentData.codigoBase || template.codigoBase || '',
        'documento.version': String(documentData.version || 1),
        'documento.categoria': documentData.categoria || '',
        'documento.fechaEmision': formatDate(documentData.fechaEmision || now),
        'documento.fechaVencimiento': formatDate(documentData.fechaVencimiento),
        'responsable.nombre': documentData.responsableNombre || 'Paola Olivares',
        'responsable.cargo': documentData.responsableCargo || 'Prevencion de Riesgos',
        'firma.codigo': 'Pendiente de firma',
        'firma.fecha': 'Pendiente de firma',
        'fecha': formatDateTime(now),
        'empresa': 'Innovo Servicios',
    };
    const renderedContent = renderTemplateText(template.contenido, context);

    const html = `<!doctype html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <title>${escapeHtml(documentData.titulo || template.nombre)}</title>
    <style>
        @page { size: A4 portrait; margin: 14mm; }
        body { margin: 0; color: #172033; font-family: Arial, sans-serif; font-size: 12px; line-height: 1.45; }
        header { border-bottom: 3px solid #0f766e; padding-bottom: 12px; margin-bottom: 18px; }
        h1 { margin: 0 0 6px; font-size: 22px; color: #0f172a; }
        .brand { font-weight: 800; color: #0f766e; text-transform: uppercase; }
        .content { min-height: 520px; }
        footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #cbd5e1; color: #64748b; font-size: 9px; }
    </style>
</head>
<body>
    <header>
        <div class="brand">Innovo Servicios</div>
        <h1>${escapeHtml(documentData.titulo || template.nombre)}</h1>
        <p>${escapeHtml(documentData.codigoVersionado || documentData.codigoBase || template.codigoBase || 'Documento generado desde plantilla')}</p>
    </header>
    <section class="content">${renderParagraphs(renderedContent)}</section>
    <footer>Documento base generado desde plantilla. La copia firmada individual incorpora trabajador, codigo de validacion y QR.</footer>
</body>
</html>`;

    return {
        buffer: await renderAssignmentProgramPdf(html),
        html,
    };
};

const buildPublicVerification = async (codigoValidacion) => {
    const validation = await NotificacionValidacion.findOne({ codigoValidacion })
        .populate({
            path: 'documentoEmpresa',
            populate: { path: 'categoria' },
        })
        .populate('trabajador')
        .lean();

    if (!validation) return null;
    const document = validation.documentoEmpresa;
    const trabajador = validation.trabajador;

    return {
        codigoValidacion: validation.codigoValidacion,
        estado: validation.estado,
        firmadoAt: validation.firmadoAt || null,
        aceptadoAt: validation.aceptadoAt || null,
        documento: document ? {
            titulo: document.titulo,
            codigoVersionado: document.codigoVersionado || document.codigoBase || '',
            version: document.version,
            categoria: document.categoria?.nombre || '',
        } : null,
        trabajador: trabajador ? {
            nombre: trabajador.Nombre,
            rut: trabajador.Rut,
            cargo: trabajador.arquetipo || trabajador.cargo || '',
        } : null,
        documentoFirmado: validation.documentoFirmado ? {
            generadoAt: validation.documentoFirmado.generadoAt || null,
            tamano: validation.documentoFirmado.tamano || 0,
        } : null,
    };
};

module.exports = {
    SIGNED_DOCUMENTS_ROOT,
    buildPublicVerification,
    buildTemplateMasterPdf,
    buildVerificationUrl,
    ensureCompanyDocumentSignedPdf,
    resolveSignedDocumentPath,
    renderTemplateText,
};
