//borrar, listar, filtrar -tipo-fecha
const mongoose = require('mongoose');
const Token = require('../controllers/token.controller.js');
const {
    notificaciones_MongooseModel,
} = require('../models/notificacion.model.js');
const { trabajador_MongooseModel } = require('../models/trabajador.model.js');
const { TipoNotificacion } = require('../models/tipoNotificacion.model.js');
const {
    notificacion_vista_MongooseModel,
} = require('../models/notificacion_vista.model.js');
const {
    tipoDocumento_MongooseModel,
} = require('../models/tipoDocumento.model.js');
const { documentos_MongooseModel } = require('../models/documentos.model.js');
const moment = require('moment-timezone');
const Dayjs = require('dayjs');
const fetch = require('node-fetch');
const path = require('node:path');
const sharp = require('sharp');
const fs = require('node:fs');

const NOTIFICATION_ALLOWED_FORMATS = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/jpg',
]);
const NOTIFICATION_IMAGE_FORMATS = new Set([
    'image/jpeg',
    'image/png',
    'image/jpg',
]);
const NOTIFICATION_DEFAULT_PAGE_LIMIT = 20;
const NOTIFICATION_MAX_PAGE_LIMIT = 50;
const NOTIFICATION_TIMEZONE = 'America/Santiago';
const NOTIFICATION_CHANNEL_ID = 'default';
const EXPO_PUSH_RECEIPT_DELAY_MS = Number.parseInt(
    process.env.EXPO_PUSH_RECEIPT_DELAY_MS || '30000',
    10
);

const logHandledError = (context, error) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`${context}: ${errorMessage}`);
};

const buildNotificationDownloadUrl = (notificationId, notificationPath) => {
    const safeFileName = path.basename(String(notificationPath || 'adjunto'));
    return `/notificaciones/archivo/${notificationId}/${encodeURIComponent(safeFileName)}`;
};

const formatNotificationUrlForClient = (notificationId, notificationUrl) => {
    if (!notificationUrl) {
        return null;
    }

    const stringUrl = String(notificationUrl);
    if (/^https?:\/\//i.test(stringUrl)) {
        return stringUrl;
    }

    return buildNotificationDownloadUrl(notificationId, stringUrl);
};

const formatNotificationDateForClient = (fecha) => {
    const parsedDate = new Date(fecha);
    if (Number.isNaN(parsedDate.getTime())) {
        return fecha;
    }

    return parsedDate.toISOString();
};

const sanitizeNotificationForClient = (notificacion) => {
    if (!notificacion) {
        return notificacion;
    }

    const plainNotification = typeof notificacion.toObject === 'function'
        ? notificacion.toObject()
        : { ...notificacion };

    plainNotification.url = formatNotificationUrlForClient(
        plainNotification._id || plainNotification.id,
        plainNotification.url
    );

    return plainNotification;
};

const normalizeNotificationPageLimit = (limit) => {
    const parsedLimit = Number.parseInt(limit, 10);
    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
        return NOTIFICATION_DEFAULT_PAGE_LIMIT;
    }

    return Math.min(parsedLimit, NOTIFICATION_MAX_PAGE_LIMIT);
};

const encodeNotificationCursor = (notificacion) => {
    if (!notificacion?.fecha || !notificacion?._id) {
        return null;
    }

    return Buffer.from(JSON.stringify({
        fecha: new Date(notificacion.fecha).toISOString(),
        id: notificacion._id.toString(),
    })).toString('base64url');
};

const decodeNotificationCursor = (cursor) => {
    if (!cursor || typeof cursor !== 'string') {
        return null;
    }

    try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (!decoded.fecha || !decoded.id || !mongoose.Types.ObjectId.isValid(decoded.id)) {
            return null;
        }

        const fecha = new Date(decoded.fecha);
        if (Number.isNaN(fecha.getTime())) {
            return null;
        }

        return {
            fecha,
            id: new mongoose.Types.ObjectId(decoded.id),
        };
    } catch (error) {
        logHandledError('Cursor de notificaciones inválido', error);
        return null;
    }
};

