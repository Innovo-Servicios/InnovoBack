const mongoose = require('mongoose');
const { medidor_MongooseModel: MEDIDOR } = require('../models/medidor.model.js');
const { asignacion_MongooseModel: Asignacion } = require('../models/asignacion.model.js');
const { direccion_MongooseModel: DIRECCION } = require('../models/direccion.model.js');
const { sector_MongooseModel: SECTOR } = require('../models/sector.model.js');
const Token = require('../controllers/token.controller.js');
const { ate_MongooseModel } = require('../models/ATE.model.js');
const { trabajador_MongooseModel } = require('../models/trabajador.model.js');
const { TipoNovedad } = require('../models/tipoNovedad.model.js');
const { documentos_MongooseModel } = require('../models/documentos.model.js');
const {cliente_MongooseModel: CLIENTE} = require('../models/cliente.model.js');
const dayjs = require('dayjs');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const moment = require('moment-timezone');
const { tipoDocumento_MongooseModel } = require('../models/tipoDocumento.model.js');
const asignacionATE = async (req, res) => {
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid) {
        try {
            const { Direccion, fecha, texto, tipo } = req.body;
            const fechaconsulta = dayjs(fecha).utc(); // No aplicar .format aquí
            const fechaConsultaConHoraCero = fechaconsulta.startOf('day');
            const fechaFin = dayjs(fecha).endOf('day').toDate();
            const Tnovedad = await TipoNovedad.findOne({ value: { $eq: String(tipo) } });
            const direccionexistente = await DIRECCION.findOne({ _id: { $eq: String(Direccion) } }).lean();
            if (!direccionexistente) {
                return res.status(404).send('Dirección no encontrada.');
            }

            const asignaciones = await Asignacion.findOne({
                NumeroSector: { $eq: direccionexistente.NumeroSector },
                fecha_asignacion: {
                    $gte: fechaConsultaConHoraCero,
                    $lt: fechaFin
                }
            }).lean();

            let trabajadorId = null;
            if (asignaciones) {
                const trabajador = await trabajador_MongooseModel.findOne({ _id: { $eq: asignaciones.Trabajador } }).lean();
                if (trabajador) trabajadorId = trabajador._id;
            }

            const ate = new ate_MongooseModel({
                comentario: texto,
                tipo: Tnovedad._id,
                fecha_ate: fechaConsultaConHoraCero,
                ...(trabajadorId && { Trabajador: trabajadorId }),
                direccion: direccionexistente._id
            })
            await ate.save();

            res.status(200).send('Notificaciones creadas para todas las asignaciones.');
        } catch (error) {
            res.status(500).send('Error interno del servidor: ' + error.message);
        }
    } else {
        res.status(401).send('Token inválido');
    }
};
const obtenerATE = async (req, res) => {
    try {
        const { token } = req.body;
        const tokenValido = await Token.validartoken(token);
        if (tokenValido.valid) {
            const { fecha } = req.body;
            let dia = dayjs(fecha).format('YYYY-MM-DD');
            const fechaInicio = dayjs(dia).subtract(1, 'day').startOf('day').toDate();
            const fechaFin = dayjs(dia).endOf('day').toDate();
            // console.log(dia,fechaInicio,fechaFin);
            const trabajador = await trabajador_MongooseModel.findOne({ Rut: { $eq: String(tokenValido.token.rut) } }).lean();
            if (!trabajador) {
                return res.status(404).send('Trabajador no encontrado.');
            }

            const asignaciones = await ate_MongooseModel.find({
                fecha_ate: {
                    $gte: fechaInicio,
                    $lte: fechaFin
                },
                estado: { $ne: true },
                Trabajador: trabajador._id
            }).lean();
            const resultado = await Promise.all(asignaciones.map(async (asignacion) => {
                const direccion = await DIRECCION.findById(asignacion.direccion);
                const medidor = await MEDIDOR.findOne({ _id: { $eq: direccion.NumeroMedidor } });
                const sector = await SECTOR.findById(direccion.NumeroSector);
                const tipo = await TipoNovedad.findById(asignacion.tipo);
                return {
                    "id_ate": asignacion._id,
                    "lat": direccion.LAT,
                    "lng": direccion.LNG,
                    "direccion": direccion.calle,
                    "numeroMedidor": medidor.NumeroMedidor,
                    "sector": (sector.sector).split(" ")[0],
                    "tipo": tipo.value,
                    "comentario": asignacion.comentario,
                };
            }));
            res.status(200).send(resultado);
        }
        else {
            res.status(401).send('Token inválido');
        }

    } catch (error) {
        res.status(500).send('Error interno del servidor: ' + error.message);
    }
}
const obtenerATE_Adm = async (req, res) => {
    try {
        const { token } = req.body;
        const tokenValido = await Token.validartoken(token);
        if (!tokenValido.valid) {
            return res.status(401).send('Token inválido');
        }
        let ates;
        if (req.body.fecha) {
            const fechainicio = dayjs(req.body.fecha.inicio).startOf('day').subtract(3,'hours').toDate();
            const fechafin = dayjs(req.body.fecha.fin).endOf('day').toDate();
            console.log('Fechas:', fechainicio, fechafin);
            ates = await ate_MongooseModel.find({
                fecha_ate: {
                    $gte: fechainicio,
                    $lte: fechafin
                }
            }).sort({ fecha_ate: 1 }).lean();
        }else{
            ates = await ate_MongooseModel.find({}).sort({ fecha_ate: 1 }).lean();
        }
        // Obtén todas las ATES y ordénalas directamente en la consulta
        if (!ates.length) {
            return res.status(404).send('No se encontraron ATES.');
        }

        const ateData = await Promise.all(ates.map(async (asignacion) => {
            // Ejecuta las consultas en paralelo para optimizar la ejecución
            const [direccion, tipo, trabajador, foto] = await Promise.all([
                DIRECCION.findById(asignacion.direccion),
                TipoNovedad.findById(asignacion.tipo),
                trabajador_MongooseModel.findById(asignacion.Trabajador),
                asignacion.fotografia ? documentos_MongooseModel.findById(asignacion.fotografia) : Promise.resolve(null)
            ]);

            return {
                id: asignacion._id,
                comentario: asignacion.comentario,
                tipo: tipo ? { _id: tipo._id, nombre: tipo.value } : null,
                direccion: direccion ? { _id: direccion._id, nombre: direccion.calle } : null,
                Trabajador: trabajador ? { _id: trabajador._id, nombre: trabajador.Nombre } : null,
                fecha_ate: moment(asignacion.fecha_ate),
                estado: asignacion.estado,
                ...(asignacion.fotografia && foto ? { fotografia: `IMG_ATES/${foto.url.split('/').pop()}` } : {})
            };
        }));

        res.status(200).send({
            fecha: moment(ates[0].fecha_ate),
            ate: ateData
        });
    } catch (error) {
        res.status(500).send('Error interno del servidor: ' + error.message);
    }
}
const repsuestaATE = async (req, res) => {
    const { token, id_ate, tipo } = req.body;
    const tokenValido = await Token.validartoken(token);
    try {
        if (!tokenValido.valid) {
            return res.status(401).send("Token inválido");
        }


        if (!req.file) {
            console.log('No se ha subido ningún archivo');
            return res.status(400).send('No se ha subido ningún archivo');
        }

        const resTipo = await tipoDocumento_MongooseModel.findOne({ value: { $eq: String(tipo) } });
        if (!resTipo) {
            console.log('Tipo de documento no encontrado');
            return res.status(400).send('Tipo de documento no encontrado');
        }

        const archivo = req.file;
        const formatosPermitidos = [
            'image/jpeg',
            'image/png',
            'image/jpg',
        ];
        
        if (!formatosPermitidos.includes(archivo.mimetype)) {
            return res.status(400).send('Formato de archivo no permitido: ' + archivo.mimetype);
        }

        // Ruta donde se guardarán los archivos procesados
        const uploadPath = path.join(__dirname, '../../public/images/ates');
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        const ate = await ate_MongooseModel.findById(id_ate);
        if (!ate) {
            return res.status(404).send('ATE no encontrada');
        }

        const direccion = await DIRECCION.findById(ate.direccion);
        if (!direccion) {
            return res.status(404).send('Dirección no encontrada');
        }

        const medidor = await MEDIDOR.findOne({ _id: { $eq: direccion.NumeroMedidor } });
        if (!medidor) {
            return res.status(404).send('Medidor no encontrado');
        }

        const cliente = await CLIENTE.findOne({ _id: { $eq: medidor.NumeroCliente } });
        if (!cliente) {
            return res.status(404).send('Cliente no encontrado');
        }


        let finalPath;
        const fileName = `CL_${cliente.NumeroCliente}.jpg`;

        if (archivo.mimetype === 'image/jpeg' || archivo.mimetype === 'image/png'|| archivo.mimetype === 'image/jpg') {
            // Procesar imágenes en memoria con sharp
            finalPath = path.join(uploadPath, path.basename(fileName)); // Renombrar extensión a .jpeg
            await sharp(archivo.buffer)
                .resize(1024, 1024, { fit: 'inside' }) // Redimensiona manteniendo proporción
                .toFormat('jpeg', { quality: 80 }) // Convierte a JPEG con calidad 80%
                .toFile(finalPath);
        } else {
            // Guardar otros tipos de archivos directamente desde el buffer
            const sanitizedFileName = fileName.replace(/\s+/g, '_');
            finalPath = path.join(uploadPath, sanitizedFileName);
            fs.writeFileSync(finalPath, archivo.buffer);
        }


        // Crear el documento en la base de datos
        const nuevoDocumento = new documentos_MongooseModel({
            _id: new mongoose.Types.ObjectId(),
            tipo: resTipo._id,
            url: finalPath, // Ruta del archivo guardado (procesado si es imagen)
            formato: archivo.mimetype,
            fecha: moment().tz('America/Santiago'),
        });


        await nuevoDocumento.save().then((doc) => {
            console.log('Documento creado correctamente:', doc);
        }
        ).catch((error) => {
            console.error('Error al crear el documento:', error);
            res.status(500).send('Error interno del servidor: ' + error.message);
        });
        // Asociar el documento a la ate
        ate.fotografia = nuevoDocumento._id;
        ate.estado = true;
        ate.respuesta = moment().tz('America/Santiago');    
        await ate.save();
        req.io.emit('nuevaAte', {});
        res.status(201).send('Documento creado correctamente');
    } catch (error) {
        console.error('Error al crear el documento:', error);
        res.status(500).send('Error interno del servidor: ' + error.message);
    }
};




const editarATE = async (req, res) => {
    const { token, id_ate, Trabajador } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (!tokenValido.valid) return res.status(401).send('Token inválido');
    try {
        const ate = await ate_MongooseModel.findByIdAndUpdate(
            id_ate,
            { Trabajador },
            { new: true }
        );
        if (!ate) return res.status(404).send('ATE no encontrada');
        res.status(200).send('ATE actualizada correctamente');
    } catch (error) {
        res.status(500).send('Error interno: ' + error.message);
    }
};

module.exports = { asignacionATE, obtenerATE, repsuestaATE, obtenerATE_Adm, editarATE };