const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const sharp = require('sharp');
const { verificacionTerreno_MongooseModel: VerificacionTerreno } = require('../models/verificacionTerreno.model.js');
const {
    verificacionTerrenoConfig_MongooseModel: VerificacionTerrenoConfig,
} = require('../models/verificacionTerrenoConfig.model.js');
const { trabajador_MongooseModel: Trabajador } = require('../models/trabajador.model.js');
const { asignacion_MongooseModel: Asignacion } = require('../models/asignacion.model.js');
const { apoyo_MongooseModel: Apoyo } = require('../models/apoyo.model.js');
const { direccion_MongooseModel: Direccion } = require('../models/direccion.model.js');
const { buildAssetUrl, getAuthRut, isPrivilegedRequest } = require('../utils/security.js');

const CHILE_TZ = 'America/Santiago';
const DEFAULT_CONFIG = {
    enabled: true,
    cantidadDiaria: 1,
    radioMetros: null,
};

const imageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/jpg']);

const clampNumber = (value, min, max, fallback) => {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, Math.round(numberValue)));
};

const parseBoolean = (value, fallback) => {
    if (value === undefined) {
        return fallback;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        if (value === 'true') return true;
        if (value === 'false') return false;
    }
    return Boolean(value);
};

const getChileDayRange = (value = new Date()) => {
    const base = moment.tz(value, CHILE_TZ);
    return {
        start: base.clone().startOf('day').toDate(),
        end: base.clone().endOf('day').toDate(),
    };
};

const getStoredAssignmentDayRange = (value = new Date()) => {
    const chileDate = moment.tz(value, CHILE_TZ).format('YYYY-MM-DD');
    return {
        assignmentStart: moment.utc(chileDate).startOf('day').toDate(),
        assignmentEnd: moment.utc(chileDate).endOf('day').toDate(),
    };
};