const buildNotificationCursorQuery = (cursor) => {
    const decodedCursor = decodeNotificationCursor(cursor);
    if (!decodedCursor) {
        return {};
    }

    return {
        $or: [
            { fecha: { $lt: decodedCursor.fecha } },
            {
                fecha: decodedCursor.fecha,
                _id: { $lt: decodedCursor.id },
            },
        ],
    };
};

const toObjectIdStrings = (ids = []) => ids.map((id) => id.toString());

const hasObjectId = (ids = [], targetId) =>
    toObjectIdStrings(ids).includes(String(targetId));

const getHiddenNotificationIds = (trabajador) =>
    new Set(toObjectIdStrings(trabajador.notificacionesEliminadas || []));

const getWorkerNotificationIds = (trabajador) => {
    const hiddenIds = getHiddenNotificationIds(trabajador);

    return [
        ...new Set([
            ...toObjectIdStrings(trabajador.notificaciones || []),
            ...toObjectIdStrings(trabajador.vistas || []),
        ]),
    ].filter((id) => !hiddenIds.has(id));
};

const getNotificationTypeMap = async (notificaciones) => {
    const tipoIds = [
        ...new Set(
            notificaciones
                .filter((notificacion) => notificacion.tipo)
                .map((notificacion) => notificacion.tipo.toString())
        ),
    ];

    if (tipoIds.length === 0) {
        return {};
    }

    const tipos = await TipoNotificacion.find({
        _id: { $in: tipoIds },
    });

    return tipos.reduce((acc, tipo) => {
        acc[tipo._id.toString()] = tipo.value;
        return acc;
    }, {});
};

const formatNotificationsForApp = async (notificaciones, trabajador) => {
    const vistasSet = new Set((trabajador.vistas || []).map((id) => id.toString()));
    const tiposMap = await getNotificationTypeMap(notificaciones);

    return notificaciones.map((notificacion) => ({
        id: notificacion._id.toString(),
        tipo: tiposMap[notificacion.tipo.toString()] || 'Desconocido',
        titulo: notificacion.titulo,
        mensaje: notificacion.mensaje,
        contenido: notificacion.contenido,
        fecha: formatNotificationDateForClient(notificacion.fecha),
        url: formatNotificationUrlForClient(notificacion._id, notificacion.url),
        estado: vistasSet.has(notificacion._id.toString()),
    }));
};

const formatLiveNotificationForApp = async (notificacion) => {
    const tiposMap = await getNotificationTypeMap([notificacion]);

    return {
        id: notificacion._id.toString(),
        tipo: tiposMap[notificacion.tipo.toString()] || 'Desconocido',
        titulo: notificacion.titulo,
        mensaje: notificacion.mensaje,
        contenido: notificacion.contenido,
        fecha: formatNotificationDateForClient(notificacion.fecha),
        url: formatNotificationUrlForClient(notificacion._id, notificacion.url),
        estado: false,
    };
};

const normalizeNotificationTargets = (objetivo) => {
    if (Array.isArray(objetivo)) {
        return objetivo;
    }

    if (typeof objetivo !== 'string') {
        return [];
    }

    try {
        const parsedTargets = JSON.parse(objetivo);
        return Array.isArray(parsedTargets) ? parsedTargets : [];
    } catch (error) {
        logHandledError('No se pudo interpretar el objetivo de la notificación', error);
        return [];
    }
};

const getTargetWorkers = async (objetivoArray) => {
    if (objetivoArray[0] === 'all') {
        return trabajador_MongooseModel.find();
    }

    return trabajador_MongooseModel.find({
        Rut: { $in: objetivoArray },
    });
};

