const mongoose = require('mongoose');
const { documentos_MongooseModel } = require('../models/documentos.model.js');
const { trabajador_MongooseModel } = require('../models/trabajador.model.js')
const { tipoDocumento_MongooseModel } = require('../models/tipoDocumento.model.js')
const moment = require('moment-timezone');
const fs = require('fs');
const sharp = require('sharp');
const path = require('path');
const {
    canAccessRut,
    getAuthRut,
    sanitizeDocumentForClient,
} = require('../utils/security.js');

const trabajadoresBasePath = path.resolve(__dirname, '../../../TRABAJADORES');

const normalizeRequiredString = (value) => {
    if (typeof value !== 'string') {
        return null;
    }

    const normalizedValue = value.trim();
    return normalizedValue === '' ? null : normalizedValue;
};

const normalizeOptionalString = (value) => {
    if (value === undefined) {
        return { valid: true, provided: false };
    }

    if (typeof value !== 'string') {
        return { valid: false, provided: true };
    }

    const normalizedValue = value.trim();
    if (normalizedValue === '') {
        return { valid: false, provided: true };
    }

    return { valid: true, provided: true, value: normalizedValue };
};

const normalizeObjectId = (value) => {
    if (!(typeof value === 'string' || value instanceof mongoose.Types.ObjectId)) {
        return null;
    }

    const normalizedValue = String(value).trim();
    if (normalizedValue === '' || !mongoose.isValidObjectId(normalizedValue)) {
        return null;
    }

    return normalizedValue;
};

const resolveSafeWorkerPath = (workerId) => {
    const normalizedWorkerId = normalizeObjectId(workerId);
    if (!normalizedWorkerId) {
        return null;
    }

    // Use path.basename to strip any directory traversal from the input
    const safeComponent = path.basename(String(normalizedWorkerId));
    const resolvedPath = path.join(trabajadoresBasePath, safeComponent);
    if (!resolvedPath.startsWith(`${trabajadoresBasePath}${path.sep}`)) {
        return null;
    }

    return resolvedPath;
};

const resolveSafeDocumentPath = (documentPath) => {
    const normalizedPath = normalizeRequiredString(documentPath);
    if (!normalizedPath) {
        return null;
    }

    const resolvedOriginalPath = path.resolve(normalizedPath);
    if (
        resolvedOriginalPath.startsWith(`${trabajadoresBasePath}${path.sep}`) &&
        fs.existsSync(resolvedOriginalPath)
    ) {
        return resolvedOriginalPath;
    }

    // Extract only the filename to prevent directory traversal
    const safeFileName = path.basename(String(normalizedPath));
    const resolvedPath = path.join(trabajadoresBasePath, safeFileName);
    if (!resolvedPath.startsWith(`${trabajadoresBasePath}${path.sep}`)) {
        return null;
    }

    return resolvedPath;
};

const sanitizeDocument = sanitizeDocumentForClient;

