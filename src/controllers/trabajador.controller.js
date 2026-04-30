const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { validate, format } = require('rut.js')
const Correo = require('validator');
const { trabajador_MongooseModel: TrabajadorModel } = require('../models/trabajador.model.js');
const TipoDocumento = require('../models/tipoDocumento.model.js'); // Add this line
const Token = require('../controllers/token.controller.js')
const {Permiso} = require('../models/permiso.model.js');
const { Rol } = require('../models/rol.model.js');
const { notificaciones_MongooseModel}= require('../models/notificacion.model.js');
const {notificacion_vista_MongooseModel}= require('../models/notificacion_vista.model.js');
const { TipoNotificacion } = require('../models/tipoNotificacion.model.js');
const { Novedad } = require('../models/novedad.model.js');
const {Region} = require('../models/region.model.js');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const workerSchema = z.object({
    rut: z.string().trim().min(1),
    nombre: z.string().trim().min(2),
    cargo: z.enum(['administracion', 'lector', 'supervisor', 'inspector']),
    correo: z.string().trim().email(),
    clave: z.string().min(8),
});

const loginSchema = z.object({
    rut: z.string().trim().min(1),
    clave: z.string().min(1),
    ID: z.string().trim().optional(),
    tokenPush: z.string().trim().optional(),
});

const isHashedPassword = (value) =>
    typeof value === 'string' && /^\$2[aby]\$\d{2}\$/.test(value);

const hashPassword = async (plainPassword) => bcrypt.hash(plainPassword, 12);
const sharedConnectedWorkers = global.usuariosConectados || {};

