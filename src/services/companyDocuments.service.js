const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const moment = require('moment-timezone');

const COMPANY_DOCUMENTS_ROOT = path.resolve(__dirname, '../../storage/documentos-empresa');
const COMPANY_DOCUMENT_ALLOWED_MIME_TYPES = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const COMPANY_DOCUMENT_ALLOWED_EXTENSIONS = new Set([
    '.pdf', '.jpeg', '.jpg', '.png', '.doc', '.docx', '.xls', '.xlsx',
]);

const normalizeName = (value) => String(value || '').trim().replace(/\s+/g, ' ');

const slugifyCategory = (value) => normalizeName(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'categoria';

const resolveInsideRoot = (relativePath) => {
    const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const resolved = path.resolve(COMPANY_DOCUMENTS_ROOT, normalized);
    if (resolved !== COMPANY_DOCUMENTS_ROOT && !resolved.startsWith(`${COMPANY_DOCUMENTS_ROOT}${path.sep}`)) {
        return null;
    }
    return resolved;
};

const ensureCategoryDirectory = async (slug) => {
    const safeSlug = slugifyCategory(slug);
    const directory = resolveInsideRoot(safeSlug);
    if (!directory) throw new Error('Carpeta de categoría inválida');
    await fs.promises.mkdir(directory, { recursive: true });
    return { directory, relative: safeSlug };
};

const isAllowedCompanyDocument = (file) => {
    if (!file) return false;
    const extension = path.extname(String(file.originalname || '')).toLowerCase();
    return COMPANY_DOCUMENT_ALLOWED_EXTENSIONS.has(extension) &&
        COMPANY_DOCUMENT_ALLOWED_MIME_TYPES.has(String(file.mimetype || '').toLowerCase());
};

const buildStoredFileName = (originalName) => {
    const parsed = path.parse(path.basename(String(originalName || 'documento')));
    const base = parsed.name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 70) || 'documento';
    return `${Date.now()}-${crypto.randomUUID()}-${base}${parsed.ext.toLowerCase()}`;
};

const saveCompanyDocumentFile = async ({ categorySlug, file }) => {
    if (!isAllowedCompanyDocument(file)) {
        const error = new Error('Formato de archivo no permitido');
        error.status = 400;
        throw error;
    }
    const { directory, relative } = await ensureCategoryDirectory(categorySlug);
    const fileName = buildStoredFileName(file.originalname);
    const absolutePath = path.join(directory, fileName);
    if (!absolutePath.startsWith(`${directory}${path.sep}`)) {
        throw new Error('Ruta de archivo inválida');
    }
    await fs.promises.writeFile(absolutePath, file.buffer, { flag: 'wx' });
    return {
        absolutePath,
        file: {
            nombreOriginal: path.basename(String(file.originalname || 'documento')),
            nombreAlmacenado: fileName,
            rutaRelativa: `${relative}/${fileName}`,
            mimeType: file.mimetype,
            tamano: file.size,
        },
    };
};

const deleteSavedFile = async (absolutePath) => {
    if (!absolutePath || !absolutePath.startsWith(`${COMPANY_DOCUMENTS_ROOT}${path.sep}`)) return;
    await fs.promises.unlink(absolutePath).catch(() => undefined);
};

const resolveCompanyDocumentPath = (relativePath) => {
    const resolved = resolveInsideRoot(relativePath);
    return resolved && fs.existsSync(resolved) ? resolved : null;
};

const startOfLocalDay = (value = new Date(), timeZone = 'America/Santiago') => {
    return moment(value).tz(timeZone).startOf('day').toDate();
};

const daysUntilExpiration = (expiration, now = new Date()) => {
    if (!expiration) return null;
    const expirationDay = startOfLocalDay(new Date(expiration));
    const today = startOfLocalDay(now);
    return Math.round((expirationDay.getTime() - today.getTime()) / 86400000);
};

const getExpirationStatus = ({ estado, fechaVencimiento, diasAviso = 30 }, now = new Date()) => {
    if (estado === 'archivado' || estado === 'reemplazado') return estado;
    const remaining = daysUntilExpiration(fechaVencimiento, now);
    if (remaining === null) return 'vigente';
    if (remaining < 0) return 'vencido';
    if (remaining <= diasAviso) return 'por_vencer';
    return 'vigente';
};

const getExpirationMilestone = ({ fechaVencimiento, diasAviso = 30 }, now = new Date()) => {
    const remaining = daysUntilExpiration(fechaVencimiento, now);
    if (remaining === null || remaining > diasAviso) return { level: 0, remaining };
    if (remaining < 0) return { level: 4, remaining };
    if (remaining <= 1) return { level: 3, remaining };
    if (diasAviso >= 7 && remaining <= 7) return { level: 2, remaining };
    return { level: 1, remaining };
};

const canAccessCompanyDocument = ({ document, workerId, permissions = [] }) => {
    if (!document) return false;
    if (new Set(permissions).has('documentos_empresa.ver')) return true;
    return Boolean(workerId) && document.esGlobal === true && document.estado === 'vigente';
};

const buildWorkerVisibleCompanyDocumentQuery = () => ({
    esGlobal: true,
    estado: 'vigente',
});

module.exports = {
    COMPANY_DOCUMENTS_ROOT,
    COMPANY_DOCUMENT_ALLOWED_EXTENSIONS,
    COMPANY_DOCUMENT_ALLOWED_MIME_TYPES,
    buildStoredFileName,
    buildWorkerVisibleCompanyDocumentQuery,
    canAccessCompanyDocument,
    daysUntilExpiration,
    deleteSavedFile,
    ensureCategoryDirectory,
    getExpirationMilestone,
    getExpirationStatus,
    isAllowedCompanyDocument,
    normalizeName,
    resolveInsideRoot,
    resolveCompanyDocumentPath,
    saveCompanyDocumentFile,
    slugifyCategory,
};