const crearDocumento = async (req, res) => {
    const { tipo, objetivo } = req.body;

    if (!req.file) {
        return res.status(400).send('No se ha subido ningún archivo');
    }

    try {
        const tipoId = normalizeObjectId(tipo);
        const objetivoRut = normalizeRequiredString(objetivo);
        if (!tipoId || !objetivoRut) {
            return res.status(400).send('Datos de documento inválidos');
        }

        const resTipo = await tipoDocumento_MongooseModel.findOne({
            _id: { $eq: new mongoose.Types.ObjectId(tipoId) }
        });
        if (!resTipo) {
            return res.status(400).send('Tipo de documento no encontrado');
        }

        const archivo = req.file;
        const formatosPermitidos = [
            'image/jpeg',
            'image/png',
            'application/pdf',
            'application/msword',
        ];

        if (!formatosPermitidos.includes(archivo.mimetype)) {
            return res.status(400).send('Formato de archivo no permitido: ' + archivo.mimetype);
        }

        const trabajador = await trabajador_MongooseModel.findOne({
            Rut: { $eq: String(objetivoRut) }
        });
        if (!trabajador) {
            return res.status(404).send('Trabajador no encontrado');
        }

        const uploadPath = resolveSafeWorkerPath(trabajador._id);
        if (!uploadPath) {
            return res.status(404).send('Trabajador no encontrado');
        }
        // Ruta donde se guardarán los archivos procesados
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }

        let finalPath;
        // Sanitize the filename stripping any directory components from user-supplied name
        const rawName = `file-${Date.now()}-${archivo.originalname}`;
        const safeFileName = path.basename(rawName).replace(/[^a-zA-Z0-9._-]/g, '_');

        if (archivo.mimetype === 'image/jpeg' || archivo.mimetype === 'image/png') {
            // Procesar imágenes en memoria con sharp
            // Build path exclusively from the trusted uploadPath + safe static filename
            const imageFileName = safeFileName.replace(/\.[^/.]+$/, '.jpeg');
            finalPath = path.join(uploadPath, imageFileName);
        } else {
            // Guardar otros tipos de archivos directamente desde el buffer
            finalPath = path.join(uploadPath, safeFileName);
        }

        // Estricta verificación de no-traversal para el analizador de código
        if (!finalPath.startsWith(uploadPath + path.sep)) {
            throw new Error("Ruta de archivo calculada inválida.");
        }

        if (archivo.mimetype === 'image/jpeg' || archivo.mimetype === 'image/png') {
            await sharp(archivo.buffer)
                .resize(1024, 1024, { fit: 'inside' }) // Redimensiona manteniendo proporción
                .toFormat('jpeg', { quality: 80 }) // Convierte a JPEG con calidad 80%
                .toFile(finalPath);
        } else {
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

        // Asociar el documento al trabajador
        trabajador.documentos.push(new mongoose.Types.ObjectId(nuevoDocumento._id));
        await trabajador.save();

        return res.status(201).send('Documento creado correctamente');
    } catch (error) {
        console.error('Error al crear el documento:', error.message);
        return res.status(500).send('Error interno del servidor');
    }
};


const obtenerDocumentos = async (req, res) => {
    const { rut, formato } = req.body;

    try {
        const rutTrabajador = normalizeRequiredString(rut);
        const formatoNormalizado = normalizeOptionalString(formato);
        if (!rutTrabajador || !formatoNormalizado.valid) {
            return res.status(400).send('Datos de búsqueda inválidos');
        }
        if (!canAccessRut(req, rutTrabajador)) {
            return res.status(403).send('Permisos insuficientes');
        }

        const trabajador = await trabajador_MongooseModel.findOne({
            Rut: { $eq: String(rutTrabajador) }
        });
        if (!trabajador) {
            return res.status(404).send('Trabajador no encontrado');
        }

        // Obtener documentos asociados
        const documentosIds = trabajador.documentos
            .map((documentoId) => normalizeObjectId(documentoId))
            .filter(Boolean)
            .map((documentoId) => new mongoose.Types.ObjectId(documentoId));

        const query = mongoose.sanitizeFilter({ _id: { $in: documentosIds } });
        if (formatoNormalizado.provided) {
            query.formato = formatoNormalizado.value;
        }

        const documentos = await documentos_MongooseModel.find(mongoose.sanitizeFilter(query));
        return res.send(documentos.map((documento) => sanitizeDocument(documento)));
    } catch (error) {
        console.error('Error al obtener documentos:', error.message);
        return res.status(500).send('Error interno del servidor');
    }
};

const eliminarDocumentos = async (req, res) => {
    const { rut, id } = req.body;

    try {
        const rutTrabajador = normalizeRequiredString(rut);
        const documentoId = normalizeObjectId(id);
        if (!rutTrabajador || !documentoId) {
            return res.status(404).send('Documento no encontrado');
        }

        const trabajador = await trabajador_MongooseModel.findOne({
            Rut: { $eq: String(rutTrabajador) }
        });
        if (!trabajador) {
            return res.status(404).send('Trabajador no encontrado');
        }

        const documento = await documentos_MongooseModel.findOne(
            mongoose.sanitizeFilter({ _id: new mongoose.Types.ObjectId(documentoId) })
        );
        if (!documento) {
            return res.status(404).send('Documento no encontrado');
        }

        const documentoPath = resolveSafeDocumentPath(documento.url);
        if (!documentoPath || !fs.existsSync(documentoPath)) {
            return res.status(404).send('Documento no encontrado');
        }

        // Eliminar archivo físico
        fs.unlinkSync(documentoPath);

        // Eliminar documento de la base de datos y del trabajador
        trabajador.documentos.pull(new mongoose.Types.ObjectId(documentoId));
        await trabajador.save();
        await documento.deleteOne();

        return res.send('Documento eliminado correctamente');
    } catch (error) {
        console.error('Error al eliminar documentos:', error.message);
        return res.status(500).send('Error interno del servidor');
    }
};

