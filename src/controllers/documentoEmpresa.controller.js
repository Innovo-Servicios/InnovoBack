const crypto = require('node:crypto');
const fs = require('node:fs');
const mongoose = require('mongoose');
const path = require('node:path');
const { CategoriaDocumentoEmpresa } = require('../models/categoriaDocumentoEmpresa.model.js');
const { DocumentoEmpresa } = require('../models/documentoEmpresa.model.js');
const { notificacion_validacion_MongooseModel: NotificacionValidacion } = require('../models/notificacion_validacion.model.js');
const { trabajador_MongooseModel: Trabajador } = require('../models/trabajador.model.js');
const { Rol } = require('../models/rol.model.js');
const {
    deleteSavedFile,
    canAccessCompanyDocument,
    buildWorkerVisibleCompanyDocumentQuery,
    ensureCategoryDirectory,
    getExpirationStatus,
    normalizeName,
    resolveCompanyDocumentPath,
    saveCompanyDocumentFile,
    slugifyCategory,
} = require('../services/companyDocuments.service.js');

const objectId = (value) => mongoose.isValidObjectId(value) ? String(value) : null;
const parseJson = (value, fallback) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch { return fallback; }
};
const parseOptionalDate = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};
const requestUserId = (req) => req.authUser?._id;

const getValidationState = (validation) => {
    if (!validation) return 'pendiente';
    if (
        ['pendiente', 'firmado'].includes(validation.estado) &&
        validation.expiresAt &&
        new Date(validation.expiresAt).getTime() < Date.now()
    ) return 'vencido';
    return validation.estado;
};

const validationMapForDocuments = async (documents) => {
    const ids = documents.flatMap((document) =>
        (document.firmantesDigitales || []).map((signer) => signer.validacion).filter(Boolean)
    );
    if (ids.length === 0) return new Map();
    const validations = await NotificacionValidacion.find({ _id: { $in: ids } }).lean();
    return new Map(validations.map((validation) => [String(validation._id), validation]));
};

const serializeCategory = (category, count = undefined) => ({
    id: String(category._id),
    nombre: category.nombre,
    descripcion: category.descripcion || '',
    slug: category.slug,
    activo: category.activo !== false,
    ...(count === undefined ? {} : { documentos: count }),
});

const serializeDocument = (document, validationMap = new Map()) => {
    const category = document.categoria;
    const physical = (document.firmantesFisicos || []).map((signer) => ({
        id: String(signer._id),
        tipo: signer.tipo,
        trabajadorId: signer.trabajador ? String(signer.trabajador._id || signer.trabajador) : null,
        nombre: signer.nombre,
        rut: signer.rut || '',
        cargo: signer.cargo || '',
        estado: signer.estado,
        firmadoAt: signer.firmadoAt || null,
    }));
    const digital = (document.firmantesDigitales || []).map((signer) => {
        const validation = validationMap.get(String(signer.validacion || ''));
        return {
            id: String(signer._id),
            trabajadorId: String(signer.trabajador?._id || signer.trabajador),
            nombre: signer.nombre,
            rut: signer.rut,
            cargo: signer.cargo || '',
            notificacionId: signer.notificacion ? String(signer.notificacion) : null,
            validacionId: signer.validacion ? String(signer.validacion) : null,
            estado: getValidationState(validation),
            expiresAt: validation?.expiresAt || null,
            firmadoAt: validation?.firmadoAt || null,
            aceptadoAt: validation?.aceptadoAt || null,
        };
    });
    const completed = physical.filter(({ estado }) => estado === 'firmado').length;
    return {
        id: String(document._id),
        serieId: document.serieId,
        version: document.version,
        documentoAnteriorId: document.documentoAnterior ? String(document.documentoAnterior) : null,
        categoria: category && typeof category === 'object'
            ? serializeCategory(category)
            : { id: String(category), nombre: '', descripcion: '', slug: '', activo: true },
        titulo: document.titulo,
        descripcion: document.descripcion || '',
        esGlobal: document.esGlobal === true,
        fechaEmision: document.fechaEmision || null,
        fechaVencimiento: document.fechaVencimiento || null,
        diasAviso: document.diasAviso,
        estado: document.estado,
        estadoVencimiento: getExpirationStatus(document),
        archivo: {
            nombre: document.archivo.nombreOriginal,
            mimeType: document.archivo.mimeType,
            tamano: document.archivo.tamano,
            url: `/documentoEmpresa/archivo/${document._id}/${encodeURIComponent(document.archivo.nombreOriginal)}`,
        },
        firmantesFisicos: physical,
        firmantesDigitales: digital,
        firmas: { completadas: completed, total: physical.length },
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
    };
};

