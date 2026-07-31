const crypto = require('node:crypto');
const fs = require('node:fs');
const mongoose = require('mongoose');
const path = require('node:path');
const { CategoriaDocumentoEmpresa } = require('../models/categoriaDocumentoEmpresa.model.js');
const { DocumentoEmpresa } = require('../models/documentoEmpresa.model.js');
const { notificaciones_MongooseModel: Notificacion } = require('../models/notificacion.model.js');
const { notificacion_validacion_MongooseModel: NotificacionValidacion } = require('../models/notificacion_validacion.model.js');
const { notificacion_vista_MongooseModel: NotificacionVista } = require('../models/notificacion_vista.model.js');
const { trabajador_MongooseModel: Trabajador } = require('../models/trabajador.model.js');
const { Rol } = require('../models/rol.model.js');
const { createCompanyDocumentSignatureNotification } = require('./notificaciones.controller.js');
const {
    buildDefaultApprovals,
    buildVersionedDocumentCode,
    deleteSavedFile,
    canAccessCompanyDocument,
    buildWorkerVisibleCompanyDocumentQuery,
    ensureCategoryDirectory,
    getApprovalSummary,
    getDigitalSignatureSummary,
    getExpirationStatus,
    normalizeDocumentCode,
    normalizeName,
    resolveCompanyDocumentPath,
    saveCompanyDocumentFile,
    slugifyCategory,
} = require('../services/companyDocuments.service.js');
const {
    buildCompanyDocumentEvidence,
    buildEvidenceCsv,
    buildEvidencePdf,
} = require('../services/companyDocumentEvidence.service.js');

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
const parseBoolean = (value) =>
    value === true ||
    value === 'true' ||
    value === '1' ||
    value === 1 ||
    value === 'on';

const parseList = (value) => {
    const parsed = parseJson(value, value);
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed !== 'string') return [];
    return parsed.split(',').map((item) => item.trim()).filter(Boolean);
};

const normalizeMatrixRelations = (value) => parseList(value)
    .map((item) => {
        if (typeof item === 'string') {
            return { codigo: normalizeDocumentCode(item), nombre: '', descripcion: '' };
        }
        return {
            codigo: normalizeDocumentCode(item?.codigo),
            nombre: normalizeName(item?.nombre),
            descripcion: normalizeName(item?.descripcion),
        };
    })
    .filter((item) => item.codigo);

const normalizeDocumentRelations = (value) => parseList(value)
    .map((item) => ({
        documento: objectId(typeof item === 'string' ? item : item?.documentoId || item?.documento),
        tipoRelacion: ['matriz', 'referencia', 'reemplaza', 'anexo', 'otro'].includes(item?.tipoRelacion)
            ? item.tipoRelacion
            : 'referencia',
        descripcion: normalizeName(item?.descripcion),
    }))
    .filter((item) => item.documento);

const normalizeResponsible = (body = {}, previous = {}) => ({
    nombre: normalizeName(body.responsableNombre) ||
        normalizeName(previous?.nombre) ||
        'Paola Olivares',
    cargo: normalizeName(body.responsableCargo) ||
        normalizeName(previous?.cargo) ||
        'Prevencion de Riesgos',
});

const buildControlChange = ({ version, descripcion, actor }) => ({
    version,
    descripcion: normalizeName(descripcion) || `Creacion de version ${version}`,
    autor: actor?._id,
    nombreAutor: normalizeName(actor?.Nombre),
});

const normalizeApprovalRequest = (body) => {
    if (!parseBoolean(body.requiereAprobacion)) return [];
    return buildDefaultApprovals();
};

const nextGeneratedDocumentCode = async (prefix = 'SGI') => {
    const normalizedPrefix = normalizeDocumentCode(prefix) || 'SGI';
    const documents = await DocumentoEmpresa.find({
        codigoBase: { $regex: `^${normalizedPrefix}-\\d+$` },
    }).select('codigoBase').lean();
    const next = documents.reduce((max, document) => {
        const match = String(document.codigoBase || '').match(/-(\d+)$/);
        const value = match ? Number.parseInt(match[1], 10) : 0;
        return Number.isFinite(value) ? Math.max(max, value) : max;
    }, 0) + 1;
    return `${normalizedPrefix}-${String(next).padStart(3, '0')}`;
};