const buildPushNotificationData = ({
    contenido,
    notificationId,
    tipo,
    fecha,
    url,
}) => ({
    contenidos: contenido,
    idNotificacion: notificationId?.toString(),
    tipo,
    fecha: formatNotificationDateForClient(fecha),
    url: formatNotificationUrlForClient(notificationId, url),
});

const createNotificationRecord = ({
    trabajadores,
    tipoId,
    titulo,
    mensaje,
    contenido,
    url,
    fecha,
}) => new notificaciones_MongooseModel({
    trabajadores: trabajadores.map((trabajador) => trabajador._id),
    tipo: tipoId,
    titulo,
    mensaje,
    contenido,
    url,
    fecha,
});

const assignNotificationToWorkers = async ({
    trabajadores,
    nuevaNotificacion,
    titulo,
    mensaje,
    data,
    documentoId,
}) => {
    for (const trabajador of trabajadores) {
        trabajador.notificaciones.push(nuevaNotificacion.id);
        if (documentoId) {
            trabajador.documentos.push(documentoId);
        }

        await pushNotification({
            userId: trabajador._id,
            titulo,
            mensaje,
            data,
        });
        await trabajador.save();
    }
};

const emitNotificationToWorkers = async (io, trabajadores, nuevaNotificacion) => {
    if (!io || !nuevaNotificacion) {
        return;
    }

    const clientNotification = await formatLiveNotificationForApp(nuevaNotificacion);
    for (const trabajador of trabajadores) {
        io.to(`worker:${trabajador.Rut}`)
            .emit('nuevaNotificacion', clientNotification);
    }
};

const ensureNotificationUploadPath = () => {
    const uploadPath = path.join(__dirname, '../../storage/uploads');
    if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
    }

    return uploadPath;
};

const buildNotificationImageName = (fileName) =>
    fileName.replaceAll(/\s/g, '').replace(/\.[^/.]+$/, '.jpeg');

const saveNotificationAttachment = async (archivo) => {
    if (!NOTIFICATION_ALLOWED_FORMATS.has(archivo.mimetype)) {
        return {
            error: `Formato de archivo no permitido: ${archivo.mimetype}`,
        };
    }

    const uploadPath = ensureNotificationUploadPath();
    const fileName = path.basename(`file-${Date.now()}-${archivo.originalname}`);

    if (NOTIFICATION_IMAGE_FORMATS.has(archivo.mimetype)) {
        const finalPath = path.join(
            uploadPath,
            buildNotificationImageName(fileName)
        );

        await sharp(archivo.buffer)
            .resize(1024, 1024, { fit: 'inside' })
            .toFormat('jpeg', { quality: 80 })
            .toFile(finalPath);

        return { finalPath };
    }

    const finalPath = path.join(uploadPath, fileName);
    fs.writeFileSync(finalPath, archivo.buffer);
    return { finalPath };
};

const sendExpoPushNotification = async ({ tokenPush, titulo, mensaje, data }) => {
    const mensajeNotificacion = {
        to: tokenPush,
        sound: 'default',
        channelId: NOTIFICATION_CHANNEL_ID,
        priority: 'high',
        tag: data?.idNotificacion ? String(data.idNotificacion) : undefined,
        title: titulo,
        body: mensaje,
        data: data || {},
    };

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(mensajeNotificacion),
    });

    const result = await response.json();
    return {
        ok: response.ok,
        result,
    };
};

const getExpoPushReceiptIds = (result) => {
    const tickets = Array.isArray(result?.data) ? result.data : [result?.data];
    return tickets
        .filter((ticket) => ticket?.status === 'ok' && ticket?.id)
        .map((ticket) => ticket.id);
};

