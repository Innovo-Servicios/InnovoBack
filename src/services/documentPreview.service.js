const fs = require('node:fs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const path = require('node:path');
const { documentos_MongooseModel } = require('../models/documentos.model.js');
const { DocumentoEmpresa } = require('../models/documentoEmpresa.model.js');
const { notificaciones_MongooseModel } = require('../models/notificacion.model.js');
const { trabajador_MongooseModel } = require('../models/trabajador.model.js');
const { getUserAccessContext } = require('./accessControl.service.js');
const {
    canAccessCompanyDocument,
    resolveCompanyDocumentPath,
} = require('./companyDocuments.service.js');

const DOCUMENT_PREVIEW_SOURCES = Object.freeze({
    WORKER: 'worker',
    COMPANY: 'company',
    NOTIFICATION: 'notification',
});

const DEFAULT_DOCUMENT_PREVIEW_TOKEN_TTL = '5m';
const DOCUMENT_PREVIEW_TOKEN_TYPE = 'document-preview';
const PDF_MIME_TYPE = 'application/pdf';
const WORKER_DOCUMENTS_ROOT = path.resolve(__dirname, '../../../TRABAJADORES');
const NOTIFICATION_UPLOAD_DIRS = [
    path.join(__dirname, '../../storage/uploads'),
    path.join(__dirname, '../../uploads'),
    '/home/backend/Innovo-app/Backend/uploads',
    ...(process.env.NOTIFICATION_UPLOAD_DIRS || '')
        .split(',')
        .map((uploadDir) => uploadDir.trim())
        .filter(Boolean),
].map((uploadDir) => path.resolve(uploadDir));

const createPreviewError = (status, message) => {
    const error = new Error(message);
    error.status = status;
    return error;
};

const normalizeObjectId = (value) => {
    if (!(typeof value === 'string' || value instanceof mongoose.Types.ObjectId)) {
        return null;
    }

    const normalized = String(value).trim();
    return mongoose.isValidObjectId(normalized) ? normalized : null;
};

const normalizePreviewRequest = ({ source, id } = {}) => {
    const normalizedSource = String(source || '').trim().toLowerCase();
    const normalizedId = normalizeObjectId(id);

    if (!Object.values(DOCUMENT_PREVIEW_SOURCES).includes(normalizedSource)) {
        throw createPreviewError(400, 'Origen de documento inválido');
    }

    if (!normalizedId) {
        throw createPreviewError(400, 'Documento inválido');
    }

    return { source: normalizedSource, id: normalizedId };
};

const hasPdfExtension = (value) => {
    const safeValue = String(value || '').split('?')[0];
    return path.extname(safeValue).toLowerCase() === '.pdf';
};

const isPdfPreview = ({ mimeType, fileName, filePath } = {}) => {
    const normalizedMimeType = String(mimeType || '').trim().toLowerCase();
    if (normalizedMimeType) {
        return normalizedMimeType === PDF_MIME_TYPE;
    }

    return hasPdfExtension(fileName) || hasPdfExtension(filePath);
};

const inferMimeTypeFromPath = (filePath) => {
    const extension = path.extname(String(filePath || '')).toLowerCase();
    if (extension === '.pdf') return PDF_MIME_TYPE;
    if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
    if (extension === '.png') return 'image/png';
    return null;
};

const sanitizeInlineFileName = (value) => {
    const fileName = path.basename(String(value || 'documento.pdf'));
    return fileName.replace(/["\r\n]/g, '_') || 'documento.pdf';
};

const ensurePdfDescriptor = (descriptor) => {
    if (!isPdfPreview(descriptor)) {
        throw createPreviewError(415, 'Solo se pueden previsualizar documentos PDF');
    }

    return {
        ...descriptor,
        mimeType: PDF_MIME_TYPE,
        fileName: sanitizeInlineFileName(descriptor.fileName || descriptor.filePath),
    };
};

const resolveSafeWorkerDocumentPath = (
    documentPath,
    {
        fsModule = fs,
        workerDocumentsRoot = WORKER_DOCUMENTS_ROOT,
    } = {}
) => {
    const normalizedPath = String(documentPath || '').trim();
    if (!normalizedPath) return null;

    const resolvedOriginalPath = path.resolve(normalizedPath);
    if (
        resolvedOriginalPath.startsWith(`${workerDocumentsRoot}${path.sep}`) &&
        fsModule.existsSync(resolvedOriginalPath)
    ) {
        return resolvedOriginalPath;
    }

    const safeFileName = path.basename(normalizedPath);
    const resolvedPath = path.join(workerDocumentsRoot, safeFileName);
    if (!resolvedPath.startsWith(`${workerDocumentsRoot}${path.sep}`)) {
        return null;
    }

    return resolvedPath;
};

const resolveNotificationAttachmentPath = (
    notificationPath,
    {
        fsModule = fs,
        notificationUploadDirs = NOTIFICATION_UPLOAD_DIRS,
    } = {}
) => {
    const safeFileName = path.basename(String(notificationPath || ''));
    if (!safeFileName) return null;

    return notificationUploadDirs
        .map((uploadDir) => path.join(uploadDir, safeFileName))
        .find((candidatePath) => {
            const resolvedPath = path.resolve(candidatePath);
            const allowedBasePath = notificationUploadDirs.find((uploadDir) =>
                resolvedPath.startsWith(`${uploadDir}${path.sep}`)
            );

            return Boolean(allowedBasePath) && fsModule.existsSync(resolvedPath);
        }) || null;
};

const getContextUserId = (context) => context?.user?._id || context?.authUser?._id;
const getContextRut = (context) => String(context?.user?.Rut || context?.authUser?.Rut || context?.auth?.rut || '').trim();
const getContextRole = (context) =>
    String(context?.authz?.arquetipo || context?.user?.arquetipo || context?.user?.cargo || context?.authUser?.arquetipo || context?.authUser?.cargo || '').trim().toLowerCase();

const canAccessForeignWorkerDocument = (context) =>
    ['administracion', 'supervisor'].includes(getContextRole(context));

const canAccessAllNotifications = (context) =>
    ['administracion', 'supervisor'].includes(getContextRole(context));

const buildRequestBaseUrl = (req) => {
    const configuredBaseUrl = String(process.env.DOCUMENT_PREVIEW_BASE_URL || '').trim();
    if (configuredBaseUrl) {
        return configuredBaseUrl.replace(/\/+$/, '');
    }

    return `${req.protocol}://${req.get('host')}`;
};

const getPreviewSecret = () => {
    const secret = process.env.DOCUMENT_PREVIEW_SECRET || process.env.JWT_SECRET;
    if (!secret) {
        throw createPreviewError(500, 'Falta configurar DOCUMENT_PREVIEW_SECRET o JWT_SECRET');
    }
    return secret;
};

const createDocumentPreviewService = ({
    companyDocumentModel = DocumentoEmpresa,
    documentModel = documentos_MongooseModel,
    fsModule = fs,
    getAccessContext = getUserAccessContext,
    jwtModule = jwt,
    notificationModel = notificaciones_MongooseModel,
    notificationUploadDirs = NOTIFICATION_UPLOAD_DIRS,
    resolveCompanyPath = resolveCompanyDocumentPath,
    workerDocumentsRoot = WORKER_DOCUMENTS_ROOT,
    workerModel = trabajador_MongooseModel,
} = {}) => {
    const resolveWorkerDescriptor = async ({ id, context }) => {
        const document = await documentModel.findById(id);
        if (!document) {
            throw createPreviewError(404, 'Documento no encontrado');
        }

        const worker = await workerModel.findOne({
            documentos: { $in: [new mongoose.Types.ObjectId(id)] },
        });
        if (!worker) {
            throw createPreviewError(404, 'Documento no encontrado');
        }

        if (!canAccessForeignWorkerDocument(context) && getContextRut(context) !== String(worker.Rut)) {
            throw createPreviewError(403, 'Permisos insuficientes');
        }

        const filePath = resolveSafeWorkerDocumentPath(document.url, {
            fsModule,
            workerDocumentsRoot,
        });
        if (!filePath || !fsModule.existsSync(filePath)) {
            throw createPreviewError(404, 'Archivo no encontrado');
        }

        return ensurePdfDescriptor({
            filePath,
            fileName: document.nombreOriginal || filePath,
            mimeType: document.formato,
            source: DOCUMENT_PREVIEW_SOURCES.WORKER,
        });
    };

    const resolveCompanyDescriptor = async ({ id, context }) => {
        const document = await companyDocumentModel.findById(id);
        if (!document) {
            throw createPreviewError(404, 'Documento no encontrado');
        }

        if (!canAccessCompanyDocument({
            document,
            workerId: getContextUserId(context),
            permissions: context?.authz?.permisos,
        })) {
            throw createPreviewError(403, 'No tienes acceso a este documento');
        }

        const filePath = resolveCompanyPath(document.archivo?.rutaRelativa);
        if (!filePath || !fsModule.existsSync(filePath)) {
            throw createPreviewError(404, 'Archivo no encontrado');
        }

        return ensurePdfDescriptor({
            filePath,
            fileName: document.archivo?.nombreOriginal || filePath,
            mimeType: document.archivo?.mimeType,
            source: DOCUMENT_PREVIEW_SOURCES.COMPANY,
        });
    };

    const findWorkerDocumentById = async (id, projection) => {
        const query = documentModel.findById(id);
        if (projection && query && typeof query.select === 'function') {
            return query.select(projection);
        }
        return query;
    };

    const resolveNotificationDescriptor = async ({ id, context }) => {
        const notification = await notificationModel.findById(id);
        if (!notification?.url) {
            throw createPreviewError(404, 'Documento no encontrado');
        }

        if (!canAccessAllNotifications(context)) {
            const workerId = String(getContextUserId(context) || '');
            const assignedWorkers = (notification.trabajadores || []).map((worker) => String(worker));
            if (!workerId || !assignedWorkers.includes(workerId)) {
                throw createPreviewError(403, 'Permisos insuficientes');
            }
        }

        const companyDocument = notification.documentoEmpresa
            ? await companyDocumentModel.findById(notification.documentoEmpresa)
            : null;
        const workerDocument = notification.documento
            ? await findWorkerDocumentById(notification.documento, 'formato nombreOriginal')
            : null;
        const filePath = companyDocument
            ? resolveCompanyPath(companyDocument.archivo?.rutaRelativa)
            : resolveNotificationAttachmentPath(notification.url, {
                fsModule,
                notificationUploadDirs,
            });
        if (!filePath || !fsModule.existsSync(filePath)) {
            throw createPreviewError(404, 'Archivo no encontrado');
        }

        const mimeType =
            companyDocument?.archivo?.mimeType ||
            workerDocument?.formato ||
            inferMimeTypeFromPath(filePath);
        const fileName =
            companyDocument?.archivo?.nombreOriginal ||
            workerDocument?.nombreOriginal ||
            notification.url ||
            filePath;

        return ensurePdfDescriptor({
            filePath,
            fileName,
            mimeType,
            source: DOCUMENT_PREVIEW_SOURCES.NOTIFICATION,
        });
    };

    const resolveDescriptor = async ({ source, id, context }) => {
        const normalized = normalizePreviewRequest({ source, id });
        if (normalized.source === DOCUMENT_PREVIEW_SOURCES.WORKER) {
            return resolveWorkerDescriptor({ id: normalized.id, context });
        }
        if (normalized.source === DOCUMENT_PREVIEW_SOURCES.COMPANY) {
            return resolveCompanyDescriptor({ id: normalized.id, context });
        }
        return resolveNotificationDescriptor({ id: normalized.id, context });
    };

    const buildTicketPayload = ({ source, id, context }) => ({
        type: DOCUMENT_PREVIEW_TOKEN_TYPE,
        source,
        id,
        sub: String(getContextUserId(context) || ''),
        rut: getContextRut(context),
        role: getContextRole(context),
        sessionVersion: context?.user?.sessionVersion || context?.authUser?.sessionVersion || 0,
    });

    const issuePreviewTicket = async ({
        source,
        id,
        context,
        baseUrl,
        tokenTtl = process.env.DOCUMENT_PREVIEW_TOKEN_TTL || DEFAULT_DOCUMENT_PREVIEW_TOKEN_TTL,
    }) => {
        const normalized = normalizePreviewRequest({ source, id });
        await resolveDescriptor({ ...normalized, context });

        const token = jwtModule.sign(buildTicketPayload({
            ...normalized,
            context,
        }), getPreviewSecret(), { expiresIn: tokenTtl });
        const decoded = jwtModule.decode(token);
        const expiresAt = decoded?.exp
            ? new Date(decoded.exp * 1000).toISOString()
            : new Date(Date.now() + 5 * 60 * 1000).toISOString();

        return {
            token,
            url: `${String(baseUrl || '').replace(/\/+$/, '')}/document-preview/${encodeURIComponent(token)}`,
            expiresAt,
        };
    };

    const contextFromTicket = async (decoded) => {
        const userId = normalizeObjectId(decoded?.sub);
        if (!userId) {
            throw createPreviewError(401, 'Vista de documento inválida');
        }

        const user = await workerModel.findById(userId);
        if (!user) {
            throw createPreviewError(401, 'Usuario no encontrado');
        }

        if (String(user.Rut || '') !== String(decoded.rut || '')) {
            throw createPreviewError(401, 'Vista de documento inválida');
        }

        if ((user.sessionVersion || 0) !== (decoded.sessionVersion || 0)) {
            throw createPreviewError(401, 'Sesión inválida');
        }

        return {
            auth: decoded,
            authUser: user,
            authz: await getAccessContext(user),
            user,
        };
    };

    const resolvePreviewTicket = async ({ ticket }) => {
        let decoded;
        try {
            decoded = jwtModule.verify(String(ticket || ''), getPreviewSecret());
        } catch (error) {
            const message = error?.name === 'TokenExpiredError'
                ? 'Vista de documento expirada'
                : 'Vista de documento inválida';
            throw createPreviewError(401, message);
        }

        if (decoded?.type !== DOCUMENT_PREVIEW_TOKEN_TYPE) {
            throw createPreviewError(401, 'Vista de documento inválida');
        }

        const normalized = normalizePreviewRequest(decoded);
        const context = await contextFromTicket(decoded);
        return resolveDescriptor({ ...normalized, context });
    };

    return {
        issuePreviewTicket,
        resolveDescriptor,
        resolvePreviewTicket,
    };
};

module.exports = {
    DEFAULT_DOCUMENT_PREVIEW_TOKEN_TTL,
    DOCUMENT_PREVIEW_SOURCES,
    createDocumentPreviewService,
    createPreviewError,
    buildRequestBaseUrl,
    hasPdfExtension,
    inferMimeTypeFromPath,
    isPdfPreview,
    normalizePreviewRequest,
    resolveNotificationAttachmentPath,
    resolveSafeWorkerDocumentPath,
    sanitizeInlineFileName,
};