const buildPhysicalSigners = async (rawSigners, actorId) => {
    const signers = Array.isArray(rawSigners) ? rawSigners : [];
    const workerIds = signers
        .filter((signer) => signer?.tipo === 'trabajador')
        .map((signer) => objectId(signer.trabajadorId))
        .filter(Boolean);
    const workers = await Trabajador.find({ _id: { $in: workerIds } }).select('Nombre Rut cargo arquetipo').lean();
    const workerMap = new Map(workers.map((worker) => [String(worker._id), worker]));
    const result = [];
    const seen = new Set();
    for (const signer of signers) {
        if (signer?.tipo === 'trabajador') {
            const worker = workerMap.get(String(signer.trabajadorId));
            if (!worker || seen.has(`w:${worker._id}`)) continue;
            seen.add(`w:${worker._id}`);
            result.push({
                tipo: 'trabajador',
                trabajador: worker._id,
                nombre: worker.Nombre,
                rut: worker.Rut,
                cargo: worker.arquetipo || worker.cargo || '',
                estado: signer.estado === 'firmado' ? 'firmado' : 'pendiente',
                firmadoAt: signer.estado === 'firmado' ? new Date() : undefined,
                registradoPor: actorId,
            });
            continue;
        }
        const name = normalizeName(signer?.nombre);
        if (!name) continue;
        const key = `e:${String(signer?.rut || name).trim().toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({
            tipo: 'externo',
            nombre: name,
            rut: String(signer?.rut || '').trim(),
            cargo: normalizeName(signer?.cargo),
            estado: signer.estado === 'firmado' ? 'firmado' : 'pendiente',
            firmadoAt: signer.estado === 'firmado' ? new Date() : undefined,
            registradoPor: actorId,
        });
    }
    return result;
};

const listCategories = async (req, res) => {
    try {
        const categories = await CategoriaDocumentoEmpresa.find().sort({ activo: -1, nombre: 1 }).lean();
        const counts = await DocumentoEmpresa.aggregate([
            { $match: { estado: { $ne: 'archivado' } } },
            { $group: { _id: '$categoria', count: { $sum: 1 } } },
        ]);
        const countMap = new Map(counts.map(({ _id, count }) => [String(_id), count]));
        return res.json(categories.map((category) => serializeCategory(category, countMap.get(String(category._id)) || 0)));
    } catch (error) {
        return res.status(500).json({ message: 'No se pudieron cargar las categorías' });
    }
};

const createCategory = async (req, res) => {
    const nombre = normalizeName(req.body.nombre);
    if (nombre.length < 2) return res.status(400).json({ message: 'Nombre de categoría inválido' });
    try {
        const normalized = nombre.toLocaleLowerCase('es-CL');
        if (await CategoriaDocumentoEmpresa.exists({ nombreNormalizado: normalized })) {
            return res.status(409).json({ message: 'La categoría ya existe' });
        }
        const baseSlug = slugifyCategory(nombre);
        let slug = baseSlug;
        let suffix = 2;
        while (await CategoriaDocumentoEmpresa.exists({ slug })) slug = `${baseSlug}-${suffix++}`;
        const { relative } = await ensureCategoryDirectory(slug);
        const category = await CategoriaDocumentoEmpresa.create({
            nombre,
            nombreNormalizado: normalized,
            slug,
            carpetaRelativa: relative,
            descripcion: normalizeName(req.body.descripcion),
            creadoPor: requestUserId(req),
            actualizadoPor: requestUserId(req),
        });
        req.io?.to('permission:documentos_empresa.ver').emit('documentosEmpresaActualizados');
        return res.status(201).json(serializeCategory(category, 0));
    } catch (error) {
        return res.status(500).json({ message: 'No se pudo crear la categoría' });
    }
};

const updateCategory = async (req, res) => {
    const id = objectId(req.params.id);
    const nombre = normalizeName(req.body.nombre);
    if (!id || nombre.length < 2) return res.status(400).json({ message: 'Categoría inválida' });
    try {
        const category = await CategoriaDocumentoEmpresa.findById(id);
        if (!category) return res.status(404).json({ message: 'Categoría no encontrada' });
        const normalized = nombre.toLocaleLowerCase('es-CL');
        const duplicate = await CategoriaDocumentoEmpresa.exists({ nombreNormalizado: normalized, _id: { $ne: id } });
        if (duplicate) return res.status(409).json({ message: 'La categoría ya existe' });
        category.nombre = nombre;
        category.nombreNormalizado = normalized;
        category.descripcion = normalizeName(req.body.descripcion);
        category.actualizadoPor = requestUserId(req);
        await category.save();
        req.io?.to('permission:documentos_empresa.ver').emit('documentosEmpresaActualizados');
        return res.json(serializeCategory(category));
    } catch (error) {
        return res.status(500).json({ message: 'No se pudo actualizar la categoría' });
    }
};

const archiveCategory = async (req, res) => {
    const id = objectId(req.params.id);
    if (!id) return res.status(400).json({ message: 'Categoría inválida' });
    const category = await CategoriaDocumentoEmpresa.findById(id);
    if (!category) return res.status(404).json({ message: 'Categoría no encontrada' });
    category.activo = false;
    category.actualizadoPor = requestUserId(req);
    await category.save();
    req.io?.to('permission:documentos_empresa.ver').emit('documentosEmpresaActualizados');
    return res.status(204).send();
};

const listDocuments = async (req, res) => {
    try {
        const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 25, 1), 100);
        const query = {};
        if (objectId(req.query.categoria)) query.categoria = req.query.categoria;
        if (['true', 'false'].includes(req.query.esGlobal)) query.esGlobal = req.query.esGlobal === 'true';
        if (['vigente', 'reemplazado', 'archivado'].includes(req.query.estado)) query.estado = req.query.estado;
        else query.estado = { $ne: 'archivado' };
        const search = normalizeName(req.query.q);
        if (search) query.$or = [
            { titulo: { $regex: search, $options: 'i' } },
            { descripcion: { $regex: search, $options: 'i' } },
        ];
        const [documents, total] = await Promise.all([
            DocumentoEmpresa.find(query).populate('categoria').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
            DocumentoEmpresa.countDocuments(query),
        ]);
        const validations = await validationMapForDocuments(documents);
        return res.json({
            items: documents.map((document) => serializeDocument(document, validations)),
            page,
            limit,
            total,
            pages: Math.max(Math.ceil(total / limit), 1),
        });
    } catch (error) {
        return res.status(500).json({ message: 'No se pudieron cargar los documentos' });
    }
};

const listAvailableDocuments = async (req, res) => {
    try {
        const documents = await DocumentoEmpresa.find(buildWorkerVisibleCompanyDocumentQuery())
            .populate('categoria').sort({ createdAt: -1 }).lean();

        return res.json(documents.map((document) => ({
            id: String(document._id),
            esGlobal: true,
            titulo: document.titulo,
            descripcion: document.descripcion || '',
            categoria: document.categoria ? {
                id: String(document.categoria._id),
                nombre: document.categoria.nombre,
            } : null,
            version: document.version,
            fechaEmision: document.fechaEmision || null,
            fechaVencimiento: document.fechaVencimiento || null,
            estadoVencimiento: getExpirationStatus(document),
            archivo: {
                nombre: document.archivo.nombreOriginal,
                mimeType: document.archivo.mimeType,
                tamano: document.archivo.tamano,
                url: `/documentoEmpresa/archivo/${document._id}/${encodeURIComponent(document.archivo.nombreOriginal)}`,
            },
            createdAt: document.createdAt,
            updatedAt: document.updatedAt,
        })));
    } catch (error) {
        return res.status(500).json({ message: 'No se pudieron cargar los documentos globales' });
    }
};

const getDocument = async (req, res) => {
    const id = objectId(req.params.id);
    if (!id) return res.status(400).json({ message: 'Documento inválido' });
    const document = await DocumentoEmpresa.findById(id).populate('categoria');
    if (!document) return res.status(404).json({ message: 'Documento no encontrado' });
    const versions = await DocumentoEmpresa.find({ serieId: document.serieId }).populate('categoria').sort({ version: -1 });
    const validations = await validationMapForDocuments(versions);
    return res.json({
        ...serializeDocument(document, validations),
        historial: versions.map((version) => serializeDocument(version, validations)),
    });
};

const createDocument = async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'Debes seleccionar un archivo' });
    const categoryId = objectId(req.body.categoriaId);
    const titulo = normalizeName(req.body.titulo);
    const fechaEmision = parseOptionalDate(req.body.fechaEmision);
    const fechaVencimiento = parseOptionalDate(req.body.fechaVencimiento);
    const diasAviso = Number.parseInt(req.body.diasAviso, 10) || 30;
    const esGlobal = req.body.esGlobal === true || req.body.esGlobal === 'true';
    if (!categoryId || titulo.length < 2 || fechaEmision === undefined || fechaVencimiento === undefined || diasAviso < 1 || diasAviso > 365) {
        return res.status(400).json({ message: 'Datos del documento inválidos' });
    }
    const category = await CategoriaDocumentoEmpresa.findOne({ _id: categoryId, activo: true });
    if (!category) return res.status(400).json({ message: 'Categoría no disponible' });
    let saved;
    try {
        saved = await saveCompanyDocumentFile({ categorySlug: category.slug, file: req.file });
        const physical = esGlobal
            ? []
            : await buildPhysicalSigners(parseJson(req.body.firmantesFisicos, []), requestUserId(req));
        const document = await DocumentoEmpresa.create({
            serieId: crypto.randomUUID(),
            version: 1,
            categoria: category._id,
            titulo,
            descripcion: normalizeName(req.body.descripcion),
            esGlobal,
            fechaEmision,
            fechaVencimiento,
            diasAviso,
            archivo: saved.file,
            firmantesFisicos: physical,
            creadoPor: requestUserId(req),
            actualizadoPor: requestUserId(req),
        });
        await document.populate('categoria');
        req.io?.to('permission:documentos_empresa.ver').emit('documentosEmpresaActualizados', { id: String(document._id) });
        return res.status(201).json(serializeDocument(document));
    } catch (error) {
        await deleteSavedFile(saved?.absolutePath);
        return res.status(error.status || 500).json({ message: error.message || 'No se pudo guardar el documento' });
    }
};

const updateDocument = async (req, res) => {
    const id = objectId(req.params.id);
    const document = id ? await DocumentoEmpresa.findById(id).populate('categoria') : null;
    if (!document) return res.status(404).json({ message: 'Documento no encontrado' });
    if (document.estado !== 'vigente') return res.status(409).json({ message: 'Solo la versión vigente se puede editar' });
    const titulo = req.body.titulo === undefined ? document.titulo : normalizeName(req.body.titulo);
    const emission = req.body.fechaEmision === undefined ? document.fechaEmision : parseOptionalDate(req.body.fechaEmision);
    const expiration = req.body.fechaVencimiento === undefined ? document.fechaVencimiento : parseOptionalDate(req.body.fechaVencimiento);
    const warningDays = req.body.diasAviso === undefined ? document.diasAviso : Number.parseInt(req.body.diasAviso, 10);
    if (titulo.length < 2 || emission === undefined || expiration === undefined || warningDays < 1 || warningDays > 365) {
        return res.status(400).json({ message: 'Datos del documento inválidos' });
    }
    const expirationChanged = String(document.fechaVencimiento || '') !== String(expiration || '') || document.diasAviso !== warningDays;
    document.titulo = titulo;
    document.descripcion = req.body.descripcion === undefined ? document.descripcion : normalizeName(req.body.descripcion);
    document.fechaEmision = emission;
    document.fechaVencimiento = expiration;
    document.diasAviso = warningDays;
    document.actualizadoPor = requestUserId(req);
    if (expirationChanged) {
        document.ultimoHitoAvisado = 0;
        document.vencimientoAvisado = undefined;
    }
    await document.save();
    req.io?.to('permission:documentos_empresa.ver').emit('documentosEmpresaActualizados', { id });
    return res.json(serializeDocument(document, await validationMapForDocuments([document])));
};

const archiveDocument = async (req, res) => {
    const id = objectId(req.params.id);
    const document = id ? await DocumentoEmpresa.findById(id) : null;
    if (!document) return res.status(404).json({ message: 'Documento no encontrado' });
    document.estado = 'archivado';
    document.actualizadoPor = requestUserId(req);
    await document.save();
    req.io?.to('permission:documentos_empresa.ver').emit('documentosEmpresaActualizados', { id });
    return res.status(204).send();
};

const renewDocument = async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'Debes seleccionar el archivo renovado' });
    const id = objectId(req.params.id);
    const previous = id ? await DocumentoEmpresa.findById(id).populate('categoria') : null;
    if (!previous) return res.status(404).json({ message: 'Documento no encontrado' });
    if (previous.estado !== 'vigente') return res.status(409).json({ message: 'Solo la versión vigente se puede renovar' });
    const issueDate = req.body.fechaEmision === undefined
        ? new Date()
        : parseOptionalDate(req.body.fechaEmision);
    const expirationDate = req.body.fechaVencimiento === undefined
        ? null
        : parseOptionalDate(req.body.fechaVencimiento);
    const warningDays = req.body.diasAviso === undefined
        ? previous.diasAviso
        : Number.parseInt(req.body.diasAviso, 10);
    if (issueDate === undefined || expirationDate === undefined || warningDays < 1 || warningDays > 365) {
        return res.status(400).json({ message: 'Fechas o anticipación de renovación inválidas' });
    }
    let saved;
    let created;
    try {
        saved = await saveCompanyDocumentFile({ categorySlug: previous.categoria.slug, file: req.file });
        created = await DocumentoEmpresa.create({
            serieId: previous.serieId,
            version: previous.version + 1,
            documentoAnterior: previous._id,
            categoria: previous.categoria._id,
            titulo: normalizeName(req.body.titulo) || previous.titulo,
            descripcion: req.body.descripcion === undefined ? previous.descripcion : normalizeName(req.body.descripcion),
            esGlobal: previous.esGlobal === true,
            fechaEmision: issueDate,
            fechaVencimiento: expirationDate,
            diasAviso: warningDays,
            archivo: saved.file,
            firmantesFisicos: previous.esGlobal ? [] : (previous.firmantesFisicos || []).map((signer) => ({
                tipo: signer.tipo,
                trabajador: signer.trabajador,
                nombre: signer.nombre,
                rut: signer.rut,
                cargo: signer.cargo,
                estado: 'pendiente',
                registradoPor: requestUserId(req),
            })),
            creadoPor: requestUserId(req),
            actualizadoPor: requestUserId(req),
        });
        await created.populate('categoria');
        previous.estado = 'reemplazado';
        previous.actualizadoPor = requestUserId(req);
        await previous.save();
        req.io?.to('permission:documentos_empresa.ver').emit('documentosEmpresaActualizados', { id: String(created._id) });
        return res.status(201).json(serializeDocument(created));
    } catch (error) {
        if (created?._id) await DocumentoEmpresa.deleteOne({ _id: created._id });
        await deleteSavedFile(saved?.absolutePath);
        return res.status(error.status || 500).json({ message: error.message || 'No se pudo renovar el documento' });
    }
};

const getCandidates = async (req, res) => {
    const [workers, roles] = await Promise.all([
        Trabajador.find().select('_id Nombre Rut cargo arquetipo rol').sort({ Nombre: 1 }).lean(),
        Rol.find({ activo: true, legado: { $ne: true } }).select('_id nombre arquetipo').sort({ nombre: 1 }).lean(),
    ]);
    return res.json({
        trabajadores: workers.map((worker) => ({
            id: String(worker._id), nombre: worker.Nombre, rut: worker.Rut,
            arquetipo: worker.arquetipo || worker.cargo,
            rolId: worker.rol ? String(worker.rol) : null,
        })),
        roles: roles.map((role) => ({ id: String(role._id), nombre: role.nombre, arquetipo: role.arquetipo })),
    });
};

const addPhysicalSigner = async (req, res) => {
    const id = objectId(req.params.id);
    const document = id ? await DocumentoEmpresa.findById(id).populate('categoria') : null;
    if (!document) return res.status(404).json({ message: 'Documento no encontrado' });
    if (document.esGlobal) return res.status(409).json({ message: 'Los documentos globales no requieren firmantes individuales' });
    const signers = await buildPhysicalSigners([req.body], requestUserId(req));
    if (signers.length === 0) return res.status(400).json({ message: 'Firmante inválido' });
    const candidate = signers[0];
    const duplicate = (document.firmantesFisicos || []).some((signer) =>
        candidate.tipo === 'trabajador'
            ? signer.tipo === 'trabajador' && String(signer.trabajador) === String(candidate.trabajador)
            : signer.tipo === 'externo' && String(signer.rut || signer.nombre).trim().toLowerCase() ===
                String(candidate.rut || candidate.nombre).trim().toLowerCase()
    );
    if (duplicate) return res.status(409).json({ message: 'El firmante ya está asociado al documento' });
    document.firmantesFisicos.push(candidate);
    await document.save();
    return res.status(201).json(serializeDocument(document, await validationMapForDocuments([document])));
};

const updatePhysicalSigner = async (req, res) => {
    const id = objectId(req.params.id);
    const signerId = objectId(req.params.firmanteId);
    const document = id && signerId ? await DocumentoEmpresa.findById(id).populate('categoria') : null;
    const signer = document?.firmantesFisicos.id(signerId);
    if (!signer) return res.status(404).json({ message: 'Firmante no encontrado' });
    const signed = req.body.estado === 'firmado' || req.body.firmado === true;
    signer.estado = signed ? 'firmado' : 'pendiente';
    signer.firmadoAt = signed ? (parseOptionalDate(req.body.firmadoAt) || new Date()) : undefined;
    signer.registradoPor = requestUserId(req);
    await document.save();
    return res.json(serializeDocument(document, await validationMapForDocuments([document])));
};

const removePhysicalSigner = async (req, res) => {
    const id = objectId(req.params.id);
    const signerId = objectId(req.params.firmanteId);
    const document = id && signerId ? await DocumentoEmpresa.findById(id) : null;
    const signer = document?.firmantesFisicos.id(signerId);
    if (!signer) return res.status(404).json({ message: 'Firmante no encontrado' });
    if (signer.estado === 'firmado') return res.status(409).json({ message: 'Revierte la firma antes de eliminar al firmante' });
    signer.deleteOne();
    await document.save();
    return res.status(204).send();
};

const getSummary = async (req, res) => {
    const documents = await DocumentoEmpresa.find({ estado: 'vigente' });
    const validations = await validationMapForDocuments(documents);
    const serialized = documents.map((document) => serializeDocument(document, validations));
    return res.json({
        total: serialized.length,
        vigentes: serialized.filter(({ estadoVencimiento }) => estadoVencimiento === 'vigente').length,
        porVencer: serialized.filter(({ estadoVencimiento }) => estadoVencimiento === 'por_vencer').length,
        vencidos: serialized.filter(({ estadoVencimiento }) => estadoVencimiento === 'vencido').length,
        firmasPendientes: serialized.reduce((sum, document) => sum + document.firmas.total - document.firmas.completadas, 0),
    });
};

const downloadDocument = async (req, res) => {
    const id = objectId(req.params.id);
    const document = id ? await DocumentoEmpresa.findById(id) : null;
    if (!document) return res.status(404).json({ message: 'Documento no encontrado' });
    if (!canAccessCompanyDocument({
        document,
        workerId: requestUserId(req),
        permissions: req.authz?.permisos,
    })) return res.status(403).json({ message: 'No tienes acceso a este documento' });
    const filePath = resolveCompanyDocumentPath(document.archivo.rutaRelativa);
    if (!filePath) return res.status(404).json({ message: 'Archivo no encontrado' });
    const inline = document.archivo.mimeType === 'application/pdf' || document.archivo.mimeType.startsWith('image/');
    if (inline) {
        return res.sendFile(filePath, {
            headers: {
                'Content-Type': document.archivo.mimeType,
                'Content-Disposition': `inline; filename="${path.basename(document.archivo.nombreOriginal).replace(/["\r\n]/g, '_')}"`,
            },
        });
    }
    return res.download(filePath, path.basename(document.archivo.nombreOriginal));
};

module.exports = {
    addPhysicalSigner,
    archiveCategory,
    archiveDocument,
    createCategory,
    createDocument,
    downloadDocument,
    getCandidates,
    getDocument,
    getSummary,
    listAvailableDocuments,
    listCategories,
    listDocuments,
    removePhysicalSigner,
    renewDocument,
    serializeDocument,
    updateCategory,
    updateDocument,
    updatePhysicalSigner,
};