const scheduleExpoPushReceiptCheck = ({ result, userId, rut }) => {
    const receiptIds = getExpoPushReceiptIds(result);
    if (receiptIds.length === 0) {
        return;
    }

    const delay = Number.isFinite(EXPO_PUSH_RECEIPT_DELAY_MS)
        ? EXPO_PUSH_RECEIPT_DELAY_MS
        : 30000;
    const timeout = setTimeout(async () => {
        try {
            const response = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ ids: receiptIds }),
            });
            const receiptResult = await response.json();
            const failedReceipts = Object.entries(receiptResult?.data || {})
                .filter(([, receipt]) => receipt?.status === 'error');

            if (!response.ok || failedReceipts.length > 0 || receiptResult?.errors) {
                console.warn('Expo Push receipts con error', {
                    userId: String(userId),
                    rut,
                    receiptResult,
                });
            }
        } catch (error) {
            logHandledError(`Error al consultar recibos Expo Push para ${rut || userId}`, error);
        }
    }, delay);

    if (typeof timeout.unref === 'function') {
        timeout.unref();
    }
};

const obtenerNotificaciones = async (req, res) => {
    const { rut, token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid) {
        try {
            const trabajador = await trabajador_MongooseModel.findOne({
                Rut: { $eq: String(rut) },
            });
            if (!trabajador) {
                return res.status(404).send('Trabajador no encontrado');
            }
            const hiddenIds = getHiddenNotificationIds(trabajador);
            const notificaciones = await notificaciones_MongooseModel.find({
                _id: (trabajador.notificaciones || [])
                    .filter((id) => !hiddenIds.has(id.toString())),
            });
            res.send(notificaciones.map((notificacion) => sanitizeNotificationForClient(notificacion)));
        } catch (error) {
            res.status(500).send(
                'Error interno del servidor: ' + error.message
            );
        }
    }
};
const obtenerNotificacionesDelUser = async (req, res) => {
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);
    
    // Si el token no es válido, devolvemos un error de autorización
    if (!tokenValido.valid) {
      return res.status(401).send("Token inválido");
    }
  
    try {
      const { rut } = tokenValido.token;
      const trabajador = await trabajador_MongooseModel.findOne({ Rut: { $eq: String(rut) } });
      
      if (!trabajador) {
        return res.status(404).send("Trabajador no encontrado");
      }
  
      const notificacionesIds = getWorkerNotificationIds(trabajador);
  
      const notificaciones = await notificaciones_MongooseModel.find({
        _id: { $in: notificacionesIds }
      });
  
      const notificacionesConTipo = await formatNotificationsForApp(notificaciones, trabajador);
  
      return res.send(notificacionesConTipo);
    } catch (error) {
      return res.status(500).send("Error interno del servidor: " + error.message);
    }
  };

const obtenerNotificacionesDelUserPaginadas = async (req, res) => {
    const { token, cursor } = req.body;
    const tokenValido = await Token.validartoken(token);

    if (!tokenValido.valid) {
        return res.status(401).send('Token inválido');
    }

    try {
        const range = req.body.range === 'older' ? 'older' : 'today';
        const limit = normalizeNotificationPageLimit(req.body.limit);
        const { rut } = tokenValido.token;
        const trabajador = await trabajador_MongooseModel.findOne({
            Rut: { $eq: String(rut) },
        });

        if (!trabajador) {
            return res.status(404).send('Trabajador no encontrado');
        }

        const notificacionesIds = getWorkerNotificationIds(trabajador);
        if (notificacionesIds.length === 0) {
            return res.send({
                items: [],
                nextCursor: null,
                hasMore: false,
                range,
                totalLoaded: 0,
            });
        }

        const startOfToday = moment()
            .tz(NOTIFICATION_TIMEZONE)
            .startOf('day')
            .toDate();
        const startOfTomorrow = moment()
            .tz(NOTIFICATION_TIMEZONE)
            .add(1, 'day')
            .startOf('day')
            .toDate();
        const dateQuery = range === 'today'
            ? { fecha: { $gte: startOfToday, $lt: startOfTomorrow } }
            : { fecha: { $lt: startOfToday } };
        const cursorQuery = buildNotificationCursorQuery(cursor);
        const queryParts = [
            { _id: { $in: notificacionesIds } },
            dateQuery,
        ];

        if (Object.keys(cursorQuery).length > 0) {
            queryParts.push(cursorQuery);
        }

        const notificaciones = await notificaciones_MongooseModel
            .find({ $and: queryParts })
            .sort({ fecha: -1, _id: -1 })
            .limit(limit + 1);
        const hasMore = notificaciones.length > limit;
        const pageItems = hasMore ? notificaciones.slice(0, limit) : notificaciones;
        const items = await formatNotificationsForApp(pageItems, trabajador);

        return res.send({
            items,
            nextCursor: hasMore
                ? encodeNotificationCursor(pageItems[pageItems.length - 1])
                : null,
            hasMore,
            range,
            totalLoaded: items.length,
        });
    } catch (error) {
        return res.status(500).send(`Error interno del servidor: ${error.message}`);
    }
};
  
