//borrar, listar, filtrar -tipo-fecha
const mongoose = require('mongoose');
const Token = require('../Controller/token.Controller.js');
const {
    notificaciones_MongooseModel,
} = require('../Model/notificacion_Mongoose.js');
const { trabajador_MongooseModel } = require('../Model/trabajador_Mongoose.js');
const { TipoNotificacion } = require('../Model/tipoNotificacion_Mongoose.js');
const {
    notificacion_vista_MongooseModel,
} = require('../Model/notificacion_vista.Mongoose.js');
const {
    tipoDocumento_MongooseModel,
} = require('../Model/tipoDocumento_Mongoose.js');
const { documentos_MongooseModel } = require('../Model/documentos_Mongoose.js');
const moment = require('moment-timezone');
const Dayjs = require('dayjs');
const admin = require('firebase-admin');
// const serviceAccount = require('../../serviceAccountKey.json');
const fetch = require('node-fetch');
const path = require('path');
const sharp = require('sharp');
const fs = require('fs');
// admin.initializeApp({
//     credential: admin.credential.cert(serviceAccount),
// });

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
    if (tokenValido.valid) {
        const restipo = await TipoNotificacion.findOne({ value: { $eq: String(tipo) } });
        if (tipo === 'documento' && !url) {
            return res.status(400).send('Falta la URL del documento');
        }
        try {
            let trabajadores;
            if (objetivo && objetivo.length > 0) {
                if (objetivo[0] === 'all') {
                    trabajadores = await trabajador_MongooseModel.find();
                } else {
                    trabajadores = await trabajador_MongooseModel.find({
                        Rut: { $in: objetivo },
                    });
                }
            } else {
                return res
                    .status(400)
                    .send('Falta el objetivo de la notificación');
            }
            const trabajadoresIds = trabajadores.map(
                (trabajador) => trabajador._id
            );
            const nuevaNotificacion = new notificaciones_MongooseModel({
                id: new mongoose.Types.ObjectId(),
                trabajadores: trabajadoresIds,
                tipo: restipo._id,
                titulo,
                mensaje,
                contenido,
                url,
                fecha: moment().tz('America/Santiago'),
            });

            for (let trabajador of trabajadores) {
                trabajador.notificaciones.push(nuevaNotificacion.id);
                let result = await pushNotification({
                    userId: trabajador._id,
                    titulo: titulo,
                    mensaje: mensaje,
                    data: {contenidos:contenido,idNotificacion:nuevaNotificacion._id,tipo:restipo.value,fecha:moment().tz('America/Santiago'),url:url||null},
                });

                await trabajador.save();
            }

            await nuevaNotificacion.save();
            // Emitir el evento de nueva notificación a los clientes
            // console.log('Emitiendo a');
            if (objetivo[0] === 'all') {
                for (const t of trabajadores) {
                    req.io
                        .to(`worker:${t.Rut}`)
                        .emit('nuevaNotificacion', sanitizeNotificationForClient(nuevaNotificacion));
                }
            } else {
                // Emitir para cada Rut que esté conectado en Socket
                for (const t of trabajadores) {
                    req.io
                        .to(`worker:${t.Rut}`)
                        .emit('nuevaNotificacion', sanitizeNotificationForClient(nuevaNotificacion));
                    // console.log('Emitiendo a', t.Rut);
                }
            }

            res.status(201).send('Notificación creada correctamente');
        } catch (error) {
            res.status(500).send(
                'Error interno del servidor: ' + error.message
            );
        }
    } else {
        res.status(401).send('Token inválido');
    }
};
const crearNotificacionDocumento = async (req, res) => {
    const { token, objetivo, tipo, titulo, mensaje, contenido } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid) {
        const restipo = await TipoNotificacion.findOne({ value: { $eq: String(tipo) } });
        if (tipo === 'documento' && !url) {
            return res.status(400).send('Falta la URL del documento');
        }
        if (!req.file) {
            return res.status(400).send('Falta el archivo');
        }
        try {
            let trabajadores;
            let objetivoArray = Array.isArray(objetivo) ? objetivo : JSON.parse(objetivo);

            if (objetivoArray[0] === 'all') {
                trabajadores = await trabajador_MongooseModel.find();
            } else {
                trabajadores = await trabajador_MongooseModel.find({
                    Rut: { $in: objetivoArray },
                });
            }
            const archivo = req.file;
            const formatosPermitidos = [
                'application/pdf',
                'image/jpeg',
                'image/png',
                'image/jpg'
            ];
            if (!formatosPermitidos.includes(archivo.mimetype)) {
                return res
                    .status(400)
                    .send(
                        'Formato de archivo no permitido: ' + archivo.mimetype
                    );
            }
            const resTipodocumento = await tipoDocumento_MongooseModel.findOne({
                value: 'Notificacion',
            });
            const uploadPath = path.join(__dirname, '../../uploads');
            if (!fs.existsSync(uploadPath)) {
                fs.mkdirSync(uploadPath, { recursive: true });
            }
            const fileName = path.basename(`file-${Date.now()}-${archivo.originalname}`);
            let finalPath = path.join(uploadPath, fileName);
            if (
                archivo.mimetype === 'image/jpeg' ||
                archivo.mimetype === 'image/png'|| archivo.mimetype === 'image/jpg'
            ) {
                // Procesar imágenes en memoria con sharp
                finalPath = path.join(
                    uploadPath,
                    fileName.replace(/\s/g, '').replace(/\.[^/.]+$/, '.jpeg')
                );
                await sharp(archivo.buffer)
                    .resize(1024, 1024, { fit: 'inside' }) // Redimensiona manteniendo proporción
                    .toFormat('jpeg', { quality: 80 }) // Convierte a JPEG con calidad 80%
                    .toFile(finalPath);
            } else {
                fs.writeFileSync(finalPath, archivo.buffer);
            }
            const nuevoDocumento = new documentos_MongooseModel({
                _id: new mongoose.Types.ObjectId(),
                tipo: resTipodocumento._id,
                url: finalPath, // Ruta del archivo guardado (procesado si es imagen)
                formato: archivo.mimetype,
                fecha: moment().tz('America/Santiago'),
            });
            await nuevoDocumento.save();

            const trabajadoresIds = trabajadores.map(
                (trabajador) => trabajador._id
            );
            const nuevaNotificacion = new notificaciones_MongooseModel({
                id: new mongoose.Types.ObjectId(),
                trabajadores: trabajadoresIds,
                tipo: restipo._id,
                titulo,
                mensaje,
                contenido,
                url: finalPath,
                fecha: moment().tz('America/Santiago'),
            });

            for (let trabajador of trabajadores) {
                trabajador.notificaciones.push(nuevaNotificacion.id);
                trabajador.documentos.push(nuevoDocumento._id);
                let result = await pushNotification({
                    userId: trabajador._id,
                    titulo: titulo,
                    mensaje: mensaje,
                    data: {contenidos:contenido,
                        idNotificacion:nuevaNotificacion._id,
                        tipo:resTipodocumento.value,
                        fecha:moment().tz('America/Santiago'),
                        url:finalPath||null},
                });
                await trabajador.save();
            }

            await nuevaNotificacion.save();
            // Emitir el evento de nueva notificación a los clientes

            // Emitir SOLO a los usuarios correspondientes
            if (objetivoArray[0] === 'all') {
                for (const t of trabajadores) {
                    req.io
                        .to(`worker:${t.Rut}`)
                        .emit('nuevaNotificacion', sanitizeNotificationForClient(nuevaNotificacion));
                }
            } else {
                // Emitir para cada Rut que esté conectado en Socket
                for (const t of trabajadores) {
                    req.io
                        .to(`worker:${t.Rut}`)
                        .emit('nuevaNotificacion', sanitizeNotificationForClient(nuevaNotificacion));
                }
            }

            res.status(201).send('Notificación creada correctamente');
        } catch (error) {
            res.status(500).send(
                'Error interno del servidor: ' + error.message
            );
        }
    } else {
        res.status(401).send('Token inválido');
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
            // await notificaciones_MongooseModel.findByIdAndDelete(id);
            // Emitir el evento de eliminación de notificación a los clientes
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
            // // console.log('Notificaciones encontradas:', notificaciones);
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
        // Buscar el tokenPush del usuario en la base de datos
        const usuario = await trabajador_MongooseModel.findById(
            userId
        );
        if (!usuario || !usuario.tokenPush) {
            // console.log('Usuario no encontrado o sin tokenPush');
            return;
        }
        const tokenPush = usuario.tokenPush;

        // Validar que el token es un ExponentPushToken
        if (!tokenPush.startsWith('ExponentPushToken')) {
            // return console.error('TokenPush inválido:', tokenPush);
        }

        // Crear el mensaje para Expo
        const mensajeNotificacion = {
            to: tokenPush,
            sound: 'default',
            title: titulo,
            body: mensaje,
            data: data || {}, // Datos adicionales
        };

        // Enviar el mensaje a los servidores de Expo
        const response = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(mensajeNotificacion),
        });

        const result = await response.json();
        return result;
    } catch (error) {
        // console.error('Error al enviar notificación:', error.message);
    }
};
const pushNotificationOLD = async (req, res) => {
    const { userId, titulo, mensaje, data } = req.body;

    if (!userId || !titulo || !mensaje) {
        return res.status(400).send("Faltan datos obligatorios (userId, titulo, mensaje)");
    }
    try {
        // Buscar el tokenPush del usuario en la base de datos
        const usuario = await trabajador_MongooseModel.findById(userId, "tokenPush");
        if (!usuario || !usuario.tokenPush) {
            return res.status(404).send("Usuario no encontrado o sin tokenPush registrado");
        }

        const tokenPush = usuario.tokenPush;

        // Validar que el token es un ExponentPushToken
        if (!tokenPush.startsWith("ExponentPushToken")) {
            return res.status(400).send("El tokenPush no es un token válido de Expo");
        }

        // Crear el mensaje para Expo
        const mensajeNotificacion = {
            to: tokenPush,
            sound: "default",
            title: titulo,
            body: mensaje,
            data: data || {}, // Datos adicionales
        };

        // Enviar el mensaje a los servidores de Expo
        const response = await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(mensajeNotificacion),
        });

        const result = await response.json();

        if (response.ok) {
            req.io.to('role:administracion').to('role:supervisor').emit('notificacionPush', {
                title: titulo,
                body: mensaje,
            });
            res.status(200).send("Notificación enviada con éxito");
        } else {
            // console.error("Error desde Expo:", result);
            res.status(500).send("Error al enviar notificación: " + JSON.stringify(result));
        }
    } catch (error) {
        // console.error("Error al enviar notificación:", error.message);
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
        if (!notificacion || !notificacion.url) {
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
        const uploadsBasePath = path.join(__dirname, '../../uploads');
        const uploadPath = path.join(uploadsBasePath, safeFileName);
        if (!uploadPath.startsWith(`${uploadsBasePath}${path.sep}`)) {
            return res.status(404).send('Documento no encontrado');
        }

        if (!fs.existsSync(uploadPath)) {
            return res.status(404).send('Documento no encontrado');
        }

        return res.download(uploadPath, safeFileName);
    } catch (error) {
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
