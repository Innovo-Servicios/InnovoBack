const mongoose = require('mongoose');
const { medidor_MongooseModel: MEDIDOR } = require('../models/medidor.model.js');
const { asignacion_MongooseModel: Asignacion } = require('../models/asignacion.model.js');
const { direccion_MongooseModel: DIRECCION } = require('../models/direccion.model.js');
const { sector_MongooseModel: SECTOR } = require('../models/sector.model.js');
const { ruta_MongooseModel: RUTA } = require('../models/ruta.model.js');
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
const { buildAssetUrl, getAuthRut, isPrivilegedRequest } = require('../utils/security.js');
const { scheduleAteWhatsappNotification } = require('../utils/ateWhatsappNotification.js');

const ATE_TIMEZONE = 'America/Santiago';

const normalizeAteType = (value) =>
    String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();

const isAteLecturaType = (value) =>
    normalizeAteType(value) === normalizeAteType('Atención Especial-Lectura');

const parseLecturaCorrecta = (value) => {
    if (value === undefined || value === null || String(value).trim() === '') {
        return null;
    }

    const lectura = Number(value);
    return Number.isFinite(lectura) ? lectura : Number.NaN;
};

const resolveAteContext = async (direccion) => {
    const sector = direccion?.NumeroSector
        ? await SECTOR.findById(direccion.NumeroSector).lean()
        : null;
    const ruta = sector?.NumeroRuta
        ? await RUTA.findById(sector.NumeroRuta).lean()
        : null;

    return { sector, ruta };
};

const formatAteContext = ({ sector, ruta }) => ({
    sector: sector?.NumeroSector ?? null,
    ruta: ruta?.NumeroRuta ?? null,
});

const buildAteResponse = ({ ate, direccion, tipo, trabajador, foto, sector, ruta }) => ({
    id: ate._id,
    comentario: ate.comentario,
    tipo: tipo ? { _id: tipo._id, nombre: tipo.value } : null,
    direccion: direccion ? { _id: direccion._id, nombre: direccion.calle, lat: direccion.LAT, lng: direccion.LNG } : null,
    ...formatAteContext({ sector, ruta }),
    Trabajador: trabajador ? { _id: trabajador._id, nombre: trabajador.Nombre } : null,
    fecha_ate: moment(ate.fecha_ate),
    estado: ate.estado,
    respuestaComentario: ate.respuestaComentario || null,
    Lecturacorrecta: ate.Lecturacorrecta ?? null,
    ...(ate.fotografia && foto ? { fotografia: buildAssetUrl('ate', foto.url) } : {})
});

const buildObtenerAtePendientesQuery = ({ trabajadorId, fechaFin }) => ({
    fecha_ate: {
        $lte: fechaFin
    },
    estado: { $ne: true },
    Trabajador: trabajadorId
});

const isAteAtrasada = (fechaAte, referenceDate = new Date()) => {
    if (!fechaAte) {
        return false;
    }

    return moment(fechaAte)
        .tz(ATE_TIMEZONE)
        .isBefore(moment(referenceDate).tz(ATE_TIMEZONE).startOf('day'), 'day');
};

