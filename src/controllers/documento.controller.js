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
const IMAGE_DOCUMENT_MIME_TYPES = new Set(['image/jpeg', 'image/png']);
const WORKER_DOCUMENT_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
]);

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

const isAllowedWorkerDocument = (file) =>
    Boolean(file?.mimetype && WORKER_DOCUMENT_MIME_TYPES.has(file.mimetype));

const isImageWorkerDocument = (file) => IMAGE_DOCUMENT_MIME_TYPES.has(file?.mimetype);

const buildSafeDocumentFileName = ({ documentId, file, timestamp = Date.now() }) => {
    const originalName = path.basename(String(file?.originalname || 'documento'));
    const rawName = `file-${timestamp}-${documentId}-${originalName}`;
    const safeFileName = path.basename(rawName).replace(/[^a-zA-Z0-9._-]/g, '_');

    return isImageWorkerDocument(file)
        ? safeFileName.replace(/\.[^/.]+$/, '.jpeg')
        : safeFileName;
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

const writeWorkerDocumentFile = async ({
    file,
    finalPath,
    sharpFactory = sharp,
    fsModule = fs,
}) => {
    if (isImageWorkerDocument(file)) {
        await sharpFactory(file.buffer)
            .resize(1024, 1024, { fit: 'inside' })
            .toFormat('jpeg', { quality: 80 })
            .toFile(finalPath);
        return;
    }

    await fsModule.promises.writeFile(finalPath, file.buffer);
};

const createDocumentForWorker = async ({
    worker,
    tipoId,
    file,
    objectIdFactory = () => new mongoose.Types.ObjectId(),
    documentFactory = (payload) => new documentos_MongooseModel(payload),
    writeFile = writeWorkerDocumentFile,
    fsModule = fs,
    now = () => moment().tz('America/Santiago'),
}) => {
    const documentId = objectIdFactory();
    const uploadPath = resolveSafeWorkerPath(worker?._id);
    if (!uploadPath) {
        throw new Error('Trabajador inválido');
    }

    if (!fsModule.existsSync(uploadPath)) {
        fsModule.mkdirSync(uploadPath, { recursive: true });
    }

    const fileName = buildSafeDocumentFileName({
        documentId,
        file,
    });
    const finalPath = path.join(uploadPath, fileName);

    if (!finalPath.startsWith(uploadPath + path.sep)) {
        throw new Error('Ruta de archivo calculada inválida.');
    }

    let documentCreated = null;
    try {
        await writeFile({ file, finalPath });

        documentCreated = documentFactory({
            _id: documentId,
            tipo: tipoId,
            nombreOriginal: path.basename(String(file.originalname || 'documento')),
            url: finalPath,
            formato: file.mimetype,
            fecha: now(),
        });

        await documentCreated.save();

        if (!Array.isArray(worker.documentos)) {
            worker.documentos = [];
        }
        worker.documentos.push(new mongoose.Types.ObjectId(documentId));
        await worker.save();

        return documentCreated;
    } catch (error) {
        if (documentCreated?.deleteOne) {
            try {
                await documentCreated.deleteOne();
            } catch {
                // Best-effort cleanup only.
            }
        }
        if (fsModule.existsSync(finalPath)) {
            fsModule.unlinkSync(finalPath);
        }
        throw error;
    }
};

const createMassWorkerDocuments = async ({
    workers,
    tipoId,
    file,
    createOne = createDocumentForWorker,
}) => {
    const result = {
        totalTrabajadores: workers.length,
        documentosCreados: 0,
        fallidos: [],
    };

    for (const worker of workers) {
        try {
            await createOne({ worker, tipoId, file });
            result.documentosCreados += 1;
        } catch (error) {
            result.fallidos.push({
                trabajadorId: worker?._id ? String(worker._id) : '',
                rut: worker?.Rut ? String(worker.Rut) : '',
                nombre: worker?.Nombre ? String(worker.Nombre) : '',
                motivo: error instanceof Error ? error.message : 'No se pudo asignar el documento',
            });
        }
    }

    return result;
};

const getMassWorkerDocumentsStatus = (result) => result.fallidos.length > 0 ? 207 : 201;

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
        if (!isAllowedWorkerDocument(archivo)) {
            return res.status(400).send('Formato de archivo no permitido: ' + archivo.mimetype);
        }

        const trabajador = await trabajador_MongooseModel.findOne({
            Rut: { $eq: String(objetivoRut) }
        });
        if (!trabajador) {
            return res.status(404).send('Trabajador no encontrado');
        }

        await createDocumentForWorker({
            worker: trabajador,
            tipoId: resTipo._id,
            file: archivo,
        });

        return res.status(201).send('Documento creado correctamente');
    } catch (error) {
        console.error('Error al crear el documento:', error.message);
        return res.status(500).send('Error interno del servidor');
    }
};

const crearDocumentoMasivo = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No se ha subido ningún archivo' });
    }

    try {
        const tipoId = normalizeObjectId(req.body?.tipo);
        if (!tipoId) {
            return res.status(400).json({ message: 'Tipo de documento inválido' });
        }

        if (!isAllowedWorkerDocument(req.file)) {
            return res.status(400).json({ message: `Formato de archivo no permitido: ${req.file.mimetype}` });
        }

        const resTipo = await tipoDocumento_MongooseModel.findOne({
            _id: { $eq: new mongoose.Types.ObjectId(tipoId) }
        });
        if (!resTipo) {
            return res.status(400).json({ message: 'Tipo de documento no encontrado' });
        }

        const trabajadores = await trabajador_MongooseModel.find()
            .select('_id Rut Nombre documentos');
        const result = await createMassWorkerDocuments({
            workers: trabajadores,
            tipoId: resTipo._id,
            file: req.file,
        });

        return res.status(getMassWorkerDocumentsStatus(result)).json(result);
    } catch (error) {
        console.error('Error al crear documentos masivos:', error.message);
        return res.status(500).json({ message: 'Error interno del servidor' });
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

        const requesterRole = String(req.authz?.arquetipo || req.authUser?.arquetipo || req.authUser?.cargo || '').trim().toLowerCase();
        const requesterRut = String(req.authUser?.Rut || req.auth?.rut || '').trim();
        const canAccessForeignDocument = ['administracion', 'supervisor'].includes(requesterRole);

        if (!canAccessForeignDocument && requesterRut !== String(trabajador.Rut)) {
            return res.status(403).send('Permisos insuficientes');
        }

        const documentPath = resolveSafeDocumentPath(documento.url);
        if (!documentPath || !fs.existsSync(documentPath)) {
            return res.status(404).send('Documento no encontrado');
        }

        return res.download(documentPath, path.basename(String(documento.nombreOriginal || documentPath)));
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

module.exports = {
    crearDocumento,
    crearDocumentoMasivo,
    obtenerDocumentos,
    eliminarDocumentos,
    listarDocumentos,
    deleteDocumento,
    descargarDocumento,
    __testables: {
        buildSafeDocumentFileName,
        createDocumentForWorker,
        createMassWorkerDocuments,
        getMassWorkerDocumentsStatus,
        isAllowedWorkerDocument,
    },
};