const crearNotificacion = async (req, res) => {
    const { objetivo, tipo, titulo, mensaje, contenido, url } = req.body;
    const token = req.body.token || req.accessToken;
    const tokenValido = await Token.validartoken(token);
    if (!tokenValido.valid) {
        return res.status(401).send('Token inválido');
    }

    if (tipo === 'documento' && !url) {
        return res.status(400).send('Falta la URL del documento');
    }

    const objetivoArray = normalizeNotificationTargets(objetivo);
    if (objetivoArray.length === 0) {
        return res.status(400).send('Falta el objetivo de la notificación');
    }

    try {
        const restipo = await TipoNotificacion.findOne({ value: { $eq: String(tipo) } });
        if (!restipo) {
            return res.status(400).send('Tipo de notificación no encontrado');
        }
        const trabajadores = await getTargetWorkers(objetivoArray);
        const fechaNotificacion = moment().tz('America/Santiago');
        const nuevaNotificacion = createNotificationRecord({
            trabajadores,
            tipoId: restipo._id,
            titulo,
            mensaje,
            contenido,
            url,
            fecha: fechaNotificacion,
        });
        const pushData = buildPushNotificationData({
            contenido,
            notificationId: nuevaNotificacion._id,
            tipo: restipo.value,
            fecha: fechaNotificacion,
            url,
        });

        await assignNotificationToWorkers({
            trabajadores,
            nuevaNotificacion,
            titulo,
            mensaje,
            data: pushData,
        });

        await nuevaNotificacion.save();
        await emitNotificationToWorkers(req.io, trabajadores, nuevaNotificacion);

        return res.status(201).send('Notificación creada correctamente');
    } catch (error) {
        return res.status(500).send(
            'Error interno del servidor: ' + error.message
        );
    }
};
const crearNotificacionDocumento = async (req, res) => {
    const { objetivo, tipo, titulo, mensaje, contenido } = req.body;
    const token = req.body.token || req.accessToken;
    const tokenValido = await Token.validartoken(token);
    if (!tokenValido.valid) {
        return res.status(401).send('Token inválido');
    }

    if (!req.file) {
        return res.status(400).send('Falta el archivo');
    }

    const objetivoArray = normalizeNotificationTargets(objetivo);
    if (objetivoArray.length === 0) {
        return res.status(400).send('Falta el objetivo de la notificación');
    }

    try {
        const restipo = await TipoNotificacion.findOne({ value: { $eq: String(tipo) } });
        if (!restipo) {
            return res.status(400).send('Tipo de notificación no encontrado');
        }
        const trabajadores = await getTargetWorkers(objetivoArray);
        const archivo = req.file;
        const savedAttachment = await saveNotificationAttachment(archivo);
        if (savedAttachment.error) {
            return res.status(400).send(savedAttachment.error);
        }

        const fechaNotificacion = moment().tz('America/Santiago');
        const resTipodocumento = await tipoDocumento_MongooseModel.findOne({
            value: 'Notificacion',
        });
        if (!resTipodocumento) {
            return res.status(400).send('Tipo de documento no encontrado');
        }
        const nuevoDocumento = new documentos_MongooseModel({
            _id: new mongoose.Types.ObjectId(),
            tipo: resTipodocumento._id,
            url: savedAttachment.finalPath,
            formato: archivo.mimetype,
            fecha: fechaNotificacion,
        });
        await nuevoDocumento.save();

        const nuevaNotificacion = createNotificationRecord({
            trabajadores,
            tipoId: restipo._id,
            titulo,
            mensaje,
            contenido,
            url: savedAttachment.finalPath,
            fecha: fechaNotificacion,
        });
        const pushData = buildPushNotificationData({
            contenido,
            notificationId: nuevaNotificacion._id,
            tipo: restipo.value,
            fecha: fechaNotificacion,
            url: savedAttachment.finalPath,
        });

        await assignNotificationToWorkers({
            trabajadores,
            nuevaNotificacion,
            titulo,
            mensaje,
            data: pushData,
            documentoId: nuevoDocumento._id,
        });

        await nuevaNotificacion.save();
        await emitNotificationToWorkers(req.io, trabajadores, nuevaNotificacion);

        return res.status(201).send('Notificación creada correctamente');
    } catch (error) {
        return res.status(500).send(
            'Error interno del servidor: ' + error.message
        );
    }
};
const eliminarNotificacion = async (req, res) => {
    const { token, id } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (!tokenValido.valid) {
        return res.status(401).send('Token inválido');
    }

    if (!mongoose.Types.ObjectId.isValid(String(id))) {
        return res.status(400).send('Notificación inválida');
    }

    try {
        const trabajador = await trabajador_MongooseModel.findOne({
            Rut: { $eq: String(tokenValido.token.rut) },
        });
        if (!trabajador) {
            return res.status(404).send('Trabajador no encontrado');
        }

        const notificacion = await notificaciones_MongooseModel.findById(id);
        if (!notificacion) {
            return res.status(404).send('Notificación no encontrada');
        }

        const assignedWorkerIds = toObjectIdStrings(notificacion.trabajadores || []);
        if (!assignedWorkerIds.includes(trabajador._id.toString())) {
            return res.status(403).send('Notificación no asignada al trabajador');
        }

        let vista = await notificacion_vista_MongooseModel.findOne({
            trabajador: { $eq: trabajador._id },
            notificacion: { $eq: String(id) },
        });
        const hasViewedNotification = Boolean(vista) || hasObjectId(trabajador.vistas, id);
        if (!hasViewedNotification) {
            return res
                .status(409)
                .send('Debes leer la notificación antes de eliminarla');
        }

        if (!vista) {
            vista = new notificacion_vista_MongooseModel({
                trabajador: trabajador._id,
                notificacion: id,
                tiempo: moment().tz('America/Santiago').format('DD-MM-YYYY'),
            });
            await vista.save();
        }

        trabajador.notificaciones = (trabajador.notificaciones || []).filter(
            (notificacionId) => !notificacionId.equals(id)
        );
        if (!hasObjectId(trabajador.vistas, id)) {
            trabajador.vistas.push(id);
        }
        if (!hasObjectId(trabajador.notificacionesEliminadas, id)) {
            trabajador.notificacionesEliminadas.push(id);
        }

        await trabajador.save();
        return res.status(200).send('Notificación eliminada correctamente');
    } catch (error) {
        return res.status(500).send(
            'Error interno del servidor: ' + error.message
        );
    }
};
const infoNotificaciones = async (req, res) => {
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid) {
        try {
            const trabajadores = await trabajador_MongooseModel.find(
                {},
                'Rut Nombre'
            );
            const tipoNotificacione = await TipoNotificacion.find({}, 'value');
            res.status(200).send({
                trabajadores: trabajadores,
                tipoNotificacion: tipoNotificacione,
            });
        } catch (error) {
            res.status(500).send(
                'Error interno del servidor: ' + error.message
            );
        }
    }
};
const buscarNotificacion = async (req, res) => {
    const { token, inicio, fin } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid) {
        const fechainicio = Dayjs(inicio).startOf('day').toDate();
        const fechafin = Dayjs(fin).endOf('day').toDate();
        try {
            const notificaciones = await notificaciones_MongooseModel.find({
                fecha: {
                    $gte: fechainicio,
                    $lte: fechafin,
                },
            });
            const notificacionesConTipo = await Promise.all(
                notificaciones.map(async (notificacion) => {
                    const tipo = await TipoNotificacion.findById(
                        notificacion.tipo
                    );
                    return {
                        id: notificacion._id,
                        tipo: tipo.value,
                        titulo: notificacion.titulo,
                        mensaje: notificacion.mensaje,
                        contenido: notificacion.contenido,
                        url: notificacion.url,
                        fecha: notificacion.fecha,
                    };
                })
            );

            notificacionesConTipo.sort((a, b) => b.fecha - a.fecha);
            res.status(200).send(notificacionesConTipo);
        } catch (error) {
            res.status(500).send(
                'Error interno del servidor: ' + error.message
            );
        }
    } else {
        res.status(401).send('Token inválido');
    }
};
const detallesNotificacion = async (req, res) => {
    const { token, idNotificacion } = req.body;
    try {
        const tokenValido = await Token.validartoken(token);
        if (!tokenValido.valid) {
            return res.status(401).send('Token inválido');
        }

        if (!mongoose.Types.ObjectId.isValid(String(idNotificacion))) {
            return res.status(400).send('Notificación inválida');
        }

        const notificacion = await notificaciones_MongooseModel.findById(idNotificacion);
        if (!notificacion) {
            return res.status(404).send('Notificación no encontrada');
        }

        const assignedWorkerIds = notificacion.trabajadores || [];
        const trabajadores = await trabajador_MongooseModel
            .find({ _id: { $in: assignedWorkerIds } })
            .select('Rut Nombre');
        const vistas = await notificacion_vista_MongooseModel.find({
            notificacion: { $eq: String(idNotificacion) },
            trabajador: { $in: assignedWorkerIds },
        });
        const vistasMap = new Map(
            vistas.map((vista) => [vista.trabajador.toString(), vista])
        );
        const trabajadoresVistos = [];
        const trabajadoresNoVistos = [];

        trabajadores.forEach((trabajador) => {
            const vista = vistasMap.get(trabajador._id.toString());
            const item = {
                rut: trabajador.Rut,
                nombre: trabajador.Nombre,
            };

            if (vista) {
                trabajadoresVistos.push({
                    ...item,
                    fechaVista: vista.tiempo || null,
                });
                return;
            }

            trabajadoresNoVistos.push(item);
        });

        res.status(200).send({
            no_vista: trabajadoresNoVistos,
            vista: trabajadoresVistos,
        });
    } catch (error) {
        res.status(500).send('Error interno del servidor: ' + error.message);
    }
};
const pushNotification = async ({ userId, titulo, mensaje, data }) => {
    try {
        const usuario = await trabajador_MongooseModel.findById(userId);
        if (!usuario?.tokenPush) {
            console.warn('Push omitida: trabajador sin tokenPush', {
                userId: String(userId),
                rut: usuario?.Rut,
            });
            return null;
        }
        const tokenPush = usuario.tokenPush;

        if (!tokenPush.startsWith('ExponentPushToken')) {
            console.warn('Push omitida: tokenPush Expo inválido', {
                userId: String(userId),
                rut: usuario.Rut,
            });
            return null;
        }

        const { ok, result } = await sendExpoPushNotification({
            tokenPush,
            titulo,
            mensaje,
            data,
        });
        const pushResult = Array.isArray(result?.data) ? result.data[0] : result?.data;
        if (!ok || pushResult?.status === 'error' || result?.errors) {
            console.warn('Expo Push respondió con error', {
                userId: String(userId),
                rut: usuario.Rut,
                result,
            });
        }
        scheduleExpoPushReceiptCheck({
            result,
            userId,
            rut: usuario.Rut,
        });
        return result;
    } catch (error) {
        logHandledError('Error al enviar notificación push', error);
        return null;
    }
};
const pushNotificationOLD = async (req, res) => {
    const { userId, titulo, mensaje, data } = req.body;

    if (!userId || !titulo || !mensaje) {
        return res.status(400).send("Faltan datos obligatorios (userId, titulo, mensaje)");
    }
    try {
        const usuario = await trabajador_MongooseModel.findById(userId, "tokenPush");
        if (!usuario?.tokenPush) {
            return res.status(404).send("Usuario no encontrado o sin tokenPush registrado");
        }

        const tokenPush = usuario.tokenPush;

        if (!tokenPush.startsWith("ExponentPushToken")) {
            return res.status(400).send("El tokenPush no es un token válido de Expo");
        }

        const { ok, result } = await sendExpoPushNotification({
            tokenPush,
            titulo,
            mensaje,
            data,
        });

        if (ok) {
            req.io.to('role:administracion').to('role:supervisor').emit('notificacionPush', {
                title: titulo,
                body: mensaje,
            });
            res.status(200).send("Notificación enviada con éxito");
        } else {
            res.status(500).send("Error al enviar notificación: " + JSON.stringify(result));
        }
    } catch (error) {
        logHandledError('Error al enviar notificación push manual', error);
        res.status(500).send("Error interno del servidor");
    }
};

