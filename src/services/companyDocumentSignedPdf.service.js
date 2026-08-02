const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mammoth = require('mammoth');
const QRCode = require('qrcode');
const sanitizeHtml = require('sanitize-html');
const { DocumentoEmpresa } = require('../models/documentoEmpresa.model.js');
const { notificacion_validacion_MongooseModel: NotificacionValidacion } = require('../models/notificacion_validacion.model.js');
const { renderAssignmentProgramPdf, escapeHtml } = require('../utils/asignacionProgramacionPdf.js');

const SIGNED_DOCUMENTS_ROOT = path.resolve(__dirname, '../../storage/documentos-firmados');
const TIMEZONE = 'America/Santiago';
const TEMPLATE_HTML_ALLOWED_TAGS = [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
    'blockquote', 'pre', 'code', 'span', 'div',
];
const TEMPLATE_HTML_ALLOWED_ATTRIBUTES = {
    table: ['border', 'cellpadding', 'cellspacing'],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
};

const normalizeName = (value) => String(value || '').trim().replace(/\s+/g, ' ');

const sanitizeTemplateHtml = (html) => sanitizeHtml(String(html || ''), {
    allowedTags: TEMPLATE_HTML_ALLOWED_TAGS,
    allowedAttributes: TEMPLATE_HTML_ALLOWED_ATTRIBUTES,
    allowedSchemes: [],
    disallowedTagsMode: 'discard',
    parser: {
        lowerCaseTags: true,
    },
}).trim();

const extractTemplateVariables = (...values) => Array.from(new Set(
    values
        .map((value) => String(value || ''))
        .join('\n')
        .match(/\{\{\s*[a-zA-Z0-9_.-]+\s*\}\}/g)
        ?.map((match) => match.replace(/[{}]/g, '').trim())
        .filter(Boolean) || []
)).sort((left, right) => left.localeCompare(right, 'es'));

