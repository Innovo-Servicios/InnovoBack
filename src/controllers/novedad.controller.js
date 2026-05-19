const mongoose = require('mongoose');
// const {lectura_MongooseModel} = require('../models/lectura.model.js')
const { sector_MongooseModel: Sector } = require('../models/sector.model.js')
const { Novedad } = require('../models/novedad.model.js')
const { TipoNovedad } = require('../models/tipoNovedad.model.js')
const { medidor_MongooseModel } = require('../models/medidor.model.js')
const { direccion_MongooseModel } = require('../models/direccion.model.js')
const { ruta_MongooseModel } = require('../models/ruta.model.js')
const {tipoDocumento_MongooseModel} = require('../models/tipoDocumento.model.js');
const {trabajador_MongooseModel} = require('../models/trabajador.model.js');
const {cliente_MongooseModel} = require('../models/cliente.model.js');
const dayjs = require('dayjs');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { buildAssetUrl, getAuthRut, isPrivilegedRequest } = require('../utils/security.js');

const formatNovedadFotografia = (fotografia) => {
    if (!fotografia) return fotografia;
    const stringPath = String(fotografia);
    const normalized = stringPath.toLowerCase();
    if (normalized.includes('verificacion')) {
        return buildAssetUrl('verificaciones', stringPath);
    }
    return buildAssetUrl('novedades', stringPath);
};

const ensureCanAccessNovedad = async (req, novedad) => {
    if (isPrivilegedRequest(req)) {
        return true;
    }
    const trabajador = await trabajador_MongooseModel.findById(novedad.emisor).select('Rut');
    return String(trabajador?.Rut || '').trim() === getAuthRut(req);
};

const borrarNovedad = async (req, res) => {
    try {
        const { idNovedad } = req.body;
        const novedad = await Novedad.findByIdAndDelete(String(idNovedad));
        if (!novedad) {
            return res.status(404).send('Novedad no encontrada.');
        }
        res.status(200).send('Novedad eliminada exitosamente');

    } catch (error) {
        console.error('Error al borrar la novedad:', error.message);
        res.status(500).send('Error interno del servidor');
    }
};

const modificarNovedad = async (req, res) => {
    try {
        const { idNovedad, TipoNovedadConsulta, Fotografia, Lecturacorrecta, comentario } = req.body;
        const novedad = await Novedad.findById(idNovedad);
        if (!novedad) {
            return res.status(404).send('Novedad no encontrada.');
        }
        const Tipoexiste = await TipoNovedad.findOne({ _id: { $eq: String(TipoNovedadConsulta) } });
        novedad.TipoNovedad = Tipoexiste._id;
        novedad.Fotografia = Fotografia;
        novedad.Lecturacorrecta = Lecturacorrecta;
        novedad.comentario = comentario;
        await novedad.save();
        res.status(200).send('Novedad modificada exitosamente');
    } catch (error) {
        console.error('Error al modificar la novedad:', error.message);
        res.status(500).send('Error interno del servidor');
    }
};

const obtenerNovedadUno = async (req, res) => {
    try {
        const { idNovedad } = req.body;
        const novedad = await Novedad.findById(idNovedad);
        if (!novedad) {

            return res.status(404).send('Novedad no encontrada.');
        }
        if (!(await ensureCanAccessNovedad(req, novedad))) {
            return res.status(403).send('Permisos insuficientes');
        }
        const plainNovedad = novedad.toObject();
        plainNovedad.Fotografia = formatNovedadFotografia(plainNovedad.Fotografia);
        res.status(200).send(plainNovedad);
    } catch (error) {
        console.error('Error al obtener la novedad:', error.message);
        res.status(500).send('Error interno del servidor');
    }
};

const obtenerNovedadTodos = async (req, res) => {
    try {
        const novedades = await Novedad.find().lean();
        res.status(200).send(novedades.map((novedad) => ({
            ...novedad,
            Fotografia: formatNovedadFotografia(novedad.Fotografia),
        })));
    } catch (error) {
        console.error('Error al obtener novedades:', error.message);
        res.status(500).send('Error interno del servidor');
    }
};