const descargarNotificacionDocumento = async (req, res) => {
    const notificationId = String(req.params.id || '').trim();
    if (!mongoose.isValidObjectId(notificationId)) {
        return res.status(400).send('Notificación inválida');
    }

    try {
        const notificacion = await notificaciones_MongooseModel.findById(notificationId);
        if (!notificacion?.url) {
            return res.status(404).send('Documento no encontrado');
        }

        const requesterRole = String(req.authUser?.cargo || '').trim().toLowerCase();
        const requesterRut = String(req.authUser?.Rut || req.auth?.rut || '').trim();
        const canAccessAllNotifications = ['administracion', 'supervisor'].includes(requesterRole);

        if (!canAccessAllNotifications) {
            const trabajador = await trabajador_MongooseModel.findOne({ Rut: { $eq: requesterRut } });
            const workerId = trabajador?._id?.toString();
            const assignedWorkers = (notificacion.trabajadores || []).map((id) => id.toString());
            if (!workerId || !assignedWorkers.includes(workerId)) {
                return res.status(403).send('Permisos insuficientes');
            }
        }

        const safeFileName = path.basename(String(notificacion.url));
        const uploadsBasePath = path.join(__dirname, '../../storage/uploads');
        const uploadPath = path.join(uploadsBasePath, safeFileName);
        if (!uploadPath.startsWith(`${uploadsBasePath}${path.sep}`)) {
            return res.status(404).send('Documento no encontrado');
        }

        if (!fs.existsSync(uploadPath)) {
            return res.status(404).send('Documento no encontrado');
        }

        return res.download(uploadPath, safeFileName);
    } catch (error) {
        logHandledError(`Error al descargar documento de la notificación ${notificationId}`, error);
        return res.status(500).send('Error interno del servidor');
    }
};

module.exports = {
    buscarNotificacion,
    crearNotificacion,
    eliminarNotificacion,
    obtenerNotificaciones,
    detallesNotificacion,
    infoNotificaciones,
    pushNotification,
    pushNotificationOLD,
    crearNotificacionDocumento,
    obtenerNotificacionesDelUser,
    obtenerNotificacionesDelUserPaginadas,
    descargarNotificacionDocumento,
};