const listarDocumentos = async (req, res) => {
    try {
        const rutTrabajador = normalizeRequiredString(getAuthRut(req));
        if (!rutTrabajador) {
            return res.status(404).send('Trabajador no encontrado');
        }

        const documentos = await trabajador_MongooseModel.findOne({
            Rut: { $eq: String(rutTrabajador) }
        }).select('documentos');
        if (!documentos) {
            return res.status(404).send('Trabajador no encontrado');
        }

        const documentosIds = documentos.documentos
            .map((documentoId) => normalizeObjectId(documentoId))
            .filter(Boolean)
            .map((documentoId) => new mongoose.Types.ObjectId(documentoId));

        const datos= await documentos_MongooseModel.find(
            mongoose.sanitizeFilter({ _id: { $in: documentosIds } })
        ).populate({
            path:'tipo',
            select:'value'
        });

        return res.send(datos.map((documento) => sanitizeDocument(documento)));
    } catch (error) {
        console.error('Error al listar documentos:', error.message);
        return res.status(500).send('Error interno del servidor');
    }
}

const descargarDocumento = async (req, res) => {
    const documentId = normalizeObjectId(req.params.id);
    if (!documentId) {
        return res.status(400).send('Documento inválido');
    }

    try {
        const documento = await documentos_MongooseModel.findById(documentId);
        if (!documento) {
            return res.status(404).send('Documento no encontrado');
        }

        const trabajador = await trabajador_MongooseModel.findOne({
            documentos: { $in: [new mongoose.Types.ObjectId(documentId)] },
        });

        if (!trabajador) {
            return res.status(404).send('Documento no encontrado');
        }

        const requesterRole = String(req.authUser?.cargo || '').trim().toLowerCase();
        const requesterRut = String(req.authUser?.Rut || req.auth?.rut || '').trim();
        const canAccessForeignDocument = ['administracion', 'supervisor'].includes(requesterRole);

        if (!canAccessForeignDocument && requesterRut !== String(trabajador.Rut)) {
            return res.status(403).send('Permisos insuficientes');
        }

        const documentPath = resolveSafeDocumentPath(documento.url);
        if (!documentPath || !fs.existsSync(documentPath)) {
            return res.status(404).send('Documento no encontrado');
        }

        return res.download(documentPath, path.basename(documentPath));
    } catch (error) {
        return res.status(500).send('Error interno del servidor');
    }
};

const deleteDocumento= async(req,res)=>{
    const { id, rut}=req.body
    try{
        const documentoId = normalizeObjectId(id);
        const rutTrabajador = normalizeRequiredString(rut);
        if (!documentoId || !rutTrabajador) {
            return res.status(404).send('Documento no encontrado');
        }

        const documento = await documentos_MongooseModel.findOne(
            mongoose.sanitizeFilter({ _id: new mongoose.Types.ObjectId(documentoId) })
        );
        if (!documento) {
            return res.status(404).send('Documento no encontrado');
        }

        const documentoPath = resolveSafeDocumentPath(documento.url);
        if (!documentoPath || !fs.existsSync(documentoPath)) {
            return res.status(404).send('Documento no encontrado');
        }

        // Eliminar archivo físico
        fs.unlinkSync(documentoPath);

        // Eliminar documento de la base de datos y del trabajador
        await documento.deleteOne();
        const trabajador= await trabajador_MongooseModel.findOne({
            Rut: { $eq: String(rutTrabajador) }
        });
        if (!trabajador) {
            return res.status(404).send('Trabajador no encontrado');
        }

        trabajador.documentos.pull(new mongoose.Types.ObjectId(documentoId));
        await trabajador.save();
        
        return res.status(201).send('Documento eliminado correctamente');
    }catch(error){
        console.error('Error al borrar documento:', error.message);
        return res.status(500).send('Error interno del servidor');
    }
}

module.exports = { crearDocumento, obtenerDocumentos, eliminarDocumentos,listarDocumentos,deleteDocumento, descargarDocumento };
