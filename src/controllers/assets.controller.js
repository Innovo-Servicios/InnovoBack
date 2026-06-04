const path = require('node:path');
const fs = require('node:fs');
const { documentos_MongooseModel } = require('../models/documentos.model.js');
const { ate_MongooseModel } = require('../models/ATE.model.js');
const { Novedad } = require('../models/novedad.model.js');
const { verificacionTerreno_MongooseModel } = require('../models/verificacionTerreno.model.js');
const { trabajador_MongooseModel } = require('../models/trabajador.model.js');
const { getAuthRut, isPrivilegedRequest } = require('../utils/security.js');

const assetDirectories = {
    ate: [
        path.resolve(__dirname, '../../public/images/ates'),
        '/home/backend/Innovo-app/Backend/IMG_ATES',
    ],
    novedades: [
        path.resolve(__dirname, '../../public/images/novedades'),
        '/home/backend/Innovo-app/Backend/IMG_NOVEDADES',
    ],
    verificaciones: [
        path.resolve(__dirname, '../../public/images/verificaciones'),
        '/home/backend/Innovo-app/Backend/IMG_VERIFICACIONES',
    ],
    perfiles: [
        path.resolve(__dirname, '../../public/images/perfiles'),
        '/home/backend/Innovo-app/Backend/IMG_PERFILES',
    ],
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const resolveAssetPath = (assetType, rawFileName) => {
    const allowedDirectories = assetDirectories[assetType];
    if (!allowedDirectories) {
        return null;
    }

    const safeFileName = path.basename(String(rawFileName || ''));
    if (!safeFileName) {
        return null;
    }

    return allowedDirectories
        .map((directory) => path.join(directory, safeFileName))
        .find((candidate) => {
            const resolvedCandidate = path.resolve(candidate);
            return allowedDirectories.some((directory) => {
                const resolvedDirectory = path.resolve(directory);
                return (
                    resolvedCandidate.startsWith(`${resolvedDirectory}${path.sep}`) &&
                    fs.existsSync(resolvedCandidate)
                );
            });
        }) || null;
};

const fileNameRegex = (fileName) => new RegExp(`${escapeRegExp(path.basename(fileName))}$`);

const canAccessAteAsset = async (req, fileName) => {
    if (isPrivilegedRequest(req)) {
        return true;
    }

    const documento = await documentos_MongooseModel.findOne({
        url: { $regex: fileNameRegex(fileName) },
    }).select('_id');
    if (!documento) {
        return false;
    }

    const ate = await ate_MongooseModel.findOne({
        fotografia: documento._id,
    }).populate({ path: 'Trabajador', select: 'Rut' });

    return String(ate?.Trabajador?.Rut || '').trim() === getAuthRut(req);
};

const canAccessNovedadAsset = async (req, fileName) => {
    if (isPrivilegedRequest(req)) {
        return true;
    }

    const novedad = await Novedad.findOne({
        Fotografia: { $regex: fileNameRegex(fileName) },
    }).populate({ path: 'emisor', select: 'Rut' });

    return String(novedad?.emisor?.Rut || '').trim() === getAuthRut(req);
};

const canAccessVerificacionAsset = async (req, fileName) => {
    if (isPrivilegedRequest(req)) {
        return true;
    }

    const verificacion = await verificacionTerreno_MongooseModel.findOne({
        $or: [
            { fotografia: { $regex: fileNameRegex(fileName) } },
            { 'intentos.fotografia': { $regex: fileNameRegex(fileName) } },
        ],
    }).populate({ path: 'trabajador', select: 'Rut' });

    return String(verificacion?.trabajador?.Rut || '').trim() === getAuthRut(req);
};

const canAccessPerfilAsset = async (req, fileName) => {
    if (isPrivilegedRequest(req)) {
        return true;
    }

    const worker = await trabajador_MongooseModel.findOne({
        Rut: { $eq: getAuthRut(req) },
    }).select('perfil');

    return path.basename(String(worker?.perfil || '')) === path.basename(fileName);
};

const canAccessAsset = async (req, assetType, fileName) => {
    if (assetType === 'ate') {
        return canAccessAteAsset(req, fileName);
    }

    if (assetType === 'novedades') {
        return canAccessNovedadAsset(req, fileName);
    }

    if (assetType === 'verificaciones') {
        const hasNovedadAccess = await canAccessNovedadAsset(req, fileName);
        return hasNovedadAccess || canAccessVerificacionAsset(req, fileName);
    }

    if (assetType === 'perfiles') {
        return canAccessPerfilAsset(req, fileName);
    }

    return false;
};

const descargarAsset = async (req, res) => {
    const assetType = String(req.params.type || '').trim();
    const fileName = path.basename(String(req.params.fileName || ''));
    const assetPath = resolveAssetPath(assetType, fileName);

    if (!assetPath) {
        return res.status(404).send('Archivo no encontrado');
    }

    try {
        const hasAccess = await canAccessAsset(req, assetType, fileName);
        if (!hasAccess) {
            return res.status(403).send('Permisos insuficientes');
        }

        return res.sendFile(assetPath, {
            headers: {
                'Content-Disposition': `inline; filename="${path.basename(assetPath)}"`,
            },
        });
    } catch (error) {
        console.error('Error al descargar asset:', error.message);
        return res.status(500).send('Error interno del servidor');
    }
};

module.exports = {
    descargarAsset,
};
