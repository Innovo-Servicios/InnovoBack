const jwt = require('jsonwebtoken');
const key = 'clave';
const { validate, format } = require('rut.js')
const Correo = require('validator');
const { trabajador_MongooseModel: TrabajadorModel } = require('../Model/trabajador_Mongoose.js');
const TipoDocumento = require('../Model/tipoDocumento_Mongoose.js'); // Add this line
const Token = require('../Controller/token.Controller.js')
const {Permiso} = require('../Model/permiso_Mongoose.js');
const { Rol } = require('../Model/rol_Mongoose.js');
const { notificaciones_MongooseModel}= require('../Model/notificacion_Mongoose.js');
const {notificacion_vista_MongooseModel}= require('../Model/notificacion_vista.Mongoose.js');
const { TipoNotificacion } = require('../Model/tipoNotificacion_Mongoose.js');
const { Novedad } = require('../Model/novedad_Mongose.js');
const {Region} = require('../Model/region_Mongoose.js');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const listarTrabajadores = async (req, res) => {
    const {  token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid) {
        try {
            const trabajadores = await TrabajadorModel.find();
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
    const trabajadores = Object.values(usuariosConectados).map((u) => ({
      id: u.id_trabajador,
      ubicacion: u.ubicacion,
    }));
    res.status(200).send(trabajadores);
};
const creartrabajador = async (req, res) => {
    const { rut, nombre, cargo, correo, clave } = req.body;
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
        const nvotrabajador = new TrabajadorModel({
            Rut: rut,
            Nombre: nombre,
            cargo,
            correo,
            clave,
            rol: rol._id
        });
        await nvotrabajador.save();
        req.io.emit('nuevo-trabajador', nvotrabajador);
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
            if (Nuevaclave){ trabajador.clave = Nuevaclave};
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
    const { rut, clave, ID, tokenPush} = req.body; // Asegúrate de que 'rut' y 'clave' son los nombres correctos que se envían desde el cliente
    try {
        // console.log('Iniciando sesión con:', rut, clave,ID, tokenPush);
        // Verificar que el usuario existe y que la clave es correcta
        const usuarioExistente = await TrabajadorModel.findOne({ Rut: { $eq: String(rut) }, clave: { $eq: String(clave) } });
        if (usuarioExistente) {
            const rol = await Rol.findById(usuarioExistente.rol);
            const permisos = await Promise.all(
                rol.permisos.map(async permiso => {
                    return await Permiso.findById(permiso, 'nombre descripcion');
                })
            );
            const userData = {
                nombre: rol.nombre,
                permisos
            };
            const tokenres = await Token.crearToken(req.body);
            usuarioExistente.tokenPush = tokenPush;
            usuarioExistente.ID = ID;
            await usuarioExistente.save();
            return res.send(JSON.stringify({token: tokenres, rol:userData}));
        } else {
            return res.status(400).send('Correo o clave no proporcionados');
        }
    } catch (error) {
        // console.error('Error al iniciar sesión:', error);
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

        const uploadPath = path.join(__dirname, '../../IMG_PERFILES');
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
    const {lat,lng} = req.body;
    const region = await Region.findOne({
      "area.latMin": { $lte: lat },
      "area.latMax": { $gte: lat },
      "area.lngMin": { $lte: lng },
      "area.lngMax": { $gte: lng }
    });
    // return region ? [region.indiceUV_h, region.indiceUV_m] : null;
    res.send(region? [region.indiceUV_h, region.indiceUV_m] : null);
};
  


module.exports = {obtenerRegionChile,creartrabajador, modificardatostrabajador, eliminartrabajador, login, listarTrabajadores,obtenerTrabajador, updatePushToken,listarTrabajadoresConectados,datosTrabajador, datosApp,fotoTrabajador};