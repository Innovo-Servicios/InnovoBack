const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { validate, format } = require('rut.js')
const Correo = require('validator');
const {
    trabajador_MongooseModel: TrabajadorModel,
    EMPRESAS_TRABAJADOR,
} = require('../models/trabajador.model.js');
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
const {
    canAccessRut,
    getAuthRut,
    isPrivilegedRequest,
    sanitizeDocumentForClient,
    sanitizeWorkerForClient,
} = require('../utils/security.js');
const {
    mergeWorkerLocationSnapshots,
} = require('../utils/workerTracking.js');

const workerSchema = z.object({
    rut: z.string().trim().min(1),
    nombre: z.string().trim().min(2),
    cargo: z.enum(['administracion', 'lector', 'supervisor', 'inspector']).optional(),
    rolId: z.string().trim().optional(),
    empresa: z.union([z.string(), z.array(z.string())]).nullable().optional(),
    correo: z.string().trim().email(),
    clave: z.string().min(8),
}).refine((worker) => worker.cargo || worker.rolId, {
    message: 'Debe seleccionar un rol',
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
const getSharedConnectedWorkers = () => globalThis.usuariosConectados || {};
const normalizeEmpresas = (value) => {
    if (value === undefined) {
        return undefined;
    }

    const values = Array.isArray(value) ? value : [value];
    const empresas = values
        .map((item) => String(item || '').trim())
        .filter(Boolean);

    if (empresas.length === 0) {
        return [];
    }

    const invalidEmpresa = empresas.find((empresa) => !EMPRESAS_TRABAJADOR.includes(empresa));
    if (invalidEmpresa) {
        return undefined;
    }

    return Array.from(new Set(empresas));
};

const listarTrabajadores = async (req, res) => {
    try {
        const trabajadores = await TrabajadorModel.find()
            .select('-clave -refreshTokens -sessionVersion -tokenPush -ID -lastUbication')
            .populate({ path: 'rol', select: '_id nombre arquetipo activo' })
            .populate({ path: 'rolTemporal.rol', select: '_id nombre arquetipo activo' });
        return res.status(200).send(trabajadores.map((worker) => sanitizeWorkerForClient(worker)));
    } catch (error) {
        console.error('Error al obtener trabajadores:', error.message);
        return res.status(500).send('Error interno del servidor');
    }
};
const listarTrabajadoresConectados = (req, res) => {
    const trabajadores = Object.values(getSharedConnectedWorkers()).map((u) => ({
      id: u.id_trabajador,
      ubicacion: u.ubicacion,
    }));
    res.status(200).send(trabajadores);
};

const seguimientoUbicaciones = async (req, res) => {
    try {
        const trabajadores = await TrabajadorModel.find({
            'lastUbication.lat': { $exists: true, $ne: null },
            'lastUbication.lng': { $exists: true, $ne: null },
        })
            .select('Rut Nombre lastUbication')
            .lean();

        const ubicaciones = mergeWorkerLocationSnapshots({
            workers: trabajadores,
            connectedWorkers: Object.values(getSharedConnectedWorkers()),
        });

        return res.status(200).send(ubicaciones);
    } catch (error) {
        console.error('Error al obtener seguimiento de trabajadores:', error.message);
        return res.status(500).send('Error interno del servidor');
    }
};
const creartrabajador = async (req, res) => {
    const parsedWorker = workerSchema.safeParse(req.body);
    if (!parsedWorker.success) {
        return res.status(400).send('Datos de trabajador inválidos');
    }

    const { rut, nombre, cargo, rolId, empresa, correo, clave } = parsedWorker.data;
    const empresasNormalizadas = normalizeEmpresas(empresa);
    if (empresa !== undefined && empresasNormalizadas === undefined) {
        return res.status(400).send('Empresa inválida');
    }
    const empresas = empresasNormalizadas || [];
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
        const rol = rolId
            ? await Rol.findOne({ _id: rolId, activo: true, legado: { $ne: true } })
            : await Rol.findOne({
                $or: [
                    { arquetipo: cargo, esBase: true, activo: true, legado: { $ne: true } },
                    { nombre: { $eq: String(cargo) } },
                ],
            });
        if (!rol) {
            return res.status(400).send('Rol no encontrado');
        }
        const passwordHash = await hashPassword(clave);
        const nvotrabajador = new TrabajadorModel({
            Rut: rut,
            Nombre: nombre,
            cargo: rol.arquetipo || cargo,
            arquetipo: rol.arquetipo || cargo,
            empresa: empresas,
            correo,
            clave: passwordHash,
            rol: rol._id
        });
        await nvotrabajador.save();
        req.io.to('permission:trabajadores.ver').emit('nuevo-trabajador', {
            _id: nvotrabajador._id,
            Rut: nvotrabajador.Rut,
            Nombre: nvotrabajador.Nombre,
            cargo: nvotrabajador.cargo,
            empresa: nvotrabajador.empresa || [],
            correo: nvotrabajador.correo,
        });
        return res.status(201).send('Trabajador registrado correctamente');
    } catch (error) {
        console.error('Error al registrar Trabajador:', error.message);
        return res.status(500).send('Error interno del servidor');
    }
};
const modificardatostrabajador = async (req, res) => {
    const { rut} = req.body;
    if (req.authUser){ 
        const { Nuevonombre, Nuevocargo, NuevoRol, Nuevocorreo, Nuevaclave } = req.body;
        const nuevaEmpresa = normalizeEmpresas(req.body.Nuevaempresa);
        if (req.body.Nuevaempresa !== undefined && nuevaEmpresa === undefined) {
            return res.status(400).send('Empresa inválida');
        }
        try {
            // Buscar el trabajador por Rut
            const trabajador = await TrabajadorModel.findOne({ Rut: { $eq: String(rut) } });
            if (!trabajador) {
                return res.status(404).send('Trabajador no existente');
            }

            if (Nuevonombre){ trabajador.Nombre = Nuevonombre};
            if (NuevoRol) {
                const role = await Rol.findOne({ _id: NuevoRol, activo: true, legado: { $ne: true } });
                if (!role) return res.status(400).send('Rol no encontrado');
                trabajador.rol = role._id;
                trabajador.arquetipo = role.arquetipo;
                trabajador.cargo = role.arquetipo;
                trabajador.rolTemporal = undefined;
            } else if (Nuevocargo) {
                const role = await Rol.findOne({ arquetipo: Nuevocargo, esBase: true, activo: true, legado: { $ne: true } });
                if (!role) return res.status(400).send('Rol no encontrado');
                trabajador.rol = role._id;
                trabajador.arquetipo = role.arquetipo;
                trabajador.cargo = role.arquetipo;
                trabajador.rolTemporal = undefined;
            }
            if (req.body.Nuevaempresa !== undefined){ trabajador.empresa = nuevaEmpresa};
            if (Nuevocorreo){ trabajador.correo = Nuevocorreo};
            if (Nuevaclave){ trabajador.clave = await hashPassword(String(Nuevaclave))};
            await trabajador.save();
            req.io.emit('updateWorker');
            return res.status(201).send('Datos trabajador modificados correctamente');
        } catch (error) {
            console.error('Error al modificar datos trabajador:', error.message);
            res.status(500).send('Error interno del servidor');
        }
    }else {
        res.status(401).send('Token inválido');
    }
};
const eliminartrabajador = async (req, res) => {
    if (req.authUser){ 
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
            console.error('Error al eliminar trabajador:', error.message);
            res.status(500).send('Error interno del servidor');
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
            ID || undefined
        );

        Token.setRefreshTokenCookie(res, sessionTokens.refreshToken);

        return res.json({
            token: sessionTokens.accessToken,
            refreshToken: ID ? sessionTokens.refreshToken : undefined,
            rol: userData,
            deviceId: sessionTokens.deviceId,
        });
    } catch (error) {
        console.error('Error en login:', error.message);
        res.status(500).send('Error interno del servidor');
    }
};
const updatePushToken = async (req, res) => {
    const { tokenPush } = req.body;
    const rut = getAuthRut(req);
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
        console.error('Error al actualizar token push:', error.message);
        res.status(500).send('Error interno del servidor');
    }
}
const obtenerTrabajador = async (req, res) => {
    const { rut } = req.body;
    try {
        if (!canAccessRut(req, rut)) {
            return res.status(403).send('Permisos insuficientes');
        }

        // Buscar al trabajador por su RUT y poblar las notificaciones
        const trabajador = await TrabajadorModel.findOne(
            { Rut: { $eq: String(rut) } },
            "Rut Nombre cargo empresa apoyo correo notificaciones documentos rol rolTemporal"
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

        res.send(sanitizeWorkerForClient(trabajador, { includeNotificationRefs: true }));
    } catch (error) {
        console.error('Error al obtener trabajador:', error.message);
        res.status(500).send('Error interno del servidor');
    }
};
const datosTrabajador = async (req, res) => {
    const { rut } = req.body;
    try {
        if (!canAccessRut(req, rut)) {
            return res.status(403).send('Permisos insuficientes');
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
            select:"_id nombre arquetipo"
        }).populate({
            path:"rolTemporal.rol",
            model:"Rol",
            select:"_id nombre arquetipo"
        });
        if (!trabajador) {
            return res.status(404).send('Trabajador no encontrado');
        }

        trabajador.vistas?.forEach(vista => {
            trabajador.notificaciones.push(vista);
        });
        trabajador = trabajador.toObject();

        const notificaciones= await Promise.all(trabajador.notificaciones.map(async notificacion => {
            const notificacionDB = await notificaciones_MongooseModel.findById(notificacion);   
            if (!notificacionDB) return null;
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
        })).then((items) => items.filter(Boolean));
        trabajador.novedades = await Novedad.find({emisor: trabajador._id}).populate('TipoNovedad').populate('direccion');
        trabajador.notificaciones = notificaciones;
        res.send(sanitizeWorkerForClient(trabajador, {
            includeNotificationRefs: true,
            includeLastUbication: isPrivilegedRequest(req),
        }));
    } catch (error) {
        console.error('Error al obtener datos trabajador:', error.message);
        res.status(500).send('Error interno del servidor');
    }
}
const datosApp = async (req, res) => {
    try {
        let trabajador = await TrabajadorModel.findOne({ Rut: { $eq: getAuthRut(req) } }).populate({
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
            select:"_id nombre arquetipo"
        }).populate({
            path:"rolTemporal.rol",
            model:"Rol",
            select:"_id nombre arquetipo"
        });
        if (!trabajador) {
            return res.status(404).send('Trabajador no encontrado');
        }
        res.send(sanitizeWorkerForClient(trabajador));
    } catch (error) {
        console.error('Error al obtener datos app:', error.message);
        res.status(500).send('Error interno del servidor');
    }
}