const crearNovedad = async (req, res) => {      
    try {
            const { TipoNovedadConsulta, idMedidor, Lecturacorrecta, Comentario } = req.body;
            let lecturacorrecta = 0;
            if(Lecturacorrecta){
                lecturacorrecta= Lecturacorrecta;
            }
            
            let finalPath;
            const medidor = await medidor_MongooseModel.findOne({ NumeroMedidor: { $eq: Number(idMedidor) } });
            if (!medidor) {
                return res.status(404).send('Medidor no encontrada.');
            }
            const cliente = await cliente_MongooseModel.findOne({ _id: { $eq: medidor.NumeroCliente } });
            if (!cliente) {
                return res.status(404).send('Cliente no encontrado.');
            }
            const Tipoexiste = await TipoNovedad.findOne({ value: { $eq: String(TipoNovedadConsulta) } });
            if (!Tipoexiste) {
                return res.status(404).send('Tipo de novedad no encontrado.');
            }

            if (req.file){
                const archivo = req.file;
                // console.log(archivo.mimetype)
                const formatosPermitidos = [
                    'image/jpeg',
                    'image/png',
                    'image/jpg',
                ];
                if (!formatosPermitidos.includes(archivo.mimetype)) {
                    return res.status(400).send('Formato de archivo no permitido: ' + archivo.mimetype);
                }
                let uploadPath;
                if (Tipoexiste.value != 'Verificacion') {    
                    // return res.status(400).send('Falta la fotografía de la novedad.');
                    uploadPath = path.join(__dirname, '../../public/images/novedades');
                    if (!fs.existsSync(uploadPath)) {
                        fs.mkdirSync(uploadPath, { recursive: true });
                    }
                }else{
                    uploadPath = path.join(__dirname, '../../public/images/verificaciones');
                    if (!fs.existsSync(uploadPath)) {
                        fs.mkdirSync(uploadPath, { recursive: true });
                    }
                }
    
                const fileName = `CL_${cliente.NumeroCliente}_${Tipoexiste.value}.jpg`;
                if (archivo.mimetype === 'image/jpeg' || archivo.mimetype === 'image/png'|| archivo.mimetype === 'image/jpg') {
                    // Procesar imágenes en memoria con sharp
                    finalPath = path.join(uploadPath, path.basename(fileName)); // Renombrar extensión a .jpeg
    
                    await sharp(archivo.buffer)
                        .resize(1024, 1024, { fit: 'inside' }) // Redimensiona manteniendo proporción
                        .toFormat('jpeg', { quality: 80 }) // Convierte a JPEG con calidad 80%
                        .toFile(finalPath);
                } else {
                    // Guardar otros tipos de archivos directamente desde el buffer
                    finalPath = path.join(uploadPath, path.basename(fileName));
                    fs.writeFileSync(finalPath, archivo.buffer);
                }
            }

            const direccion = await direccion_MongooseModel.findOne({ NumeroMedidor: { $eq: medidor._id } })
            if (!direccion) {
                return res.status(404).send('Dirección no encontrada.');
            }
            const emisor = await trabajador_MongooseModel.findOne({ Rut: { $eq: getAuthRut(req) } });
            const nuevaNovedad = new Novedad({
                TipoNovedad: Tipoexiste._id,
                emisor: emisor._id,
                Fotografia: finalPath,
                Lecturacorrecta:lecturacorrecta,
                Comentario,
                direccion: direccion._id,
                Fecha: new Date()
            });
            await nuevaNovedad.save();
            req.io.emit('actualizarNovedad', nuevaNovedad);
            res.status(201).json({
                mensaje: 'Novedad creada exitosamente',
                novedadId: nuevaNovedad._id
            });
    } catch (error) {
        console.error('Error al crear la novedad:', error.message);
        res.status(500).send('Error interno del servidor');
    }
    
};

const hacernovedad = async (req, res) => {
        const { Ruta, Fecha } = req.body; //¿Que pasa si la ruta se termina al dia siguiente? arreglar lo de la fecha
        try {
            const fechaconsulta = dayjs(Fecha); // No aplicar .format aquí

            const inicioDelMes = fechaconsulta.startOf('month').toDate();
            const finDelMes = fechaconsulta.endOf('month').toDate();
            const ruta = await ruta_MongooseModel.findOne({ NumeroRuta: { $eq: Number(Ruta) } });
            if (!ruta) {
                return res.status(404).send('Ruta no encontrada.');
            }

            const sectores = await Sector.find({ NumeroRuta: ruta._id });
            if (!sectores || sectores.length === 0) {
                return res.status(404).send('No se encontraron sectores para esta ruta');
            }

            const sectorIds = sectores.map(sector => sector._id);
            const direcciones = await direccion_MongooseModel.find({ NumeroSector: { $in: sectorIds } });
            if (!direcciones || direcciones.length === 0) {
                return res.status(404).send('No se encontraron direcciones para los sectores de la ruta');
            }
            const direccionIds = direcciones.map(direccion => direccion._id);

            const novedades = await Novedad.find({
                Fecha: {
                    $gte: inicioDelMes,
                    $lt: finDelMes
                },
                direccion: {
                    $in: direccionIds
                }
            });

            res.status(200).send(novedades.map((novedad) => ({
                ...novedad.toObject(),
                Fotografia: formatNovedadFotografia(novedad.Fotografia),
            })));



        } catch (error) {
            console.error('Error al obtener novedades de ruta:', error.message);
            res.status(500).send('Error interno del servidor');
        }
}

const obtenerUltimasNovedadesDelDia = async (req, res) => {
    try {
        const { inicio, fin} = req.body;

            const fechainicio = dayjs(inicio).startOf('day').subtract(3,'hours').toDate();
            const fechafin = dayjs(fin).endOf('day').subtract(3,'hours').toDate();
            const novedadesList = await Novedad.find({
                Fecha: {
                    $gte: fechainicio,
                    $lt: fechafin
                }
            }).sort({ Fecha: -1 });
            const novedades = await Promise.all(novedadesList.map(async (novedad) => {
                const direccion = await direccion_MongooseModel.findById(novedad.direccion);
                const trabajador = await trabajador_MongooseModel.findById(novedad.emisor);
                return {
                    id: novedad._id,
                    TipoNovedad: novedad.TipoNovedad,
                    Fotografia: formatNovedadFotografia(novedad.Fotografia),
                    Lecturacorrecta: novedad.Lecturacorrecta,
                    Comentario: novedad.Comentario,
                    Fecha: novedad.Fecha,
                    direccion: direccion ? direccion.calle : null,
                    coordenadas: direccion ? [direccion.LAT, direccion.LNG] : null,
                    emisor: trabajador ? {
                        Rut: trabajador.Rut,
                        _id: trabajador._id,
                        nombre: trabajador.Nombre,
                        cargo: trabajador.cargo,
                        correo: trabajador.correo,
                    } : null
                };
            }));
            res.status(200).send(novedades);
    } catch (error) {
        console.error('Error al obtener las últimas novedades del día:', error.message);
        res.status(500).send('Error interno del servidor');
    }
};
module.exports = {
    crearNovedad,
    hacernovedad,
    obtenerNovedadUno,
    modificarNovedad,
    borrarNovedad,
    obtenerNovedadTodos,
    obtenerUltimasNovedadesDelDia
};