const asignacionATE = async (req, res) => {
    if (req.authUser) {
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
            console.error('Error al asignar ATE:', error.message);
            res.status(500).send('Error interno del servidor');
        }
    } else {
        res.status(401).send('Token inválido');
    }
};
const obtenerATE = async (req, res) => {
    try {
        if (req.authUser) {
            const { fecha } = req.body;
            const fechaReferencia = fecha
                ? moment.tz(fecha, ATE_TIMEZONE)
                : moment().tz(ATE_TIMEZONE);
            if (!fechaReferencia.isValid()) {
                return res.status(400).send('Fecha inválida');
            }

            const fechaFin = fechaReferencia.clone().endOf('day').toDate();
            const inicioHoy = moment().tz(ATE_TIMEZONE).startOf('day');
            const trabajador = await trabajador_MongooseModel.findOne({ Rut: { $eq: getAuthRut(req) } }).lean();
            if (!trabajador) {
                return res.status(404).send('Trabajador no encontrado.');
            }

            const asignaciones = await ate_MongooseModel
                .find(buildObtenerAtePendientesQuery({
                    trabajadorId: trabajador._id,
                    fechaFin,
                }))
                .sort({ fecha_ate: 1 })
                .lean();
            const resultado = (await Promise.all(asignaciones.map(async (asignacion) => {
                const direccion = await DIRECCION.findById(asignacion.direccion).lean();
                if (!direccion) {
                    return null;
                }

                const [medidor, sector, tipo] = await Promise.all([
                    direccion.NumeroMedidor ? MEDIDOR.findById(direccion.NumeroMedidor).lean() : Promise.resolve(null),
                    direccion.NumeroSector ? SECTOR.findById(direccion.NumeroSector).lean() : Promise.resolve(null),
                    asignacion.tipo ? TipoNovedad.findById(asignacion.tipo).lean() : Promise.resolve(null),
                ]);

                return {
                    "id_ate": asignacion._id,
                    "lat": direccion.LAT,
                    "lng": direccion.LNG,
                    "direccion": direccion.calle,
                    "numeroMedidor": medidor?.NumeroMedidor ?? null,
                    "sector": sector?.sector ? sector.sector.split(" ")[0] : null,
                    "tipo": tipo?.value ?? null,
                    "comentario": asignacion.comentario,
                    "fecha_ate": asignacion.fecha_ate,
                    "atrasada": isAteAtrasada(asignacion.fecha_ate, inicioHoy.toDate()),
                };
            }))).filter(Boolean);
            res.status(200).send(resultado);
        }
        else {
            res.status(401).send('Token inválido');
        }

    } catch (error) {
        console.error('Error al obtener ATE:', error.message);
        res.status(500).send('Error interno del servidor');
    }
}
const obtenerATE_Adm = async (req, res) => {
    try {
        let ates;
        if (req.body.fecha) {
            const fechainicio = moment.utc(req.body.fecha.inicio).startOf('day').toDate();
            const fechafin = moment.utc(req.body.fecha.fin).endOf('day').toDate();
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
            return res.status(200).send({ ate: [] });
        }

        const ateData = await Promise.all(ates.map(async (asignacion) => {
            // Ejecuta las consultas en paralelo para optimizar la ejecución
            const [direccion, tipo, trabajador, foto] = await Promise.all([
                asignacion.direccion ? DIRECCION.findById(asignacion.direccion).lean() : Promise.resolve(null),
                asignacion.tipo ? TipoNovedad.findById(asignacion.tipo).lean() : Promise.resolve(null),
                asignacion.Trabajador ? trabajador_MongooseModel.findById(asignacion.Trabajador).lean() : Promise.resolve(null),
                asignacion.fotografia ? documentos_MongooseModel.findById(asignacion.fotografia) : Promise.resolve(null)
            ]);
            const ateContext = await resolveAteContext(direccion);

            return buildAteResponse({
                ate: asignacion,
                direccion,
                tipo,
                trabajador,
                foto,
                sector: ateContext.sector,
                ruta: ateContext.ruta,
            });
        }));

        res.status(200).send({
            fecha: moment(ates[0].fecha_ate),
            ate: ateData
        });
    } catch (error) {
        console.error('Error al obtener ATE admin:', error.message);
        res.status(500).send('Error interno del servidor');
    }
}
const repsuestaATE = async (req, res) => {
    const { id_ate, tipo } = req.body;
    try {
        if (!req.file) {
            return res.status(400).send('No se ha subido ningún archivo');
        }

        const resTipo = await tipoDocumento_MongooseModel.findOne({ value: { $eq: String(tipo) } });
        if (!resTipo) {
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
        const wasAteAlreadyCompleted = ate.estado === true;
        if (!isPrivilegedRequest(req)) {
            const trabajadorAsignado = ate.Trabajador
                ? await trabajador_MongooseModel.findById(ate.Trabajador).select('Rut')
                : null;
            if (String(trabajadorAsignado?.Rut || '').trim() !== getAuthRut(req)) {
                return res.status(403).send('Permisos insuficientes');
            }
        }

        const tipoAte = await TipoNovedad.findById(ate.tipo).lean();
        const isAteLectura = isAteLecturaType(tipoAte?.value || tipo);
        const lecturaCorrecta = parseLecturaCorrecta(req.body.Lecturacorrecta);
        if (isAteLectura && Number.isNaN(lecturaCorrecta)) {
            return res.status(400).send('Lectura correcta inválida');
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


        await nuevoDocumento.save();
        // Asociar el documento a la ate
        ate.fotografia = nuevoDocumento._id;
        ate.estado = true;
        ate.respuesta = moment().tz('America/Santiago');
        if (req.body.comentario) ate.respuestaComentario = req.body.comentario;
        ate.Lecturacorrecta = isAteLectura ? lecturaCorrecta : null;
        await ate.save();
        if (!wasAteAlreadyCompleted) {
            scheduleAteWhatsappNotification(ate._id);
        }
        req.io.emit('nuevaAte', {});
        res.status(201).send('Documento creado correctamente');
    } catch (error) {
        console.error('Error al crear documento ATE:', error.message);
        res.status(500).send('Error interno del servidor');
    }
};




const editarATE = async (req, res) => {
    const { id_ate, Trabajador } = req.body;
    try {
        const ate = await ate_MongooseModel.findByIdAndUpdate(
            id_ate,
            { Trabajador },
            { new: true }
        );
        if (!ate) return res.status(404).send('ATE no encontrada');
        res.status(200).send('ATE actualizada correctamente');
    } catch (error) {
        console.error('Error al editar ATE:', error.message);
        res.status(500).send('Error interno del servidor');
    }
};

module.exports = {
    asignacionATE,
    obtenerATE,
    repsuestaATE,
    obtenerATE_Adm,
    editarATE,
    buildObtenerAtePendientesQuery,
    isAteAtrasada,
};
