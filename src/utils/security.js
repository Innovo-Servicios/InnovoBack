const path = require('node:path');

const PRIVILEGED_ROLES = new Set(['administracion', 'supervisor']);
const ADMIN_ROLES = new Set(['administracion']);

const normalizeRole = (role) => String(role || '').trim().toLowerCase();
const normalizeRut = (rut) => String(rut || '').trim();

const isPrivilegedRole = (role) => PRIVILEGED_ROLES.has(normalizeRole(role));
const isAdminRole = (role) => ADMIN_ROLES.has(normalizeRole(role));

const isPrivilegedRequest = (req) => isPrivilegedRole(req.authz?.arquetipo || req.authUser?.arquetipo || req.authUser?.cargo || req.auth?.cargo);
const isAdminRequest = (req) => isAdminRole(req.authz?.arquetipo || req.authUser?.arquetipo || req.authUser?.cargo || req.auth?.cargo);

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

const getDocumentDisplayName = (documento) => {
    const explicitName = String(documento?.nombreOriginal || '').trim();
    if (explicitName) {
        return path.basename(explicitName);
    }

    const storedName = path.basename(String(documento?.url || 'documento'));
    return storedName
        .replace(/^file-\d+-[a-f0-9]{24}-/i, '')
        .replace(/^file-\d+-/, '')
        .replace(/^\d{10,}-/, '') || storedName;
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
        nombreOriginal: getDocumentDisplayName(plainDocument),
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

    const archetype = plainWorker.arquetipo || plainWorker.cargo || plainWorker.rol?.arquetipo;
    if (archetype) {
        plainWorker.arquetipo = archetype;
        plainWorker.cargo = archetype;
    }

    if (plainWorker.rol && typeof plainWorker.rol === 'object') {
        plainWorker.rol = {
            id: String(plainWorker.rol._id || plainWorker.rol.id),
            nombre: plainWorker.rol.nombre,
            arquetipo: plainWorker.rol.arquetipo || archetype,
        };
    }

    if (plainWorker.rolTemporal?.rol && typeof plainWorker.rolTemporal.rol === 'object') {
        plainWorker.rolTemporal.rol = {
            id: String(plainWorker.rolTemporal.rol._id || plainWorker.rolTemporal.rol.id),
            nombre: plainWorker.rolTemporal.rol.nombre,
            arquetipo: plainWorker.rolTemporal.rol.arquetipo || archetype,
        };
    }

    if (
        plainWorker.rolTemporal?.expiracion &&
        new Date(plainWorker.rolTemporal.expiracion).getTime() <= Date.now()
    ) {
        delete plainWorker.rolTemporal;
    }

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