const listarTrabajadores = async (req, res) => {
    const {  token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid) {
        try {
            const trabajadores = await TrabajadorModel.find().select('-clave -refreshTokens -sessionVersion -tokenPush -ID');
            res.status(200).send(trabajadores);
        }

        catch (error) {
            // console.error('Error al obtener trabajadores:', error);
            res.status(500).send('Error interno del servidor: ' + error.message);
        }
    } else {
        res.status(401).send('Token inválido');
    }
};
const listarTrabajadoresConectados = (req, res) => {
    const trabajadores = Object.values(sharedConnectedWorkers).map((u) => ({
      id: u.id_trabajador,
      ubicacion: u.ubicacion,
    }));
    res.status(200).send(trabajadores);
};
const creartrabajador = async (req, res) => {
    const parsedWorker = workerSchema.safeParse(req.body);
    if (!parsedWorker.success) {
        return res.status(400).send('Datos de trabajador inválidos');
    }

    const { rut, nombre, cargo, correo, clave } = parsedWorker.data;
    console.log(rut,nombre,cargo,correo,clave)
    try {
        const trabajadorExistente = await TrabajadorModel.findOne({ Rut: { $eq: String(rut) }, Nombre: { $eq: String(nombre) } });
        if (trabajadorExistente) {
            return res.status(400).send('El trabajador ya existe');
        }
        const correoExistente = await TrabajadorModel.findOne({ correo: { $eq: String(correo) } });
        if (correoExistente) {
            return res.status(400).send('El correo ya existe');
        }
        if (!validate(format(rut))) {
            return res.status(405).send('El rut no es valido');
        }
        if (!Correo.isEmail(correo)) {
            return res.status(405).send('El correo no es valido');
        }
        const rol = await Rol.findOne({ nombre: { $eq: String(cargo) } });
        const passwordHash = await hashPassword(clave);
        const nvotrabajador = new TrabajadorModel({
            Rut: rut,
            Nombre: nombre,
            cargo,
            correo,
            clave: passwordHash,
            rol: rol._id
        });
        await nvotrabajador.save();
        req.io.to('role:administracion').emit('nuevo-trabajador', {
            _id: nvotrabajador._id,
            Rut: nvotrabajador.Rut,
            Nombre: nvotrabajador.Nombre,
            cargo: nvotrabajador.cargo,
            correo: nvotrabajador.correo,
        });
        return res.status(201).send('Trabajador registrado correctamente');
    } catch (error) {
        // console.error('Error al registrar Trabajador:', error);
        return res.status(500).send('Error interno del servidor: ' + error.message);
    }
};
const modificardatostrabajador = async (req, res) => {
    const {  token, rut} = req.body;
    const tokenValido = await Token.validartoken(token,res);
    if (tokenValido.valid){ 
        const { Nuevonombre, Nuevocargo, Nuevocorreo, Nuevaclave } = req.body;
        try {
            // Buscar el trabajador por Rut
            const trabajador = await TrabajadorModel.findOne({ Rut: { $eq: String(rut) } });
            if (!trabajador) {
                return res.status(404).send('Trabajador no existente');
            }

            if (Nuevonombre){ trabajador.Nombre = Nuevonombre};
            if (Nuevocargo){ trabajador.cargo = Nuevocargo};
            if (Nuevocorreo){ trabajador.correo = Nuevocorreo};
            if (Nuevaclave){ trabajador.clave = await hashPassword(String(Nuevaclave))};
            await trabajador.save();
            req.io.emit('updateWorker');
            return res.status(201).send('Datos trabajador modificados correctamente');
        } catch (error) {
            // console.error('Error al modificar datos:', error);
            res.status(500).send('Error interno del servidor: ' + error.message);
        }
    }else {
        res.status(401).send('Token inválido');
    }
};
const eliminartrabajador = async (req, res) => {
    const { token} = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid){ 
        try {
            const { rut } = req.body;
            const trabajadorExistente = await TrabajadorModel.findOne({ Rut: { $eq: String(rut) } });
            if (!trabajadorExistente) {
                return res.status(400).send('El trabajador no existe'); 
            }
            else{
                const trabajadorExistente = await TrabajadorModel.deleteOne({ Rut: { $eq: String(rut) } });
                if (trabajadorExistente) {
                    return res.send('Trabajador eliminado correctamente');
                }
            }
        }catch (error) {
            // console.error('Error al eliminar trabajador:', error);
            res.status(500).send('Error interno del servidor: ' + error.message);
        }
    }else {
        res.status(401).send('Token inválido');
    }
};
const login = async (req, res) => {
    const parsedLogin = loginSchema.safeParse(req.body);
    if (!parsedLogin.success) {
        return res.status(400).send('Credenciales inválidas');
    }

    const { rut, clave, ID, tokenPush } = parsedLogin.data;
    console.log("🚀 ~ login ~ rut:", rut)
    
    try {
        const usuarioExistente = await TrabajadorModel.findOne({
            Rut: { $eq: String(rut) },
        });

        if (!usuarioExistente) {
            return res.status(401).send('Credenciales inválidas');
        }

        const storedPassword = String(usuarioExistente.clave || '');
        const passwordMatches = isHashedPassword(storedPassword)
            ? await bcrypt.compare(String(clave), storedPassword)
            : storedPassword === String(clave);

        if (!passwordMatches) {
            return res.status(401).send('Credenciales inválidas');
        }

        if (!isHashedPassword(storedPassword)) {
            usuarioExistente.clave = await hashPassword(String(clave));
        }

        const rol = await Rol.findById(usuarioExistente.rol);
        const permisos = await Promise.all(
            (rol?.permisos || []).map(async permiso => {
                return await Permiso.findById(permiso, 'nombre descripcion');
            })
        );
        const userData = {
            nombre: rol?.nombre || usuarioExistente.cargo,
            permisos: permisos.filter(Boolean),
        };

        if (tokenPush) {
            usuarioExistente.tokenPush = tokenPush;
        }
        if (ID) {
            usuarioExistente.ID = ID;
        }

        const sessionTokens = await Token.issueSessionTokens(
            usuarioExistente,
            ID || usuarioExistente.ID || undefined
        );

        Token.setRefreshTokenCookie(res, sessionTokens.refreshToken);

        return res.json({
            token: sessionTokens.accessToken,
            refreshToken: ID ? sessionTokens.refreshToken : undefined,
            rol: userData,
            deviceId: sessionTokens.deviceId,
        });
    } catch (error) {
        res.status(500).send('Error interno del servidor: ' + error.message);
    }
};
const updatePushToken = async (req, res) => {
    const { token, tokenPush } = req.body;
    // console.log('Actualizando token push:', token, tokenPush);
    const tokenValido = await Token.validartoken(token);
    if (!tokenValido.valid) {
        return res.status(401).send('Token inválido');
    }
    const { rut } = tokenValido.token;
    try {
        const trabajador = await TrabajadorModel.findOne({ Rut: { $eq: String(rut) } });
        if (!trabajador) {
            return res.status(404).send('Trabajador no encontrado');
        }
        else{
            if (trabajador.tokenPush !== tokenPush) {
                trabajador.tokenPush = tokenPush;
                await trabajador.save();
                res.send('Token actualizado correctamente');
            } else {
                res.send('El token push ya está actualizado');
            }
        }
    } catch (error) {
        // console.error('Error al actualizar token push:', error);
        res.status(500).send('Error interno del servidor: ' + error.message);
    }
}
const obtenerTrabajador = async (req, res) => {
    const { rut, token } = req.body;
    try {
        // Validar el token
        const tokenValido = await Token.validartoken(token);
        if (!tokenValido.valid) {
            return res.status(401).send('Token inválido');
        }

        // Buscar al trabajador por su RUT y poblar las notificaciones
        const trabajador = await TrabajadorModel.findOne(
            { Rut: { $eq: String(rut) } },
            "Rut Nombre cargo apoyo correo notificaciones documentos rol rolTemporal"
        ).populate({
            path: 'notificaciones',
            model: 'notificaciones', // Nombre del modelo de notificaciones
            select: '_id tipo titulo',
            populate: {
                path: 'tipo', // Poblar el tipo de notificación
                model: 'TipoNotificacion' // Nombre del modelo de tipos de notificación
            }
        }).populate({
            path: 'documentos',
            model: 'documentos', // Nombre del modelo de documentos
            select: '_id tipo formato',
            populate: {
                path: 'tipo', // Poblar el tipo de documento
                model: 'tipoDocumento' // Nombre del modelo de tipos de documento
            }
        });

        if (!trabajador) {
            return res.status(404).send('Trabajador no encontrado');
        }

        res.send(trabajador);
    } catch (error) {
        // console.error('Error al obtener trabajador:', error);
        res.status(500).send('Error interno del servidor: ' + error.message);
    }
};
const datosTrabajador = async (req, res) => {
    const {token , rut} = req.body;
    try {
        // Validar el token
        const tokenValido = await Token.validartoken(token);
        if (!tokenValido.valid) {
            return res.status(401).send('Token inválido');
        }
        let trabajador = await TrabajadorModel.findOne({ Rut: { $eq: String(rut) } }).populate({
            path: 'documentos',
            model: 'documentos', // Nombre del modelo de documentos
            populate: {
            path: 'tipo',
            model: 'tipoDocumento',
            select: 'value'
            }
        }).populate({
            path:"rol",
            model:"Rol",
            select:"_id nombre"
        });

        trabajador.vistas.forEach(vista => {
            trabajador.notificaciones.push(vista);
        });
        trabajador = trabajador.toObject();
        delete trabajador.clave;
        delete trabajador.vistas;

        const notificaciones= await Promise.all(trabajador.notificaciones.map(async notificacion => {
            const notificacionDB = await notificaciones_MongooseModel.findById(notificacion);   
            const vistaDB= await notificacion_vista_MongooseModel.findOne({ trabajador: { $eq: trabajador._id }, notificacion: { $eq: String(notificacion) } });
            const tiponoti= await TipoNotificacion.findById(notificacionDB.tipo);
            const modelo = {
                _id: notificacionDB._id,
                tipo: tiponoti,
                mensaje: notificacionDB.mensaje,
                titulo: notificacionDB.titulo,
                ...(vistaDB && { fecha: vistaDB.tiempo, estado: "visto" }),
                ...(!vistaDB && { estado: "enviado" }),
                __v: notificacionDB.__v
            };      

            return modelo;
        }));
        trabajador.novedades = await Novedad.find({emisor: trabajador._id}).populate('TipoNovedad').populate('direccion');
        trabajador.notificaciones = notificaciones;
        if (!trabajador) {
            return res.status(404).send('Trabajador no encontrado');
        }
        res.send(trabajador);
    } catch (error) {
        // console.error('Error al obtener trabajador:', error);
        res.status(500).send('Error interno del servidor: ' + error.message);
    }
}
const datosApp = async (req, res) => {
    const {token} = req.body;
    try {
        // Validar el token
        const tokenValido = await Token.validartoken(token);
        if (!tokenValido.valid) {
            return res.status(401).send('Token inválido');
        }
        let trabajador = await TrabajadorModel.findOne({ Rut: { $eq: String(tokenValido.token.rut) } }).populate({
            path: 'documentos',
            model: 'documentos', // Nombre del modelo de documentos
            populate: {
            path: 'tipo',
            model: 'tipoDocumento',
            select: 'value'
            }
        }).populate({
            path:"rol",
            model:"Rol",
            select:"_id nombre"
        });
        trabajador = trabajador.toObject();
        //Credencial?????
        delete trabajador.clave;
        delete trabajador.notificaciones;
        delete trabajador.vistas;
        delete trabajador?.lastUbication;
        delete trabajador?.ID;
        delete trabajador?.tokenPush;
        if (!trabajador) {
            return res.status(404).send('Trabajador no encontrado');
        }
        res.send(trabajador);
    } catch (error) {
        // console.error('Error al obtener trabajador:', error);
        res.status(500).send('Error interno del servidor: ' + error.message);
    }
}
const fotoTrabajador = async (req, res) => {
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);
    try {
        if (!tokenValido.valid) {
            return res.status(401).send('Token inválido');
        }

        const trabajador = await TrabajadorModel.findOne({ Rut: { $eq: String(tokenValido.token.rut) } });
        if (!trabajador) {
            return res.status(404).send('Trabajador no encontrado');
        }

        if (!req.file) {
            return res.status(400).send('No se ha enviado ninguna imagen');
        }
        const archivo = req.file;
        const formatosPermitidos = [
            'image/jpeg',
            'image/png',
            'image/jpg'
        ];
        
        if (!formatosPermitidos.includes(archivo.mimetype)) {
            return res.status(400).send('Formato de archivo no permitido: ' + archivo.mimetype);
        }
        // Usar un nombre base para el archivo, manteniendo su extensión como .jpeg
        let filename;
        if (trabajador.perfil) {
            // Si ya existe una foto, extraer el nombre sin extensión
            filename = path.basename(trabajador.perfil, path.extname(trabajador.perfil));
            // Eliminar la foto anterior si existe en el sistema
            if (fs.existsSync(trabajador.perfil)) {
                fs.unlinkSync(trabajador.perfil);
            }
        } else {
            filename = trabajador.Rut;
        }

        const uploadPath = path.join(__dirname, '../../public/images/perfiles');
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }

        const finalPath = path.join(uploadPath, path.basename(filename + '.jpeg'));

        await sharp(archivo.buffer)
            .resize(1024, 1024, { fit: 'inside' }) // Redimensiona manteniendo proporción
            .toFormat('jpeg', { quality: 80 }) // Convierte a JPEG con calidad 80%
            .toFile(finalPath);

        trabajador.perfil = finalPath;
        await trabajador.save();
        res.status(201).send('Foto de perfil actualizada correctamente');
    } catch (error) {
        console.error('Error al actualizar foto de trabajador:', error);
        res.status(500).send('Error interno del servidor: ' + error.message);
    }
}

