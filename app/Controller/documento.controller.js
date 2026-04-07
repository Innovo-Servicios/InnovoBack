const mongoose = require('mongoose');
const Token = require('../Controller/token.Controller.js')
const { documentos_MongooseModel } = require('../Model/documentos_Mongoose.js');
const { trabajador_MongooseModel } = require('../Model/trabajador_Mongoose.js')
const { tipoDocumento_MongooseModel } = require('../Model/tipoDocumento_Mongoose.js')
const moment = require('moment-timezone');
const fs = require('fs');
const sharp = require('sharp');
const path = require('path');

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

    // Extract only the filename to prevent directory traversal
    const safeFileName = path.basename(String(normalizedPath));
    const resolvedPath = path.join(trabajadoresBasePath, safeFileName);
    if (!resolvedPath.startsWith(`${trabajadoresBasePath}${path.sep}`)) {
        return null;
    }

    return resolvedPath;
};

const crearDocumento = async (req, res) => {
    const { token, tipo, objetivo } = req.body;
    // console.log(req.body);
    const tokenValido = await Token.validartoken(token);
    if (!tokenValido.valid) {
        return res.status(401).send('Token inválido');
    }

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
        // console.error('Error al crear el documento:', error);
        return res.status(500).send('Error interno del servidor: ' + error.message);
    }
};


const obtenerDocumentos = async (req, res) => {
    const { rut, token, formato } = req.body;
    const tokenValido = await Token.validartoken(token);

    if (!tokenValido.valid) {
        return res.status(401).send('Token inválido');
    }

    try {
        const rutTrabajador = normalizeRequiredString(rut);
        const formatoNormalizado = normalizeOptionalString(formato);
        if (!rutTrabajador || !formatoNormalizado.valid) {
            return res.status(400).send('Datos de búsqueda inválidos');
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
        return res.send(documentos);
    } catch (error) {
        return res.status(500).send('Error interno del servidor: ' + error.message);
    }
};

const eliminarDocumentos = async (req, res) => {
    const { rut, token, id } = req.body;
    const tokenValido = await Token.validartoken(token);

    if (!tokenValido.valid) {
        return res.status(401).send('Token inválido');
    }

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
        return res.status(500).send('Error interno del servidor: ' + error.message);
    }
};

const listarDocumentos = async (req, res) => {
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);

    if (!tokenValido.valid) {
        return res.status(401).send('Token inválido');
    }

    try {
        const rutTrabajador = normalizeRequiredString(tokenValido.token?.rut);
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

        return res.send(datos);
    } catch (error) {
        return res.status(500).send('Error interno del servidor: ' + error.message);
    }
}

const deleteDocumento= async(req,res)=>{
    const {token, id, rut}=req.body
    const tokenValido = await Token.validartoken(token);
    if (!tokenValido.valid) {
        return res.status(401).send('Token inválido');
    }
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
        return res.status(500).send('Error interno del servidor: ' + error.message);
    }
}

module.exports = { crearDocumento, obtenerDocumentos, eliminarDocumentos,listarDocumentos,deleteDocumento };
