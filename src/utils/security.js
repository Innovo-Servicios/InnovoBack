const path = require('node:path');

const PRIVILEGED_ROLES = new Set(['administracion', 'supervisor']);
const ADMIN_ROLES = new Set(['administracion']);

const normalizeRole = (role) => String(role || '').trim().toLowerCase();
const normalizeRut = (rut) => String(rut || '').trim();

const isPrivilegedRole = (role) => PRIVILEGED_ROLES.has(normalizeRole(role));
const isAdminRole = (role) => ADMIN_ROLES.has(normalizeRole(role));

const isPrivilegedRequest = (req) => isPrivilegedRole(req.authUser?.cargo || req.auth?.cargo);
const isAdminRequest = (req) => isAdminRole(req.authUser?.cargo || req.auth?.cargo);

const getAuthRut = (req) => normalizeRut(req.authUser?.Rut || req.auth?.rut);

const canAccessRut = (req, targetRut) =>
    isPrivilegedRequest(req) || getAuthRut(req) === normalizeRut(targetRut);

const buildAssetUrl = (type, filePath) => {
    if (!filePath) {
        return null;
    }

    const fileName = path.basename(String(filePath));
    return fileName ? `/assets/${type}/${encodeURIComponent(fileName)}` : null;
};

const sanitizeDocumentForClient = (documento) => {
    if (!documento) {
        return documento;
    }

    const plainDocument = typeof documento.toObject === 'function'
        ? documento.toObject()
        : { ...documento };

    return {
        ...plainDocument,
        url: `/documento/archivo/${plainDocument._id}/${encodeURIComponent(path.basename(String(plainDocument.url || 'documento')))}`,
    };
};

const sanitizeWorkerForClient = (worker, options = {}) => {
    if (!worker) {
        return worker;
    }

    const plainWorker = typeof worker.toObject === 'function'
        ? worker.toObject()
        : { ...worker };

    delete plainWorker.clave;
    delete plainWorker.refreshTokens;
    delete plainWorker.sessionVersion;
    delete plainWorker.tokenPush;
    delete plainWorker.ID;

    if (!options.includeLastUbication) {
        delete plainWorker.lastUbication;
    }

    if (!options.includeNotificationRefs) {
        delete plainWorker.notificaciones;
        delete plainWorker.vistas;
        delete plainWorker.notificacionesEliminadas;
    }

    if (plainWorker.perfil) {
        plainWorker.perfil = buildAssetUrl('perfiles', plainWorker.perfil);
    }

    if (Array.isArray(plainWorker.documentos)) {
        plainWorker.documentos = plainWorker.documentos.map(sanitizeDocumentForClient);
    }

    return plainWorker;
};

module.exports = {
    buildAssetUrl,
    canAccessRut,
    getAuthRut,
    isAdminRequest,
    isPrivilegedRequest,
    normalizeRole,
    sanitizeDocumentForClient,
    sanitizeWorkerForClient,
};