const obtenerRegionChile = async (req,res) => {
    try {
        const lat = Number(req.body.lat);
        const lng = Number(req.body.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            return res.status(400).json({ message: 'Coordenadas inválidas' });
        }

        const region = await Region.findOne({
          "area.latMin": { $lte: lat },
          "area.latMax": { $gte: lat },
          "area.lngMin": { $lte: lng },
          "area.lngMax": { $gte: lng }
        });

        const fallbackRegion = region || await Region.findOne({ idnumero: 5 });
        if (!fallbackRegion) {
            return res.status(404).json({ message: 'No hay datos UV disponibles' });
        }

        if (!region) {
            console.warn(`No se encontró región UV para lat=${lat}, lng=${lng}. Usando Valparaíso como fallback.`);
        }

        return res.json([fallbackRegion.indiceUV_h ?? 0, fallbackRegion.indiceUV_m ?? 0]);
    } catch (error) {
        console.error('Error al obtener región UV:', error);
        return res.status(500).json({ message: 'Error interno al obtener datos UV' });
    }
};
  


module.exports = {obtenerRegionChile,creartrabajador, modificardatostrabajador, eliminartrabajador, login, listarTrabajadores,obtenerTrabajador, updatePushToken,listarTrabajadoresConectados,datosTrabajador, datosApp,fotoTrabajador};