const resolveDocumentCode = async ({ body, category, previous, version }) => {
    const base = normalizeDocumentCode(body.codigoBase || body.codigoDocumento) ||
        normalizeDocumentCode(previous?.codigoBase) ||
        await nextGeneratedDocumentCode(category?.slug?.startsWith('sgi') ? 'SGI' : 'DOC');
    return {
        codigoBase: base,
        codigoVersionado: buildVersionedDocumentCode(base, version),
    };
};

const normalizeApprovalRecordForClient = (approval) => ({
    tipo: approval.tipo,
    estado: approval.estado,
    aprobadorId: approval.aprobador ? String(approval.aprobador._id || approval.aprobador) : null,
    nombre: approval.nombre || '',
    rut: approval.rut || '',
    cargo: approval.cargo || '',
    comentario: approval.comentario || '',
    firmadoAt: approval.firmadoAt || null,
});

const canPublishDocument = (document) => {
    if (!document.requiereAprobacion) return true;
    return getApprovalSummary(document.aprobaciones || []).approved;
};

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
    const effectiveValidationMap = new Map(
        Array.from(validationMap.entries()).map(([key, validation]) => [
            key,
            { ...validation, estado: getValidationState(validation) },
        ])
    );
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
        const validation = effectiveValidationMap.get(String(signer.validacion || ''));
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
    const digitalSummary = getDigitalSignatureSummary(
        document.firmantesDigitales || [],
        effectiveValidationMap
    );
    return {
        id: String(document._id),
        serieId: document.serieId,
        version: document.version,
        codigoBase: document.codigoBase || '',
        codigoVersionado: document.codigoVersionado || '',
        documentoAnteriorId: document.documentoAnterior ? String(document.documentoAnterior) : null,
        categoria: category && typeof category === 'object'
            ? serializeCategory(category)
            : { id: String(category), nombre: '', descripcion: '', slug: '', activo: true },
        titulo: document.titulo,
        descripcion: document.descripcion || '',
        esGlobal: document.esGlobal === true,
        requiereAprobacion: document.requiereAprobacion === true,
        requiereFirmaDigital: document.requiereFirmaDigital === true,
        responsableSistemaGestion: {
            nombre: document.responsableSistemaGestion?.nombre || '',
            cargo: document.responsableSistemaGestion?.cargo || '',
        },
        aprobaciones: (document.aprobaciones || []).map(normalizeApprovalRecordForClient),
        aprobacion: getApprovalSummary(document.aprobaciones || []),
        controlCambios: (document.controlCambios || []).map((change) => ({
            version: change.version,
            fecha: change.fecha || null,
            descripcion: change.descripcion,
            autorId: change.autor ? String(change.autor._id || change.autor) : null,
            nombreAutor: change.nombreAutor || '',
        })),
        documentosRelacionados: (document.documentosRelacionados || []).map((relation) => ({
            documentoId: String(relation.documento?._id || relation.documento),
            tipoRelacion: relation.tipoRelacion,
            descripcion: relation.descripcion || '',
            titulo: relation.documento?.titulo || '',
            codigoVersionado: relation.documento?.codigoVersionado || '',
        })),
        matricesRelacionadas: (document.matricesRelacionadas || []).map((matrix) => ({
            codigo: matrix.codigo,
            nombre: matrix.nombre || '',
            descripcion: matrix.descripcion || '',
        })),
        publicadoAt: document.publicadoAt || null,
        difusion: {
            estado: document.difusion?.estado || 'no_requerida',
            ultimaNotificacionId: document.difusion?.ultimaNotificacion
                ? String(document.difusion.ultimaNotificacion)
                : null,
            difundidoAt: document.difusion?.difundidoAt || null,
            alcanceDescripcion: document.difusion?.alcanceDescripcion || '',
        },
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
        firmasDigitales: digitalSummary,
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

const getTargetWorkers = async ({ objetivo, cargo, roles }) => {
    const objetivos = parseList(objetivo);
    const cargos = parseList(cargo);
    const roleIds = parseList(roles).map(objectId).filter(Boolean);

    if (objetivos.includes('all')) {
        return Trabajador.find();
    }

    if (objetivos.length > 0) {
        return Trabajador.find({ Rut: { $in: objetivos } });
    }

    if (roleIds.length > 0) {
        return Trabajador.find({ rol: { $in: roleIds } });
    }

    if (cargos.length > 0) {
        return Trabajador.find({
            $or: [
                { arquetipo: { $in: cargos } },
                { arquetipo: { $exists: false }, cargo: { $in: cargos } },
            ],
        });
    }

    return [];
};

const buildDefaultDocumentSignatureCopy = (document) => ({
    titulo: `Firma requerida: ${document.codigoVersionado || document.titulo}`,
    mensaje: 'Debes revisar y aceptar este documento actualizado en App Innovo.',
    contenido: [
        `Documento: ${document.titulo}`,
        document.codigoVersionado ? `Codigo: ${document.codigoVersionado}` : null,
        `Version: ${document.version}`,
        'Al firmar declaras recepcion, difusion, porte permanente, disponibilidad, conocimiento, entendimiento y responsabilidad sobre el documento.',
    ].filter(Boolean).join('\n'),
});

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
        if (['borrador', 'pendiente_aprobacion', 'vigente', 'reemplazado', 'archivado'].includes(req.query.estado)) query.estado = req.query.estado;
        else query.estado = { $ne: 'archivado' };
        const search = normalizeName(req.query.q);
        if (search) query.$or = [
            { titulo: { $regex: search, $options: 'i' } },
            { descripcion: { $regex: search, $options: 'i' } },
        ];
        const [documents, total] = await Promise.all([
            DocumentoEmpresa.find(query).populate(['categoria', 'documentosRelacionados.documento']).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
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
            .populate('categoria')
            .sort({ serieId: 1, version: -1, createdAt: -1 })
            .lean();
        const latestBySeries = Array.from(
            documents.reduce((map, document) => {
                if (!map.has(document.serieId)) map.set(document.serieId, document);
                return map;
            }, new Map()).values()
        ).sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
        const workerId = requestUserId(req);
        const validations = workerId
            ? await NotificacionValidacion.find({
                trabajador: workerId,
                documentoEmpresa: { $in: latestBySeries.map((document) => document._id) },
            }).lean()
            : [];
        const validationByDocument = new Map(validations.map((validation) => [
            String(validation.documentoEmpresa),
            validation,
        ]));

        return res.json(latestBySeries.map((document) => {
            const validation = validationByDocument.get(String(document._id));
            const digitalSigner = (document.firmantesDigitales || [])
                .find((signer) => String(signer.trabajador) === String(workerId));
            return {
            id: String(document._id),
            esGlobal: true,
            serieId: document.serieId,
            codigoBase: document.codigoBase || '',
            codigoVersionado: document.codigoVersionado || '',
            titulo: document.titulo,
            descripcion: document.descripcion || '',
            categoria: document.categoria ? {
                id: String(document.categoria._id),
                nombre: document.categoria.nombre,
            } : null,
            version: document.version,
            requiereFirmaDigital: document.requiereFirmaDigital === true,
            firmaDigital: validation ? {
                required: true,
                notificacionId: digitalSigner?.notificacion ? String(digitalSigner.notificacion) : null,
                validacionId: String(validation._id),
                estado: getValidationState(validation),
                firmadoAt: validation.firmadoAt || null,
                aceptadoAt: validation.aceptadoAt || null,
                expiresAt: validation.expiresAt || null,
            } : {
                required: document.requiereFirmaDigital === true,
                notificacionId: null,
                validacionId: null,
                estado: document.requiereFirmaDigital ? 'pendiente' : 'no_requerida',
                firmadoAt: null,
                aceptadoAt: null,
                expiresAt: null,
            },
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
            };
        }));
    } catch (error) {
        return res.status(500).json({ message: 'No se pudieron cargar los documentos globales' });
    }
};

const getDocument = async (req, res) => {
    const id = objectId(req.params.id);
    if (!id) return res.status(400).json({ message: 'Documento inválido' });
    const document = await DocumentoEmpresa.findById(id).populate(['categoria', 'documentosRelacionados.documento']);
    if (!document) return res.status(404).json({ message: 'Documento no encontrado' });
    const versions = await DocumentoEmpresa.find({ serieId: document.serieId }).populate(['categoria', 'documentosRelacionados.documento']).sort({ version: -1 });
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
    const requiereFirmaDigital = parseBoolean(req.body.requiereFirmaDigital);
    const approvals = normalizeApprovalRequest(req.body);
    if (!categoryId || titulo.length < 2 || fechaEmision === undefined || fechaVencimiento === undefined || diasAviso < 1 || diasAviso > 365) {
        return res.status(400).json({ message: 'Datos del documento inválidos' });
    }
    const category = await CategoriaDocumentoEmpresa.findOne({ _id: categoryId, activo: true });
    if (!category) return res.status(400).json({ message: 'Categoría no disponible' });
    let saved;
    try {
        saved = await saveCompanyDocumentFile({ categorySlug: category.slug, file: req.file });
        const code = await resolveDocumentCode({ body: req.body, category, version: 1 });
        const physical = esGlobal
            ? []
            : await buildPhysicalSigners(parseJson(req.body.firmantesFisicos, []), requestUserId(req));
        const document = await DocumentoEmpresa.create({
            serieId: crypto.randomUUID(),
            version: 1,
            ...code,
            categoria: category._id,
            titulo,
            descripcion: normalizeName(req.body.descripcion),
            esGlobal,
            requiereAprobacion: approvals.length > 0,
            requiereFirmaDigital,
            responsableSistemaGestion: normalizeResponsible(req.body),
            aprobaciones: approvals,
            controlCambios: [
                buildControlChange({
                    version: 1,
                    descripcion: req.body.motivoCambio || req.body.controlCambio || 'Creacion inicial del documento',
                    actor: req.authUser,
                }),
            ],
            documentosRelacionados: normalizeDocumentRelations(req.body.documentosRelacionados),
            matricesRelacionadas: normalizeMatrixRelations(req.body.matricesRelacionadas),
            estado: approvals.length > 0 ? 'pendiente_aprobacion' : 'vigente',
            publicadoAt: approvals.length > 0 ? undefined : new Date(),
            difusion: {
                estado: requiereFirmaDigital ? 'pendiente' : 'no_requerida',
                alcanceDescripcion: normalizeName(req.body.alcanceDescripcion),
            },
            fechaEmision,
            fechaVencimiento,
            diasAviso,
            archivo: saved.file,
            firmantesFisicos: physical,
            creadoPor: requestUserId(req),
            actualizadoPor: requestUserId(req),
        });
        await document.populate(['categoria', 'documentosRelacionados.documento']);
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
    if (!['vigente', 'pendiente_aprobacion', 'borrador'].includes(document.estado)) {
        return res.status(409).json({ message: 'Solo la versión vigente o pendiente se puede editar' });
    }
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
    if (req.body.responsableNombre !== undefined || req.body.responsableCargo !== undefined) {
        document.responsableSistemaGestion = normalizeResponsible(req.body, document.responsableSistemaGestion);
    }
    if (req.body.documentosRelacionados !== undefined) {
        document.documentosRelacionados = normalizeDocumentRelations(req.body.documentosRelacionados);
    }
    if (req.body.matricesRelacionadas !== undefined) {
        document.matricesRelacionadas = normalizeMatrixRelations(req.body.matricesRelacionadas);
    }
    if (req.body.requiereFirmaDigital !== undefined && (document.firmantesDigitales || []).length === 0) {
        document.requiereFirmaDigital = parseBoolean(req.body.requiereFirmaDigital);
        document.difusion.estado = document.requiereFirmaDigital ? 'pendiente' : 'no_requerida';
    }
    if (req.body.alcanceDescripcion !== undefined) {
        document.difusion.alcanceDescripcion = normalizeName(req.body.alcanceDescripcion);
    }
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
    const approvalRequired = req.body.requiereAprobacion === undefined
        ? previous.requiereAprobacion === true
        : parseBoolean(req.body.requiereAprobacion);
    const approvals = approvalRequired ? buildDefaultApprovals() : [];
    const requiereFirmaDigital = req.body.requiereFirmaDigital === undefined
        ? previous.requiereFirmaDigital === true
        : parseBoolean(req.body.requiereFirmaDigital);
    if (issueDate === undefined || expirationDate === undefined || warningDays < 1 || warningDays > 365) {
        return res.status(400).json({ message: 'Fechas o anticipación de renovación inválidas' });
    }
    let saved;
    let created;
    try {
        const nextVersion = previous.version + 1;
        saved = await saveCompanyDocumentFile({ categorySlug: previous.categoria.slug, file: req.file });
        const code = await resolveDocumentCode({
            body: req.body,
            category: previous.categoria,
            previous,
            version: nextVersion,
        });
        const previousChanges = (previous.controlCambios || []).map((change) => (
            typeof change.toObject === 'function' ? change.toObject() : change
        ));
        const nextDocumentRelations = req.body.documentosRelacionados === undefined
            ? (previous.documentosRelacionados || []).map((relation) => ({
                documento: relation.documento,
                tipoRelacion: relation.tipoRelacion,
                descripcion: relation.descripcion,
            }))
            : normalizeDocumentRelations(req.body.documentosRelacionados);
        const nextMatrixRelations = req.body.matricesRelacionadas === undefined
            ? (previous.matricesRelacionadas || []).map((matrix) => ({
                codigo: matrix.codigo,
                nombre: matrix.nombre,
                descripcion: matrix.descripcion,
            }))
            : normalizeMatrixRelations(req.body.matricesRelacionadas);
        created = await DocumentoEmpresa.create({
            serieId: previous.serieId,
            version: nextVersion,
            ...code,
            documentoAnterior: previous._id,
            categoria: previous.categoria._id,
            titulo: normalizeName(req.body.titulo) || previous.titulo,
            descripcion: req.body.descripcion === undefined ? previous.descripcion : normalizeName(req.body.descripcion),
            esGlobal: previous.esGlobal === true,
            requiereAprobacion: approvalRequired,
            requiereFirmaDigital,
            responsableSistemaGestion: normalizeResponsible(req.body, previous.responsableSistemaGestion),
            aprobaciones: approvals,
            controlCambios: [
                ...previousChanges,
                buildControlChange({
                    version: nextVersion,
                    descripcion: req.body.motivoCambio || req.body.controlCambio || `Renovacion a version ${nextVersion}`,
                    actor: req.authUser,
                }),
            ],
            documentosRelacionados: nextDocumentRelations,
            matricesRelacionadas: nextMatrixRelations,
            estado: approvalRequired ? 'pendiente_aprobacion' : 'vigente',
            publicadoAt: approvalRequired ? undefined : new Date(),
            difusion: {
                estado: requiereFirmaDigital ? 'pendiente' : 'no_requerida',
                alcanceDescripcion: normalizeName(req.body.alcanceDescripcion) || previous.difusion?.alcanceDescripcion || '',
            },
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
        await created.populate(['categoria', 'documentosRelacionados.documento']);
        if (!approvalRequired) {
            previous.estado = 'reemplazado';
            previous.actualizadoPor = requestUserId(req);
            await previous.save();
        }
        req.io?.to('permission:documentos_empresa.ver').emit('documentosEmpresaActualizados', { id: String(created._id) });
        return res.status(201).json(serializeDocument(created));
    } catch (error) {
        if (created?._id) await DocumentoEmpresa.deleteOne({ _id: created._id });
        await deleteSavedFile(saved?.absolutePath);
        return res.status(error.status || 500).json({ message: error.message || 'No se pudo renovar el documento' });
    }
};

const approveDocument = async (req, res) => {
    const id = objectId(req.params.id);
    const document = id ? await DocumentoEmpresa.findById(id).populate('categoria') : null;
    if (!document) return res.status(404).json({ message: 'Documento no encontrado' });
    if (!document.requiereAprobacion) {
        return res.status(409).json({ message: 'Este documento no requiere aprobación formal' });
    }

    const approvalType = String(req.body.tipo || '').trim().toLowerCase();
    if (!['gerencia', 'prevencion'].includes(approvalType)) {
        return res.status(400).json({ message: 'Tipo de aprobación inválido' });
    }
    const nextState = req.body.estado === 'rechazado' || req.body.aprobado === false
        ? 'rechazado'
        : 'aprobado';
    const approvals = document.aprobaciones?.length ? document.aprobaciones : buildDefaultApprovals();
    const approval = approvals.find((item) => item.tipo === approvalType);
    if (!approval) {
        approvals.push({ tipo: approvalType, estado: 'pendiente' });
    }
    const targetApproval = approvals.find((item) => item.tipo === approvalType);
    targetApproval.estado = nextState;
    targetApproval.aprobador = requestUserId(req);
    targetApproval.nombre = req.authUser?.Nombre || '';
    targetApproval.rut = req.authUser?.Rut || '';
    targetApproval.cargo = req.authz?.arquetipo || req.authUser?.arquetipo || req.authUser?.cargo || '';
    targetApproval.comentario = normalizeName(req.body.comentario);
    targetApproval.firmadoAt = new Date();
    document.aprobaciones = approvals;
    document.actualizadoPor = requestUserId(req);

    if (nextState === 'rechazado') {
        document.estado = 'pendiente_aprobacion';
    } else if (document.estado === 'pendiente_aprobacion' && canPublishDocument(document)) {
        document.estado = 'vigente';
        document.publicadoAt = new Date();
        document.difusion.estado = document.requiereFirmaDigital ? 'pendiente' : 'no_requerida';
        if (document.documentoAnterior) {
            await DocumentoEmpresa.updateOne(
                { _id: document.documentoAnterior, estado: 'vigente' },
                {
                    $set: {
                        estado: 'reemplazado',
                        actualizadoPor: requestUserId(req),
                    },
                }
            );
        }
    }

    await document.save();
    await document.populate(['categoria', 'documentosRelacionados.documento']);
    req.io?.to('permission:documentos_empresa.ver').emit('documentosEmpresaActualizados', { id });
    return res.json(serializeDocument(document, await validationMapForDocuments([document])));
};

const diffuseDocument = async (req, res) => {
    const id = objectId(req.params.id);
    const document = id ? await DocumentoEmpresa.findById(id).populate('categoria') : null;
    if (!document) return res.status(404).json({ message: 'Documento no encontrado' });
    if (document.estado !== 'vigente') {
        return res.status(409).json({ message: 'Solo se pueden difundir documentos vigentes' });
    }
    if (document.requiereAprobacion && !canPublishDocument(document)) {
        return res.status(409).json({ message: 'Faltan aprobaciones antes de difundir' });
    }

    const workers = await getTargetWorkers({
        objetivo: req.body.objetivo === undefined ? ['all'] : req.body.objetivo,
        cargo: req.body.cargo,
        roles: req.body.roles,
    });
    if (workers.length === 0) {
        return res.status(400).json({ message: 'No se encontraron trabajadores para difundir' });
    }

    const existingWorkers = new Set((document.firmantesDigitales || []).map((signer) => String(signer.trabajador)));
    const targetWorkers = workers.filter((worker) => !existingWorkers.has(String(worker._id)));
    if (targetWorkers.length === 0) {
        return res.json({
            message: 'Todos los trabajadores seleccionados ya tienen una solicitud de firma para este documento',
            document: serializeDocument(document, await validationMapForDocuments([document])),
            codigos: [],
        });
    }

    try {
        const copy = buildDefaultDocumentSignatureCopy(document);
        const result = await createCompanyDocumentSignatureNotification({
            documento: document,
            trabajadores: targetWorkers,
            firmanteIds: new Map(),
            titulo: normalizeName(req.body.titulo) || copy.titulo,
            mensaje: normalizeName(req.body.mensaje) || copy.mensaje,
            contenido: normalizeName(req.body.contenido) || copy.contenido,
            io: req.io,
        });
        const validationByWorker = new Map(result.validations.map((validation) => [
            String(validation.trabajador),
            validation,
        ]));

        document.requiereFirmaDigital = true;
        document.difusion = {
            estado: 'enviada',
            ultimaNotificacion: result.notification._id,
            difundidoAt: new Date(),
            alcanceDescripcion: normalizeName(req.body.alcanceDescripcion) ||
                document.difusion?.alcanceDescripcion ||
                `${targetWorkers.length} trabajador(es)`,
        };
        targetWorkers.forEach((worker) => {
            const validation = validationByWorker.get(String(worker._id));
            document.firmantesDigitales.push({
                trabajador: worker._id,
                nombre: worker.Nombre,
                rut: worker.Rut,
                cargo: worker.arquetipo || worker.cargo || '',
                notificacion: result.notification._id,
                validacion: validation?._id,
            });
        });
        document.actualizadoPor = requestUserId(req);
        await document.save();
        await document.populate(['categoria', 'documentosRelacionados.documento']);
        req.io?.to('permission:documentos_empresa.ver').emit('documentosEmpresaActualizados', { id });
        return res.status(201).json({
            message: `Documento difundido a ${targetWorkers.length} trabajador(es)`,
            document: serializeDocument(document, await validationMapForDocuments([document])),
            codigos: result.signatureBatch.codes || [],
        });
    } catch (error) {
        return res.status(error.status || 500).json({ message: error.message || 'No se pudo difundir el documento' });
    }
};

const getDocumentEvidence = async (req, res) => {
    const id = objectId(req.params.id);
    const document = id ? await DocumentoEmpresa.findById(id).populate('categoria') : null;
    if (!document) return res.status(404).json({ message: 'Documento no encontrado' });
    const [notifications, validations] = await Promise.all([
        Notificacion.find({ documentoEmpresa: document._id }).lean(),
        NotificacionValidacion.find({ documentoEmpresa: document._id }).lean(),
    ]);
    const notificationIds = notifications.map((notification) => notification._id);
    const workerIds = [
        ...new Set([
            ...validations.map((validation) => String(validation.trabajador)),
            ...notifications.flatMap((notification) => (notification.trabajadores || []).map(String)),
        ]),
    ].filter((workerId) => mongoose.isValidObjectId(workerId));
    const [views, workers] = await Promise.all([
        NotificacionVista.find({
            notificacion: { $in: notificationIds.map(String) },
            trabajador: { $in: workerIds },
        }).lean(),
        Trabajador.find({ _id: { $in: workerIds } }).select('_id Rut Nombre cargo arquetipo').lean(),
    ]);
    const evidence = buildCompanyDocumentEvidence({
        document,
        notifications,
        validations,
        views,
        workers,
    });
    const format = String(req.query.format || req.query.formato || 'json').trim().toLowerCase();
    if (format === 'csv') {
        const fileName = `evidencia-${document.codigoVersionado || document._id}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/["\r\n]/g, '_')}"`);
        return res.send(buildEvidenceCsv(evidence));
    }
    if (format === 'pdf') {
        const pdf = await buildEvidencePdf(evidence);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${pdf.fileName.replace(/["\r\n]/g, '_')}"`);
        return res.send(pdf.buffer);
    }
    return res.json(evidence);
};

const listChangeControl = async (req, res) => {
    const documents = await DocumentoEmpresa.find({ estado: { $ne: 'archivado' } })
        .populate('categoria')
        .sort({ codigoBase: 1, version: -1, createdAt: -1 })
        .lean();
    return res.json(documents.map((document) => ({
        id: String(document._id),
        serieId: document.serieId,
        codigoBase: document.codigoBase || '',
        codigoVersionado: document.codigoVersionado || '',
        version: document.version,
        titulo: document.titulo,
        categoria: document.categoria?.nombre || '',
        estado: document.estado,
        fechaEmision: document.fechaEmision || null,
        fechaVencimiento: document.fechaVencimiento || null,
        controlCambios: document.controlCambios || [],
        matricesRelacionadas: document.matricesRelacionadas || [],
        documentosRelacionados: (document.documentosRelacionados || []).map((relation) => ({
            documentoId: String(relation.documento),
            tipoRelacion: relation.tipoRelacion,
            descripcion: relation.descripcion || '',
        })),
    })));
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
    const documents = await DocumentoEmpresa.find({ estado: { $ne: 'archivado' } });
    const validations = await validationMapForDocuments(documents);
    const serialized = documents.map((document) => serializeDocument(document, validations));
    return res.json({
        total: serialized.length,
        vigentes: serialized.filter(({ estado }) => estado === 'vigente').length,
        pendientesAprobacion: serialized.filter(({ estado }) => estado === 'pendiente_aprobacion').length,
        porVencer: serialized.filter(({ estadoVencimiento }) => estadoVencimiento === 'por_vencer').length,
        vencidos: serialized.filter(({ estadoVencimiento }) => estadoVencimiento === 'vencido').length,
        firmasPendientes: serialized.reduce((sum, document) => sum + document.firmas.total - document.firmas.completadas, 0),
        firmasDigitalesPendientes: serialized.reduce((sum, document) => sum + document.firmasDigitales.pendientes, 0),
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
    approveDocument,
    archiveCategory,
    archiveDocument,
    createCategory,
    createDocument,
    diffuseDocument,
    downloadDocument,
    getCandidates,
    getDocument,
    getDocumentEvidence,
    getSummary,
    listChangeControl,
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