const getConfigDoc = async () => {
    return VerificacionTerrenoConfig.findOneAndUpdate(
        { key: 'default' },
        { $setOnInsert: { key: 'default', ...DEFAULT_CONFIG } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
};

const parseLocation = (body) => {
    const lat = Number(body?.lat);
    const lng = Number(body?.lng);
    const accuracy = body?.accuracy === undefined || body?.accuracy === ''
        ? undefined
        : Number(body.accuracy);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
    }

    return {
        lat,
        lng,
        accuracy: Number.isFinite(accuracy) ? accuracy : undefined,
    };
};

const radians = (degrees) => degrees * (Math.PI / 180);

const calculateDistanceMeters = (from, to) => {
    const earthRadiusMeters = 6371000;
    const deltaLat = radians(to.lat - from.lat);
    const deltaLng = radians(to.lng - from.lng);
    const lat1 = radians(from.lat);
    const lat2 = radians(to.lat);
    const a = Math.sin(deltaLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(earthRadiusMeters * c);
};

const isZeroCoordinates = (lat, lng) => Number(lat) === 0 && Number(lng) === 0;

const saveVerificationPhoto = async (verificationId, file) => {
    if (!file) {
        throw new Error('No se ha subido ningun archivo');
    }

    if (!imageMimeTypes.has(file.mimetype)) {
        throw new Error(`Formato de archivo no permitido: ${file.mimetype}`);
    }

    const uploadPath = path.join(__dirname, '../../public/images/verificaciones');
    if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
    }

    const fileName = `VT_${verificationId}_${Date.now()}.jpg`;
    const finalPath = path.join(uploadPath, path.basename(fileName));
    await sharp(file.buffer)
        .resize(1024, 1024, { fit: 'inside' })
        .toFormat('jpeg', { quality: 80 })
        .toFile(finalPath);
    return finalPath;
};

const verificationPopulate = [
    { path: 'trabajador', select: 'Nombre Rut cargo' },
    {
        path: 'direccion',
        select: 'calle numero LAT LNG NumeroMedidor NumeroSector comuna ciudad',
        populate: [
            { path: 'NumeroMedidor', select: 'NumeroMedidor' },
            { path: 'NumeroSector', select: 'sector NumeroSector NumeroRuta empresa' },
        ],
    },
    {
        path: 'sector',
        select: 'sector NumeroSector NumeroRuta empresa',
        populate: { path: 'NumeroRuta', select: 'NumeroRuta' },
    },
];

const getSectorPayload = (verification) => {
    const sector = verification.sector || verification.direccion?.NumeroSector || null;
    return sector ? {
        id: sector._id?.toString?.() || null,
        nombre: sector.sector || null,
        numero: sector.NumeroSector ?? null,
        ruta: sector.NumeroRuta?.NumeroRuta ?? null,
        empresa: sector.empresa || null,
    } : null;
};

const formatVerification = (verification) => {
    const item = typeof verification.toObject === 'function'
        ? verification.toObject()
        : verification;
    const direccion = item.direccion || null;
    const trabajador = item.trabajador || null;
    const medidor = direccion?.NumeroMedidor || null;

    return {
        id: item._id?.toString?.() || null,
        id_verificacion: item._id?.toString?.() || null,
        estado: item.estado,
        fecha: item.fecha,
        origen: item.origen,
        radioMetros: null,
        comentario: item.comentario || null,
        respuestaAt: item.respuestaAt || null,
        latRespuesta: item.latRespuesta ?? null,
        lngRespuesta: item.lngRespuesta ?? null,
        accuracy: item.accuracy ?? null,
        distanciaMetros: item.distanciaMetros ?? null,
        coordenadasActualizadas: Boolean(item.coordenadasActualizadas),
        direccionCoordenadasOriginales: item.direccionCoordenadasOriginales || null,
        fotografia: buildAssetUrl('verificaciones', item.fotografia),
        intentos: Array.isArray(item.intentos)
            ? item.intentos.map((intento) => ({
                ...intento,
                fotografia: buildAssetUrl('verificaciones', intento.fotografia),
            }))
            : [],
        trabajador: trabajador ? {
            id: trabajador._id?.toString?.() || null,
            nombre: trabajador.Nombre || null,
            rut: trabajador.Rut || null,
            cargo: trabajador.cargo || null,
        } : null,
        direccion: direccion ? {
            id: direccion._id?.toString?.() || null,
            calle: direccion.calle || null,
            numero: direccion.numero ?? null,
            comuna: direccion.comuna || null,
            ciudad: direccion.ciudad || null,
            lat: direccion.LAT ?? null,
            lng: direccion.LNG ?? null,
            numeroMedidor: medidor?.NumeroMedidor ?? null,
        } : null,
        sector: getSectorPayload(item),
    };
};

const emitVerificationUpdate = (io, verification) => {
    if (!io || !verification) {
        return;
    }

    const trabajadorId = verification.trabajador?._id || verification.trabajador;
    const payload = {
        id: verification._id?.toString?.() || String(verification._id),
        estado: verification.estado,
        fecha: verification.fecha,
    };

    io.to('role:administracion').to('role:supervisor').emit('actualizarVerificacionTerreno', payload);
    if (trabajadorId) {
        io.to(`user:${trabajadorId}`).emit('nuevaVerificacionTerreno', payload);
    }
};

const appendAssignmentForWorker = (assignmentsByWorker, workerId, asignacion) => {
    if (!workerId || !asignacion?.NumeroSector || !mongoose.isValidObjectId(workerId)) {
        return;
    }

    const normalizedWorkerId = String(workerId);
    const currentAssignments = assignmentsByWorker.get(normalizedWorkerId) || [];
    currentAssignments.push(asignacion);
    assignmentsByWorker.set(normalizedWorkerId, currentAssignments);
};

const getWorkerAssignmentsForToday = async (trabajadorId, now = new Date()) => {
    const { start, end } = getChileDayRange(now);
    const { assignmentStart, assignmentEnd } = getStoredAssignmentDayRange(now);
    const asignaciones = await Asignacion.find({
        Trabajador: trabajadorId,
        fecha_asignacion: {
            $gte: assignmentStart,
            $lte: assignmentEnd,
        },
    }).select('_id NumeroSector Trabajador').lean();

    const apoyos = await Apoyo.find({
        Trabajador: trabajadorId,
        fecha_inicio: { $lte: assignmentEnd },
        fecha_fin: { $gte: assignmentStart },
    })
        .populate({ path: 'asignacion', select: '_id NumeroSector' })
        .lean();

    const apoyoAsignaciones = apoyos
        .map((apoyo) => apoyo.asignacion)
        .filter(Boolean);

    return {
        start,
        end,
        asignaciones: [...asignaciones, ...apoyoAsignaciones],
    };
};

const getAllWorkerAssignmentsForDay = async (now = new Date()) => {
    const { start, end } = getChileDayRange(now);
    const { assignmentStart, assignmentEnd } = getStoredAssignmentDayRange(now);
    const assignmentsByWorker = new Map();

    const asignaciones = await Asignacion.find({
        fecha_asignacion: {
            $gte: assignmentStart,
            $lte: assignmentEnd,
        },
    }).select('_id NumeroSector Trabajador').lean();

    for (const asignacion of asignaciones) {
        appendAssignmentForWorker(assignmentsByWorker, asignacion.Trabajador, asignacion);
    }

    const apoyos = await Apoyo.find({
        fecha_inicio: { $lte: assignmentEnd },
        fecha_fin: { $gte: assignmentStart },
    })
        .select('Trabajador asignacion')
        .populate({ path: 'asignacion', select: '_id NumeroSector' })
        .lean();

    for (const apoyo of apoyos) {
        appendAssignmentForWorker(assignmentsByWorker, apoyo.Trabajador, apoyo.asignacion);
    }

    return { start, end, assignmentsByWorker };
};

const asegurarVerificacionesParaTrabajador = async ({
    trabajadorId,
    asignaciones,
    config,
    start,
    end,
    io,
}) => {
    if (!trabajadorId || !mongoose.isValidObjectId(trabajadorId)) {
        return { created: 0, needed: 0 };
    }

    if (!asignaciones.length) {
        return { created: 0, needed: 0 };
    }

    const cantidadDiaria = clampNumber(config.cantidadDiaria, 1, 10, DEFAULT_CONFIG.cantidadDiaria);
    const currentCount = await VerificacionTerreno.countDocuments({
        trabajador: trabajadorId,
        fecha: { $gte: start, $lte: end },
    });
    const needed = Math.max(0, cantidadDiaria - currentCount);
    if (needed <= 0) {
        return { created: 0, needed: 0 };
    }

    const assignmentBySector = new Map();
    for (const asignacion of asignaciones) {
        if (!asignacion.NumeroSector) {
            continue;
        }
        const sectorId = String(asignacion.NumeroSector);
        if (!assignmentBySector.has(sectorId)) {
            assignmentBySector.set(sectorId, asignacion);
        }
    }

    const sectorIds = Array.from(assignmentBySector.keys())
        .filter((id) => mongoose.isValidObjectId(id))
        .map((id) => new mongoose.Types.ObjectId(id));
    if (!sectorIds.length) {
        return { created: 0, needed };
    }

    const existingDirections = await VerificacionTerreno.find({
        trabajador: trabajadorId,
        fecha: { $gte: start, $lte: end },
    }).select('direccion').lean();
    const excludedDirectionIds = existingDirections
        .map((item) => item.direccion)
        .filter(Boolean);

    const match = { NumeroSector: { $in: sectorIds } };
    if (excludedDirectionIds.length) {
        match._id = { $nin: excludedDirectionIds };
    }

    const directions = await Direccion.aggregate([
        { $match: match },
        { $sample: { size: needed } },
    ]);

    const created = [];
    for (const direction of directions) {
        const sectorId = String(direction.NumeroSector || '');
        const asignacion = assignmentBySector.get(sectorId);
        if (!asignacion) {
            continue;
        }

        try {
            const verification = await VerificacionTerreno.create({
                trabajador: trabajadorId,
                asignacion: asignacion._id,
                direccion: direction._id,
                sector: direction.NumeroSector,
                fecha: start,
                radioMetros: DEFAULT_CONFIG.radioMetros,
            });
            created.push(verification);
        } catch (error) {
            if (error?.code !== 11000) {
                throw error;
            }
        }
    }

    for (const verification of created) {
        emitVerificationUpdate(io, verification);
    }

    return { created: created.length, needed };
};

const asegurarVerificacionesTrabajadorConectado = async ({ trabajadorId, io, now = new Date() }) => {
    const config = await getConfigDoc();
    if (!config.enabled) {
        return { created: 0, needed: 0 };
    }

    const { start, end, asignaciones } = await getWorkerAssignmentsForToday(trabajadorId, now);
    return asegurarVerificacionesParaTrabajador({
        trabajadorId,
        asignaciones,
        config,
        start,
        end,
        io,
    });
};

const asegurarVerificacionesDelDia = async ({ io, now = new Date() } = {}) => {
    const config = await getConfigDoc();
    if (!config.enabled) {
        return {
            enabled: false,
            workers: 0,
            created: 0,
            needed: 0,
        };
    }

    const { start, end, assignmentsByWorker } = await getAllWorkerAssignmentsForDay(now);
    const summary = {
        enabled: true,
        workers: assignmentsByWorker.size,
        created: 0,
        needed: 0,
    };

    for (const [trabajadorId, asignaciones] of assignmentsByWorker.entries()) {
        const result = await asegurarVerificacionesParaTrabajador({
            trabajadorId,
            asignaciones,
            config,
            start,
            end,
            io,
        });
        summary.created += result.created;
        summary.needed += result.needed;
    }

    return summary;
};

const obtenerPendientes = async (req, res) => {
    try {
        const trabajador = await Trabajador.findOne({ Rut: { $eq: getAuthRut(req) } }).select('_id');
        if (!trabajador) {
            return res.status(404).json({ message: 'Trabajador no encontrado' });
        }

        const { start, end } = getChileDayRange();
        const verificaciones = await VerificacionTerreno.find({
            trabajador: trabajador._id,
            fecha: { $gte: start, $lte: end },
            estado: 'pendiente',
        })
            .populate(verificationPopulate)
            .sort({ createdAt: 1 });

        return res.status(200).json(verificaciones.map(formatVerification));
    } catch (error) {
        console.error('Error al obtener verificaciones pendientes:', error.message);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

const responderVerificacion = async (req, res) => {
    try {
        const location = parseLocation(req.body);
        if (!location) {
            return res.status(400).json({ message: 'Coordenadas invalidas' });
        }

        const id = String(req.body?.id_verificacion || req.body?.id || '').trim();
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ message: 'Verificacion invalida' });
        }

        const verification = await VerificacionTerreno.findById(id)
            .populate({ path: 'trabajador', select: 'Rut Nombre cargo' })
            .populate({ path: 'direccion', select: 'calle numero LAT LNG NumeroMedidor NumeroSector' });

        if (!verification) {
            return res.status(404).json({ message: 'Verificacion no encontrada' });
        }

        if (!isPrivilegedRequest(req) && String(verification.trabajador?.Rut || '').trim() !== getAuthRut(req)) {
            return res.status(403).json({ message: 'Permisos insuficientes' });
        }

        if (verification.estado !== 'pendiente') {
            return res.status(409).json({ message: 'La verificacion ya fue respondida' });
        }

        const photoPath = await saveVerificationPhoto(verification._id, req.file);
        const directionLat = Number(verification.direccion?.LAT);
        const directionLng = Number(verification.direccion?.LNG);
        const responseDate = new Date();
        const comentario = typeof req.body?.comentario === 'string'
            ? req.body.comentario.trim()
            : '';
        const basePayload = {
            fecha: responseDate,
            lat: location.lat,
            lng: location.lng,
            accuracy: location.accuracy,
            fotografia: photoPath,
            comentario,
        };

        verification.latRespuesta = location.lat;
        verification.lngRespuesta = location.lng;
        verification.accuracy = location.accuracy;
        verification.comentario = comentario || undefined;

        if (isZeroCoordinates(directionLat, directionLng)) {
            verification.direccionCoordenadasOriginales = {
                lat: directionLat,
                lng: directionLng,
            };
            verification.estado = 'validada_por_captura_inicial';
            verification.respuestaAt = responseDate;
            verification.fotografia = photoPath;
            verification.distanciaMetros = null;
            verification.coordenadasActualizadas = true;
            verification.intentos.push({
                ...basePayload,
                distanciaMetros: null,
                estado: 'validada_por_captura_inicial',
            });
            await Direccion.findByIdAndUpdate(verification.direccion._id, {
                LAT: location.lat,
                LNG: location.lng,
            });
            await verification.save();
            emitVerificationUpdate(req.io, verification);
            return res.status(200).json({
                message: 'Verificacion validada y coordenadas actualizadas',
                verificacion: formatVerification(await verification.populate(verificationPopulate)),
            });
        }

        if (!Number.isFinite(directionLat) || !Number.isFinite(directionLng)) {
            return res.status(400).json({ message: 'La direccion no tiene coordenadas validas' });
        }

        const distanciaMetros = calculateDistanceMeters(
            { lat: directionLat, lng: directionLng },
            { lat: location.lat, lng: location.lng }
        );
        verification.distanciaMetros = distanciaMetros;

        verification.estado = 'validada';
        verification.respuestaAt = responseDate;
        verification.fotografia = photoPath;
        verification.intentos.push({
            ...basePayload,
            distanciaMetros,
            estado: 'validada',
        });
        await verification.save();
        emitVerificationUpdate(req.io, verification);
        return res.status(200).json({
            message: 'Verificacion validada correctamente',
            verificacion: formatVerification(await verification.populate(verificationPopulate)),
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Error interno del servidor';
        if (message.startsWith('Formato de archivo') || message.startsWith('No se ha subido')) {
            return res.status(400).json({ message });
        }
        console.error('Error al responder verificacion:', message);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

const listarAdmin = async (req, res) => {
    try {
        const { start, end } = getChileDayRange(req.body?.fechaInicio || new Date());
        const endRange = req.body?.fechaFin
            ? getChileDayRange(req.body.fechaFin).end
            : end;
        const query = {
            fecha: {
                $gte: start,
                $lte: endRange,
            },
        };

        const estado = String(req.body?.estado || 'todos').trim();
        if (estado && estado !== 'todos') {
            query.estado = estado;
        }

        const trabajadorId = String(req.body?.trabajador || '').trim();
        if (mongoose.isValidObjectId(trabajadorId)) {
            query.trabajador = trabajadorId;
        }

        const verificaciones = await VerificacionTerreno.find(query)
            .populate(verificationPopulate)
            .sort({ fecha: -1, createdAt: -1 });
        const items = verificaciones.map(formatVerification);
        const resumen = items.reduce(
            (acc, item) => {
                acc.total += 1;
                acc[item.estado] = (acc[item.estado] || 0) + 1;
                if (item.estado === 'pendiente') {
                    acc.trabajadoresPendientes.add(item.trabajador?.id || '');
                }
                return acc;
            },
            {
                total: 0,
                pendiente: 0,
                validada: 0,
                validada_por_captura_inicial: 0,
                trabajadoresPendientes: new Set(),
            }
        );

        return res.status(200).json({
            resumen: {
                total: resumen.total,
                pendiente: resumen.pendiente,
                validada: resumen.validada,
                validada_por_captura_inicial: resumen.validada_por_captura_inicial,
                trabajadoresPendientes: Array.from(resumen.trabajadoresPendientes).filter(Boolean).length,
                fueraDeRango: items.reduce((total, item) =>
                    total + item.intentos.filter((intento) => intento.estado === 'fuera_de_rango').length, 0),
            },
            verificaciones: items,
        });
    } catch (error) {
        console.error('Error al listar verificaciones:', error.message);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

const obtenerConfig = async (req, res) => {
    try {
        const config = await getConfigDoc();
        return res.status(200).json({
            enabled: Boolean(config.enabled),
            cantidadDiaria: config.cantidadDiaria,
            radioMetros: DEFAULT_CONFIG.radioMetros,
        });
    } catch (error) {
        console.error('Error al obtener configuracion de verificaciones:', error.message);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

const actualizarConfig = async (req, res) => {
    try {
        const currentConfig = await getConfigDoc();
        const nextConfig = {
            enabled: parseBoolean(req.body?.enabled, currentConfig.enabled),
            cantidadDiaria: clampNumber(req.body?.cantidadDiaria, 1, 10, currentConfig.cantidadDiaria),
            radioMetros: DEFAULT_CONFIG.radioMetros,
        };
        const config = await VerificacionTerrenoConfig.findOneAndUpdate(
            { key: 'default' },
            { $set: nextConfig },
            { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
        ).lean();

        return res.status(200).json({
            enabled: Boolean(config.enabled),
            cantidadDiaria: config.cantidadDiaria,
            radioMetros: DEFAULT_CONFIG.radioMetros,
        });
    } catch (error) {
        console.error('Error al actualizar configuracion de verificaciones:', error.message);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

module.exports = {
    actualizarConfig,
    asegurarVerificacionesDelDia,
    asegurarVerificacionesTrabajadorConectado,
    listarAdmin,
    obtenerConfig,
    obtenerPendientes,
    responderVerificacion,
};