const htmlToPlainText = (html) => sanitizeTemplateHtml(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<\/(td|th)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

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
    if (snapshot?.contenido || snapshot?.contenidoHtml) {
        return {
            nombre: snapshot.nombre || document.titulo,
            contenido: snapshot.contenido,
            contenidoHtml: sanitizeTemplateHtml(snapshot.contenidoHtml),
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

const renderTemplateHtml = (templateHtml, context) => {
    const sanitized = sanitizeTemplateHtml(templateHtml);
    return sanitized.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => (
        context[key] !== undefined ? escapeHtml(context[key]) : ''
    ));
};

const renderParagraphs = (value) => {
    const paragraphs = String(value || '')
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);

    return paragraphs.map((paragraph) =>
        `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`
    ).join('') || '<p>Sin contenido.</p>';
};

const renderTemplateBody = (template, context) => {
    if (template?.contenidoHtml) {
        return renderTemplateHtml(template.contenidoHtml, context) || '<p>Sin contenido.</p>';
    }

    return renderParagraphs(renderTemplateText(template?.contenido, context));
};

const buildTemplatePreviewHtml = ({ template, documentData = {}, signed = false } = {}) => {
    const now = new Date();
    const previewDocument = {
        titulo: documentData.titulo || template?.nombre || 'Documento generado desde plantilla',
        codigoVersionado: documentData.codigoVersionado || documentData.codigoBase || template?.codigoBase || 'DOC-VISTA-PREVIA',
        codigoBase: documentData.codigoBase || template?.codigoBase || '',
        version: documentData.version || 1,
        categoria: { nombre: documentData.categoria || 'Documentos empresariales' },
        fechaEmision: documentData.fechaEmision || now,
        fechaVencimiento: documentData.fechaVencimiento || null,
        responsableSistemaGestion: {
            nombre: documentData.responsableNombre || 'Paola Olivares',
            cargo: documentData.responsableCargo || 'Prevencion de Riesgos',
        },
    };
    const context = buildTemplateContext({
        document: previewDocument,
        trabajador: {
            Nombre: documentData.trabajadorNombre || 'Nombre del trabajador',
            Rut: documentData.trabajadorRut || '11.111.111-1',
            cargo: documentData.trabajadorCargo || 'Cargo del trabajador',
        },
        validation: {
            firmadoAt: now,
            aceptadoAt: signed ? now : null,
        },
        codigoValidacion: signed ? 'FES-2026-EJEMPLO1234' : 'Pendiente de firma',
    });
    const renderedContent = renderTemplateBody(template, context);

    return `<!doctype html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <title>${escapeHtml(previewDocument.titulo)}</title>
    <style>
        @page { size: A4 portrait; margin: 14mm; }
        * { box-sizing: border-box; }
        body { margin: 0; color: #172033; font-family: Arial, sans-serif; font-size: 12px; line-height: 1.45; }
        header { border-bottom: 3px solid #0f766e; padding-bottom: 12px; margin-bottom: 18px; }
        h1 { margin: 0 0 6px; font-size: 22px; color: #0f172a; }
        h2 { margin: 16px 0 8px; font-size: 16px; color: #0f172a; }
        h3 { margin: 14px 0 8px; font-size: 14px; color: #0f172a; }
        p { margin: 0 0 8px; }
        ul, ol { margin: 0 0 10px 18px; padding: 0; }
        table { width: 100%; border-collapse: collapse; margin: 12px 0; table-layout: fixed; }
        th, td { border: 1px solid #cbd5e1; padding: 6px; vertical-align: top; word-wrap: break-word; }
        th { background: #e5eef8; color: #0f172a; }
        .brand { font-weight: 800; color: #0f766e; text-transform: uppercase; }
        .content { min-height: 520px; }
        .signature-preview { margin-top: 18px; padding: 12px; border: 1px dashed #0f766e; color: #0f766e; }
        footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #cbd5e1; color: #64748b; font-size: 9px; }
    </style>
</head>
<body>
    <header>
        <div class="brand">Innovo Servicios</div>
        <h1>${escapeHtml(previewDocument.titulo)}</h1>
        <p>${escapeHtml(previewDocument.codigoVersionado || 'Documento generado desde plantilla')}</p>
    </header>
    <section class="content">${renderedContent}</section>
    <section class="signature-preview">
        <strong>Firma electronica simple:</strong> ${escapeHtml(context['firma.codigo'])}
    </section>
    <footer>Vista previa generada desde plantilla. La copia firmada individual incorporara trabajador, codigo de validacion y QR.</footer>
</body>
</html>`;
};

const importDocxTemplate = async (file) => {
    if (!file?.buffer) {
        const error = new Error('Debes seleccionar un archivo DOCX');
        error.status = 400;
        throw error;
    }

    const extension = path.extname(String(file.originalname || '')).toLowerCase();
    if (
        extension !== '.docx' ||
        String(file.mimetype || '').toLowerCase() !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
        const error = new Error('Solo se permite importar plantillas DOCX');
        error.status = 400;
        throw error;
    }

    const result = await mammoth.convertToHtml(
        { buffer: file.buffer },
        {
            styleMap: [
                "p[style-name='Title'] => h1:fresh",
                "p[style-name='Subtitle'] => h2:fresh",
                "p[style-name='Heading 1'] => h1:fresh",
                "p[style-name='Heading 2'] => h2:fresh",
                "p[style-name='Heading 3'] => h3:fresh",
            ],
        }
    );
    const contenidoHtml = sanitizeTemplateHtml(result.value);
    const contenido = htmlToPlainText(contenidoHtml);

    if (contenido.length < 10) {
        const error = new Error('No se pudo extraer contenido editable desde el DOCX');
        error.status = 400;
        throw error;
    }

    return {
        nombre: path.basename(file.originalname, extension),
        contenido,
        contenidoHtml,
        variablesDetectadas: extractTemplateVariables(contenidoHtml, contenido),
        archivoBase: {
            nombreOriginal: path.basename(String(file.originalname || 'plantilla.docx')),
            mimeType: file.mimetype,
            tamano: file.size || file.buffer.length,
            importadoAt: new Date(),
        },
        advertencias: (result.messages || []).map((message) => String(message.message || message).trim()).filter(Boolean),
    };
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
    const renderedContent = renderTemplateBody(template, context);
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
        ul, ol { margin: 0 0 10px 18px; padding: 0; }
        table { width: 100%; border-collapse: collapse; margin: 12px 0; table-layout: fixed; }
        th, td { border: 1px solid #cbd5e1; padding: 6px; vertical-align: top; word-wrap: break-word; }
        th { background: #e5eef8; color: #0f172a; }
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
        ${renderedContent}
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
    const html = buildTemplatePreviewHtml({ template, documentData });

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
    buildTemplatePreviewHtml,
    buildVerificationUrl,
    ensureCompanyDocumentSignedPdf,
    extractTemplateVariables,
    htmlToPlainText,
    importDocxTemplate,
    resolveSignedDocumentPath,
    sanitizeTemplateHtml,
    renderTemplateText,
};