const obtenerSesion = async (req, res) => {
    try {
        const user = req.authUser;
        return res.json({
            usuario: {
                id: String(user._id),
                rut: user.Rut,
                nombre: user.Nombre,
                correo: user.correo,
            },
            rol: req.authz?.rol || null,
            rolPermanente: req.authz?.rolPermanente || null,
            rolTemporal: req.authz?.rolTemporal || null,
            arquetipo: req.authz?.arquetipo || user.arquetipo || user.cargo,
            cargo: req.authz?.arquetipo || user.arquetipo || user.cargo,
            permisos: req.authz?.permisos || [],
        });
    } catch (error) {
        console.error('Error al obtener sesión:', error.message);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

const fotoTrabajador = async (req, res) => {
    try {
        const trabajador = await TrabajadorModel.findOne({ Rut: { $eq: getAuthRut(req) } });
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
        res.status(201).json({
            message: 'Foto de perfil actualizada correctamente',
            perfil: sanitizeWorkerForClient(trabajador).perfil,
        });
    } catch (error) {
        console.error('Error al actualizar foto de trabajador:', error.message);
        res.status(500).send('Error interno del servidor');
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
  


module.exports = {obtenerRegionChile,creartrabajador, modificardatostrabajador, eliminartrabajador, login, listarTrabajadores,obtenerTrabajador, updatePushToken,listarTrabajadoresConectados,seguimientoUbicaciones,datosTrabajador, datosApp,obtenerSesion,fotoTrabajador};
