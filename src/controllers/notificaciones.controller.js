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

const logHandledError = (context, error) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`${context}: ${errorMessage}`);
};

const buildNotificationDownloadUrl = (notificationId, notificationPath) => {
    const safeFileName = path.basename(String(notificationPath || 'adjunto'));
    return `/notificaciones/archivo/${notificationId}/${encodeURIComponent(safeFileName)}`;
};

const sanitizeNotificationForClient = (notificacion) => {
    if (!notificacion) {
        return notificacion;
    }

    const plainNotification = typeof notificacion.toObject === 'function'
        ? notificacion.toObject()
        : { ...notificacion };

    if (plainNotification.url) {
        plainNotification.url = buildNotificationDownloadUrl(
            plainNotification._id || plainNotification.id,
            plainNotification.url
        );
    }

    return plainNotification;
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
    idNotificacion: notificationId,
    tipo,
    fecha,
    url: url || null,
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

const emitNotificationToWorkers = (io, trabajadores, nuevaNotificacion) => {
    const clientNotification = sanitizeNotificationForClient(nuevaNotificacion);
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
            const notificaciones = await notificaciones_MongooseModel.find({
                _id: trabajador.notificaciones,
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
  
      const notificacionesIds = [
        ...new Set([
          ...trabajador.notificaciones.map(id => id.toString()),
          ...trabajador.vistas.map(id => id.toString())
        ])
      ];
  
      const notificaciones = await notificaciones_MongooseModel.find({
        _id: { $in: notificacionesIds }
      });
  
      const vistasSet = new Set(trabajador.vistas.map(id => id.toString()));
  
      const tipoIds = [
        ...new Set(
          notificaciones.map(notificacion => notificacion.tipo.toString())
        )
      ];
      const tipos = await TipoNotificacion.find({
        _id: { $in: tipoIds }
      });
  
      const tiposMap = tipos.reduce((acc, tipo) => {
        acc[tipo._id.toString()] = tipo.value;
        return acc;
      }, {});
  
      const notificacionesConTipo = notificaciones.map(notificacion => ({
        id: notificacion._id,
        tipo: tiposMap[notificacion.tipo.toString()] || "Desconocido",
        titulo: notificacion.titulo,
        mensaje: notificacion.mensaje,
        contenido: notificacion.contenido,
        fecha: notificacion.fecha,
        url: notificacion.url
          ? buildNotificationDownloadUrl(notificacion._id, notificacion.url)
          : null,
        estado: vistasSet.has(notificacion._id.toString())
      }));
  
      return res.send(notificacionesConTipo);
    } catch (error) {
      return res.status(500).send("Error interno del servidor: " + error.message);
    }
  };
  
const crearNotificacion = async (req, res) => {
    const { token, objetivo, tipo, titulo, mensaje, contenido, url } = req.body;
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
        emitNotificationToWorkers(req.io, trabajadores, nuevaNotificacion);

        return res.status(201).send('Notificación creada correctamente');
    } catch (error) {
        return res.status(500).send(
            'Error interno del servidor: ' + error.message
        );
    }
};
const crearNotificacionDocumento = async (req, res) => {
    const { token, objetivo, tipo, titulo, mensaje, contenido } = req.body;
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
            tipo: resTipodocumento.value,
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
        emitNotificationToWorkers(req.io, trabajadores, nuevaNotificacion);

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
    if (tokenValido.valid) {
        try {
            const trabajador = await trabajador_MongooseModel.findOne({ Rut: { $eq: String(tokenValido.token.rut) } });
            const vista= await notificacion_vista_MongooseModel.findOne({ trabajador: { $eq: trabajador._id }, notificacion: { $eq: String(id) } });
            if(!vista){
                const registro= new notificacion_vista_MongooseModel({
                    trabajador:trabajador._id,
                    notificacion:id,
                    tiempo:moment().tz('America/Santiago')
                });
                await registro.save();
            }
            trabajador.notificaciones = trabajador.notificaciones.filter(
                (notificacionId) => !notificacionId.equals(id)
            );
            trabajador.vistas = trabajador.vistas.filter(
                (notificacionId) => !notificacionId.equals(id)
            );

            await trabajador.save();
            res.status(200).send('Notificación eliminada correctamente');
        } catch (error) {
            res.status(500).send(
                'Error interno del servidor: ' + error.message
            );
        }
    } else {
        res.status(401).send('Token inválido');
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

        const novistos = await trabajador_MongooseModel.find({
            notificaciones: { $in: [idNotificacion] },
        });
        const vistos = await trabajador_MongooseModel.find({
            vistas: { $in: [idNotificacion] },
        });

        const trabajadoresNoVistos = await Promise.all(
            novistos.map(async (trabajador) => {
                return {
                    rut: trabajador.Rut,
                    nombre: trabajador.Nombre,
                };
            })
        );

        const trabajadoresVistos = await Promise.all(
            vistos.map(async (trabajador) => {
                const vista = await notificacion_vista_MongooseModel.findOne({
                    trabajador: { $eq: trabajador._id },
                    notificacion: { $eq: String(idNotificacion) },
                });
                return {
                    rut: trabajador.Rut,
                    nombre: trabajador.Nombre,
                    fechaVista: vista
                        ? moment(vista.fecha).format('DD-MM-YYYY')
                        : null,
                };
            })
        );

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
            return null;
        }
        const tokenPush = usuario.tokenPush;

        if (!tokenPush.startsWith('ExponentPushToken')) {
            return null;
        }

        const { result } = await sendExpoPushNotification({
            tokenPush,
            titulo,
            mensaje,
            data,
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
    descargarNotificacionDocumento,
};
