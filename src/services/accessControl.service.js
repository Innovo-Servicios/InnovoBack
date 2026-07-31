const mongoose = require('mongoose');
const { ArquetipoRol } = require('../models/arquetipoRol.model.js');
const { Permiso } = require('../models/permiso.model.js');
const { Rol } = require('../models/rol.model.js');
const {
    ADMIN_REQUIRED_PERMISSIONS,
    ARCHETYPE_DEFAULTS,
    ARCHETYPE_LABELS,
    PERMISSION_DEFINITIONS,
} = require('../config/accessControl.js');

const normalizeArchetype = (value) => String(value || '').trim().toLowerCase();
const normalizePermissionKey = (value) => String(value || '').trim().toLowerCase();

const canUseTemporaryRole = ({ role, permanentArchetype, expiresAt, now = Date.now() }) => Boolean(
    role &&
    role.activo !== false &&
    expiresAt &&
    new Date(expiresAt).getTime() > now &&
    normalizeArchetype(role.arquetipo) === normalizeArchetype(permanentArchetype)
);

const permissionKeysFromRole = (role) => {
    if (!role || !Array.isArray(role.permisos)) return [];

    return role.permisos
        .map((permission) => normalizePermissionKey(permission?.clave))
        .filter(Boolean);
};

const populateRole = async (roleId) => {
    if (!roleId || !mongoose.isValidObjectId(roleId)) return null;
    return Rol.findById(roleId).populate({
        path: 'permisos',
        match: { activo: { $ne: false }, clave: { $exists: true } },
        select: 'clave modulo accion nombre descripcion orden activo',
    });
};

const getUserAccessContext = async (user) => {
    const permanentRole = await populateRole(user?.rol);
    const permanentArchetype = normalizeArchetype(
        permanentRole?.arquetipo || user?.arquetipo || user?.cargo
    );

    let temporaryRole = null;
    const temporaryExpiresAt = user?.rolTemporal?.expiracion
        ? new Date(user.rolTemporal.expiracion)
        : null;
    const temporaryIsActive = Boolean(
        user?.rolTemporal?.rol &&
        temporaryExpiresAt &&
        temporaryExpiresAt.getTime() > Date.now()
    );

    if (temporaryIsActive) {
        const candidate = await populateRole(user.rolTemporal.rol);
        if (canUseTemporaryRole({
            role: candidate,
            permanentArchetype,
            expiresAt: temporaryExpiresAt,
        })) {
            temporaryRole = candidate;
        }
    }

    const effectiveRole = temporaryRole || permanentRole;
    let permissions = permissionKeysFromRole(effectiveRole);

    // Compatibilidad antes de ejecutar la migración: solo los roles heredados
    // reciben el conjunto histórico. Un rol nuevo puede tener cero permisos.
    if (!effectiveRole || effectiveRole.legado || !effectiveRole.arquetipo) {
        permissions = [...(ARCHETYPE_DEFAULTS[permanentArchetype] || [])];
    }

    if (permanentArchetype === 'administracion') {
        permissions.push(...ADMIN_REQUIRED_PERMISSIONS);
    }

    return {
        arquetipo: permanentArchetype,
        permisos: [...new Set(permissions)],
        rol: effectiveRole ? {
            id: String(effectiveRole._id),
            nombre: effectiveRole.nombre,
            descripcion: effectiveRole.descripcion || '',
            arquetipo: permanentArchetype,
            esTemporal: Boolean(temporaryRole),
        } : null,
        rolPermanente: permanentRole ? {
            id: String(permanentRole._id),
            nombre: permanentRole.nombre,
            arquetipo: permanentArchetype,
        } : null,
        rolTemporal: temporaryRole ? {
            id: String(temporaryRole._id),
            nombre: temporaryRole.nombre,
            arquetipo: permanentArchetype,
            expiracion: temporaryExpiresAt,
        } : null,
    };
};

const ensureAccessControlCatalog = async ({ session } = {}) => {
    const permissionByKey = new Map();

    for (const definition of PERMISSION_DEFINITIONS) {
        const permission = await Permiso.findOneAndUpdate(
            { clave: definition.clave },
            {
                $setOnInsert: {
                    ...definition,
                    activo: true,
                    legado: false,
                },
            },
            { upsert: true, new: true, session, setDefaultsOnInsert: true }
        );
        permissionByKey.set(definition.clave, permission);
    }

    const archetypes = [];
    for (const [clave, permissionKeys] of Object.entries(ARCHETYPE_DEFAULTS)) {
        const archetype = await ArquetipoRol.findOneAndUpdate(
            { clave },
            {
                $setOnInsert: {
                    nombre: ARCHETYPE_LABELS[clave],
                    descripcion: `Plantilla base para ${ARCHETYPE_LABELS[clave]}`,
                    permisosPredeterminados: permissionKeys
                        .map((key) => permissionByKey.get(key)?._id)
                        .filter(Boolean),
                    activo: true,
                },
            },
            { upsert: true, new: true, session, setDefaultsOnInsert: true }
        );
        archetypes.push(archetype);
    }

    return {
        permissions: [...permissionByKey.values()],
        archetypes,
    };
};

const enforceAdminPermissions = (archetype, permissionKeys) => {
    const keys = [...new Set(permissionKeys.map(normalizePermissionKey).filter(Boolean))];
    if (normalizeArchetype(archetype) === 'administracion') {
        keys.push(...ADMIN_REQUIRED_PERMISSIONS);
    }
    return [...new Set(keys)];
};

const resolvePermissionIds = async (permissionKeys, archetype) => {
    const keys = enforceAdminPermissions(archetype, permissionKeys);
    const permissions = await Permiso.find({ clave: { $in: keys }, activo: { $ne: false } });
    if (permissions.length !== keys.length) {
        const found = new Set(permissions.map(({ clave }) => clave));
        const missing = keys.filter((key) => !found.has(key));
        const error = new Error(`Permisos desconocidos: ${missing.join(', ')}`);
        error.status = 400;
        throw error;
    }
    return permissions.map(({ _id }) => _id);
};

module.exports = {
    canUseTemporaryRole,
    enforceAdminPermissions,
    ensureAccessControlCatalog,
    getUserAccessContext,
    normalizeArchetype,
    resolvePermissionIds,
};
