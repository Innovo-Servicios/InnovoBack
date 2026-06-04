const mongoose = require('mongoose');
const { z } = require('zod');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const { sector_MongooseModel: Sector } = require('../models/sector.model');
const { ruta_MongooseModel: Ruta } = require('../models/ruta.model');
const { trabajador_MongooseModel: Trabajador } = require('../models/trabajador.model');
const { asignacion_MongooseModel: Asignacion } = require('../models/asignacion.model');
const {
    ASSIGNMENT_TYPES,
    asignacionPlantilla_MongooseModel: AsignacionPlantilla,
} = require('../models/asignacionPlantilla.model');

dayjs.extend(utc);

const EMPRESAS = ['GasValpo', 'Comercial', 'Energas'];
const ASSIGNMENT_TYPE_SET = new Set(ASSIGNMENT_TYPES);

const empresaSchema = z.enum(EMPRESAS);
const idSchema = z.string().trim().min(1);
const tiposSchema = z.array(z.enum(ASSIGNMENT_TYPES)).optional();

const templatePayloadSchema = z.object({
    fixedAssignments: z.array(z.object({
        trabajadorId: idSchema,
        sectorId: idSchema,
        tipos: tiposSchema,
    })).default([]),
    rotating: z.object({
        trabajadorIds: z.array(idSchema).default([]),
        rutaIds: z.array(idSchema).default([]),
        sectorIds: z.array(idSchema).default([]),
        tipos: tiposSchema,
    }).default({
        trabajadorIds: [],
        rutaIds: [],
        sectorIds: [],
        tipos: ASSIGNMENT_TYPES,
    }),
    leftoverWorkers: z.array(z.object({
        trabajadorId: idSchema,
        tipos: tiposSchema,
    })).default([]),
    restrictions: z.array(z.object({
        trabajadorId: idSchema,
        sectorIds: z.array(idSchema).default([]),
    })).default([]),
}).default({
    fixedAssignments: [],
    rotating: {
        trabajadorIds: [],
        rutaIds: [],
        sectorIds: [],
        tipos: ASSIGNMENT_TYPES,
    },
    leftoverWorkers: [],
    restrictions: [],
});

const routeDaySchema = z.object({
    rutaId: idSchema.optional(),
    rutaNumero: z.coerce.number().int().optional(),
    lectura: z.string().trim().optional().nullable(),
    reparto: z.string().trim().optional().nullable(),
});

const previewSchema = z.object({
    empresa: empresaSchema,
    year: z.coerce.number().int().min(2020).max(2100),
    month: z.coerce.number().int().min(1).max(12),
    routeDays: z.array(routeDaySchema).default([]),
    template: templatePayloadSchema.optional(),
});

const confirmAssignmentSchema = z.object({
    key: z.string().trim().optional(),
    fecha: z.string().trim(),
    tipo: z.enum(ASSIGNMENT_TYPES),
    sectorId: idSchema,
    trabajadorId: idSchema,
    source: z.string().trim().optional(),
});

const confirmSchema = z.object({
    empresa: empresaSchema,
    asignaciones: z.array(confirmAssignmentSchema).default([]),
    conflictResolutions: z.record(z.string(), z.enum(['keep', 'replace'])).default({}),
});

const normalizeObjectId = (value) => {
    const text = String(value || '').trim();
    return mongoose.isValidObjectId(text) ? text : null;
};

const unique = (values) => Array.from(new Set(values.filter(Boolean)));

const normalizeTipos = (tipos) => {
    const selected = Array.isArray(tipos)
        ? unique(tipos.map((tipo) => String(tipo || '').trim()).filter((tipo) => ASSIGNMENT_TYPE_SET.has(tipo)))
        : [];
    return selected.length ? selected : [...ASSIGNMENT_TYPES];
};

const getPlainId = (value) => {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (value._id) return String(value._id);
    return String(value);
};

const buildEmptyTemplate = (empresa) => ({
    empresa,
    fixedAssignments: [],
    rotating: {
        trabajadorIds: [],
        rutaIds: [],
        sectorIds: [],
        tipos: [...ASSIGNMENT_TYPES],
    },
    leftoverWorkers: [],
    restrictions: [],
});

const serializeTemplate = (template, empresa) => {
    if (!template) return buildEmptyTemplate(empresa);
    const plainTemplate = typeof template.toObject === 'function' ? template.toObject() : template;

    return {
        empresa,
        fixedAssignments: (plainTemplate.fixedAssignments || []).map((rule) => ({
            trabajadorId: getPlainId(rule.trabajador),
            sectorId: getPlainId(rule.sector),
            tipos: normalizeTipos(rule.tipos),
        })).filter((rule) => rule.trabajadorId && rule.sectorId),
        rotating: {
            trabajadorIds: unique((plainTemplate.rotating?.trabajadores || []).map(getPlainId)),
            rutaIds: unique((plainTemplate.rotating?.rutas || []).map(getPlainId)),
            sectorIds: unique((plainTemplate.rotating?.sectores || []).map(getPlainId)),
            tipos: normalizeTipos(plainTemplate.rotating?.tipos),
        },
        leftoverWorkers: (plainTemplate.leftoverWorkers || []).map((rule) => ({
            trabajadorId: getPlainId(rule.trabajador),
            tipos: normalizeTipos(rule.tipos),
        })).filter((rule) => rule.trabajadorId),
        restrictions: (plainTemplate.restrictions || []).map((rule) => ({
            trabajadorId: getPlainId(rule.trabajador),
            sectorIds: unique((rule.sectores || []).map(getPlainId)),
        })).filter((rule) => rule.trabajadorId),
        updatedAt: plainTemplate.updatedAt || null,
    };
};

const serializeWorker = (worker) => ({
    id: worker?._id ? String(worker._id) : null,
    nombre: worker?.Nombre || 'Sin trabajador',
    rut: worker?.Rut || '',
    cargo: worker?.cargo || '',
});

const serializeSector = (sector) => ({
    id: sector?._id ? String(sector._id) : null,
    nombre: sector?.sector || 'Sin sector',
    numero: sector?.NumeroSector ?? null,
    empresa: sector?.empresa || '',
    rutaId: sector?.NumeroRuta?._id ? String(sector.NumeroRuta._id) : getPlainId(sector?.NumeroRuta),
    rutaNumero: sector?.NumeroRuta?.NumeroRuta ?? null,
});

const loadCatalogData = async (empresa) => {
    const sectorFilter = empresa ? { empresa: { $eq: empresa } } : {};
    const [sectores, trabajadores, empresasDisponibles] = await Promise.all([
        Sector.find(sectorFilter)
            .populate({ path: 'NumeroRuta', select: 'NumeroRuta' })
            .sort({ NumeroSector: 1 })
            .lean(),
        Trabajador.find({ cargo: { $ne: 'administracion' } })
            .select('_id Nombre Rut cargo correo')
            .sort({ Nombre: 1 })
            .lean(),
        Sector.distinct('empresa'),
    ]);

    const routesById = new Map();
    for (const sector of sectores) {
        const routeId = sector.NumeroRuta?._id ? String(sector.NumeroRuta._id) : null;
        if (routeId && !routesById.has(routeId)) {
            routesById.set(routeId, {
                id: routeId,
                numero: sector.NumeroRuta?.NumeroRuta ?? null,
                sectores: 0,
            });
        }
        if (routeId) {
            routesById.get(routeId).sectores += 1;
        }
    }

    return {
        empresas: EMPRESAS.filter((item) => empresasDisponibles.includes(item)),
        rutas: Array.from(routesById.values()).sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0)),
        sectores: sectores.map(serializeSector).sort((a, b) => {
            if ((a.rutaNumero ?? 0) !== (b.rutaNumero ?? 0)) {
                return (a.rutaNumero ?? 0) - (b.rutaNumero ?? 0);
            }
            return (a.numero ?? 0) - (b.numero ?? 0);
        }),
        trabajadores: trabajadores.map(serializeWorker),
    };
};

const normalizeTemplatePayload = async (empresa, payload) => {
    const parsed = templatePayloadSchema.safeParse(payload || {});
    if (!parsed.success) {
        return {
            errors: ['La plantilla tiene un formato inválido.'],
            template: buildEmptyTemplate(empresa),
        };
    }

    const [sectores, rutas, trabajadores] = await Promise.all([
        Sector.find({ empresa: { $eq: empresa } }).select('_id NumeroRuta').lean(),
        Ruta.find().select('_id NumeroRuta').lean(),
        Trabajador.find({ cargo: { $ne: 'administracion' } }).select('_id Nombre Rut cargo').lean(),
    ]);

    const sectorIds = new Set(sectores.map((sector) => String(sector._id)));
    const routeIdsForCompany = new Set(sectores.map((sector) => getPlainId(sector.NumeroRuta)).filter(Boolean));
    const allRouteIds = new Set(rutas.map((ruta) => String(ruta._id)));
    const workerIds = new Set(trabajadores.map((worker) => String(worker._id)));
    const errors = [];

    const requireWorker = (value, label) => {
        const id = normalizeObjectId(value);
        if (!id || !workerIds.has(id)) errors.push(`${label}: trabajador no válido o no asignable.`);
        return id;
    };
    const requireSector = (value, label) => {
        const id = normalizeObjectId(value);
        if (!id || !sectorIds.has(id)) errors.push(`${label}: sector no válido para ${empresa}.`);
        return id;
    };
    const requireRoute = (value, label) => {
        const id = normalizeObjectId(value);
        if (!id || !allRouteIds.has(id) || !routeIdsForCompany.has(id)) {
            errors.push(`${label}: ruta no válida para ${empresa}.`);
        }
        return id;
    };

    const fixedAssignments = parsed.data.fixedAssignments.map((rule, index) => ({
        trabajadorId: requireWorker(rule.trabajadorId, `Fijo ${index + 1}`),
        sectorId: requireSector(rule.sectorId, `Fijo ${index + 1}`),
        tipos: normalizeTipos(rule.tipos),
    })).filter((rule) => rule.trabajadorId && rule.sectorId);

    const rotating = {
        trabajadorIds: unique(parsed.data.rotating.trabajadorIds.map((id, index) =>
            requireWorker(id, `Rotativo trabajador ${index + 1}`)
        )),
        rutaIds: unique(parsed.data.rotating.rutaIds.map((id, index) =>
            requireRoute(id, `Rotativo ruta ${index + 1}`)
        )),
        sectorIds: unique(parsed.data.rotating.sectorIds.map((id, index) =>
            requireSector(id, `Rotativo sector ${index + 1}`)
        )),
        tipos: normalizeTipos(parsed.data.rotating.tipos),
    };

    const leftoverWorkers = parsed.data.leftoverWorkers.map((rule, index) => ({
        trabajadorId: requireWorker(rule.trabajadorId, `Restante ${index + 1}`),
        tipos: normalizeTipos(rule.tipos),
    })).filter((rule) => rule.trabajadorId);

    const restrictions = parsed.data.restrictions.map((rule, index) => ({
        trabajadorId: requireWorker(rule.trabajadorId, `Restricción ${index + 1}`),
        sectorIds: unique(rule.sectorIds.map((id, sectorIndex) =>
            requireSector(id, `Restricción ${index + 1}.${sectorIndex + 1}`)
        )),
    })).filter((rule) => rule.trabajadorId);

    const sectorTypeOwner = new Map();
    for (const rule of fixedAssignments) {
        for (const tipo of rule.tipos) {
            const key = `${rule.sectorId}:${tipo}`;
            const previousWorker = sectorTypeOwner.get(key);
            if (previousWorker && previousWorker !== rule.trabajadorId) {
                errors.push('Un mismo sector/tipo fijo no puede tener más de un trabajador.');
            }
            sectorTypeOwner.set(key, rule.trabajadorId);
        }
    }

    const groupByType = new Map();
    const claimWorkerGroup = (workerId, tipo, group) => {
        const key = `${workerId}:${tipo}`;
        const existing = groupByType.get(key);
        if (existing && existing !== group) {
            errors.push('Un trabajador no puede estar en más de un grupo para el mismo tipo.');
        }
        groupByType.set(key, group);
    };

    for (const rule of fixedAssignments) {
        rule.tipos.forEach((tipo) => claimWorkerGroup(rule.trabajadorId, tipo, 'fijo'));
    }
    for (const workerId of rotating.trabajadorIds) {
        rotating.tipos.forEach((tipo) => claimWorkerGroup(workerId, tipo, 'rotativo'));
    }
    for (const rule of leftoverWorkers) {
        rule.tipos.forEach((tipo) => claimWorkerGroup(rule.trabajadorId, tipo, 'restante'));
    }

    const restrictedByWorker = buildRestrictionMap(restrictions);
    for (const rule of fixedAssignments) {
        if (restrictedByWorker.get(rule.trabajadorId)?.has(rule.sectorId)) {
            errors.push('Una asignación fija no puede usar un sector bloqueado para ese trabajador.');
        }
    }

    return {
        errors,
        template: {
            empresa,
            fixedAssignments,
            rotating,
            leftoverWorkers,
            restrictions,
        },
    };
};

const buildRestrictionMap = (restrictions) => {
    const map = new Map();
    for (const restriction of restrictions || []) {
        const current = map.get(restriction.trabajadorId) || new Set();
        for (const sectorId of restriction.sectorIds || []) {
            current.add(sectorId);
        }
        map.set(restriction.trabajadorId, current);
    }
    return map;
};

const isWorkerBlocked = (restrictionMap, workerId, sectorId) =>
    Boolean(restrictionMap.get(workerId)?.has(sectorId));

const randomPick = (values) => values[Math.floor(Math.random() * values.length)];

const validateMonthDate = (value, year, month, label, errors) => {
    const dateText = String(value || '').trim();
    if (!dateText) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
        errors.push(`${label}: fecha inválida.`);
        return null;
    }

    const parsed = dayjs.utc(dateText);
    if (!parsed.isValid() || parsed.format('YYYY-MM-DD') !== dateText) {
        errors.push(`${label}: fecha inválida.`);
        return null;
    }

    if (parsed.year() !== year || parsed.month() + 1 !== month) {
        errors.push(`${label}: la fecha debe pertenecer al mes seleccionado.`);
        return null;
    }

    return parsed.format('YYYY-MM-DD');
};

const buildRouteDaysMap = (routeDays, routes, year, month) => {
    const errors = [];
    const routesById = new Map(routes.map((route) => [route.id, route]));
    const routesByNumber = new Map(routes.map((route) => [String(route.numero), route]));
    const map = new Map();

    for (const day of routeDays || []) {
        const route = day.rutaId
            ? routesById.get(String(day.rutaId))
            : routesByNumber.get(String(day.rutaNumero));
        if (!route) {
            errors.push(`Ruta ${day.rutaNumero || day.rutaId}: no existe para la empresa seleccionada.`);
            continue;
        }

        map.set(route.id, {
            lectura: validateMonthDate(day.lectura, year, month, `Ruta ${route.numero} lectura`, errors),
            reparto: validateMonthDate(day.reparto, year, month, `Ruta ${route.numero} reparto`, errors),
        });
    }

    return { map, errors };
};

const assignmentKey = (sectorId, fecha, tipo) => `${sectorId}:${fecha}:${tipo}`;

const buildExistingAssignmentsMap = async (sectorIds, year, month) => {
    const monthStart = dayjs.utc(`${year}-${String(month).padStart(2, '0')}-01`).startOf('month').toDate();
    const monthEnd = dayjs.utc(monthStart).endOf('month').toDate();
    const existing = await Asignacion.find({
        NumeroSector: { $in: sectorIds },
        fecha_asignacion: {
            $gte: monthStart,
            $lte: monthEnd,
        },
        tipo: { $in: ASSIGNMENT_TYPES },
    })
        .populate({ path: 'Trabajador', select: 'Nombre Rut cargo' })
        .lean();

    const map = new Map();
    for (const assignment of existing) {
        const sectorId = getPlainId(assignment.NumeroSector);
        const fecha = dayjs.utc(assignment.fecha_asignacion).format('YYYY-MM-DD');
        map.set(assignmentKey(sectorId, fecha, assignment.tipo), assignment);
    }
    return map;
};

const findFixedRule = (template, sectorId, tipo) =>
    template.fixedAssignments.find((rule) => rule.sectorId === sectorId && rule.tipos.includes(tipo));

const isInRotatingScope = (template, sector, tipo) => {
    if (!template.rotating.tipos.includes(tipo)) return false;
    if (template.rotating.sectorIds.includes(sector.id)) return true;
    if (template.rotating.rutaIds.includes(sector.rutaId)) return true;
    return false;
};

const buildWorkerSummary = (rows) => {
    const map = new Map();
    for (const row of rows) {
        const key = row.trabajador.id;
        const current = map.get(key) || {
            trabajador: row.trabajador,
            total: 0,
            lectura: 0,
            reparto: 0,
            fija: 0,
            rotativa: 0,
            restante: 0,
        };
        current.total += 1;
        current[row.tipo] += 1;
        current[row.source] += 1;
        map.set(key, current);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
};

const buildPreview = async ({ empresa, year, month, routeDays, template }) => {
    const catalog = await loadCatalogData(empresa);
    const { map: routeDaysMap, errors: routeDayErrors } = buildRouteDaysMap(routeDays, catalog.rutas, year, month);
    if (routeDayErrors.length) {
        return { errors: routeDayErrors };
    }

    const workersById = new Map(catalog.trabajadores.map((worker) => [worker.id, worker]));
    const restrictionMap = buildRestrictionMap(template.restrictions);
    const rows = [];
    const omitted = [];

    const sectors = catalog.sectores;
    for (const sector of sectors) {
        for (const tipo of ASSIGNMENT_TYPES) {
            const fecha = routeDaysMap.get(sector.rutaId)?.[tipo];
            if (!fecha) {
                omitted.push({ sector, tipo, reason: 'Sin día configurado para la ruta y tipo.' });
                continue;
            }

            const fixedRule = findFixedRule(template, sector.id, tipo);
            let source = 'restante';
            let workerId = null;

            if (fixedRule) {
                source = 'fija';
                workerId = fixedRule.trabajadorId;
            } else if (isInRotatingScope(template, sector, tipo)) {
                source = 'rotativa';
                const candidates = template.rotating.trabajadorIds.filter((id) =>
                    workersById.has(id) && !isWorkerBlocked(restrictionMap, id, sector.id)
                );
                workerId = candidates.length ? randomPick(candidates) : null;
            } else {
                const candidates = template.leftoverWorkers
                    .filter((rule) => rule.tipos.includes(tipo))
                    .map((rule) => rule.trabajadorId)
                    .filter((id) => workersById.has(id) && !isWorkerBlocked(restrictionMap, id, sector.id));
                workerId = candidates.length ? randomPick(candidates) : null;
            }

            if (!workerId || !workersById.has(workerId)) {
                omitted.push({ sector, tipo, reason: `No hay trabajador disponible para asignación ${source}.` });
                continue;
            }

            rows.push({
                key: assignmentKey(sector.id, fecha, tipo),
                fecha,
                tipo,
                source,
                trabajador: workersById.get(workerId),
                sector,
                conflicto: null,
            });
        }
    }

    const existingMap = await buildExistingAssignmentsMap(sectors.map((sector) => sector.id), year, month);
    const rowsWithConflicts = rows.map((row) => {
        const existing = existingMap.get(row.key);
        if (!existing) return row;

        return {
            ...row,
            conflicto: {
                asignacionId: String(existing._id),
                trabajador: serializeWorker(existing.Trabajador),
                apoyo: Boolean(existing.apoyo),
            },
        };
    });

    return {
        errors: [],
        preview: {
            empresa,
            year,
            month,
            generatedAt: new Date().toISOString(),
            resumen: {
                total: rowsWithConflicts.length,
                nuevas: rowsWithConflicts.filter((row) => !row.conflicto).length,
                conflictos: rowsWithConflicts.filter((row) => row.conflicto).length,
                omitidas: omitted.length,
                lectura: rowsWithConflicts.filter((row) => row.tipo === 'lectura').length,
                reparto: rowsWithConflicts.filter((row) => row.tipo === 'reparto').length,
            },
            porTrabajador: buildWorkerSummary(rowsWithConflicts),
            asignaciones: rowsWithConflicts,
            omitidas: omitted,
        },
    };
};

const obtenerCatalogoCreador = async (req, res) => {
    try {
        const empresa = req.body?.empresa ? empresaSchema.parse(req.body.empresa) : null;
        const catalog = await loadCatalogData(empresa);
        return res.status(200).json(catalog);
    } catch (error) {
        return res.status(400).json({ message: 'No se pudo obtener el catálogo de asignaciones.' });
    }
};

const obtenerPlantillaCreador = async (req, res) => {
    const parsedEmpresa = empresaSchema.safeParse(req.body?.empresa);
    if (!parsedEmpresa.success) {
        return res.status(400).json({ message: 'Empresa inválida.' });
    }

    const template = await AsignacionPlantilla.findOne({ empresa: { $eq: parsedEmpresa.data } }).lean();
    return res.status(200).json({ plantilla: serializeTemplate(template, parsedEmpresa.data) });
};

const guardarPlantillaCreador = async (req, res) => {
    const parsedEmpresa = empresaSchema.safeParse(req.body?.empresa);
    if (!parsedEmpresa.success) {
        return res.status(400).json({ message: 'Empresa inválida.' });
    }

    const { errors, template } = await normalizeTemplatePayload(parsedEmpresa.data, req.body?.plantilla);
    if (errors.length) {
        return res.status(400).json({ message: 'La plantilla tiene errores.', errors });
    }

    const updatedTemplate = await AsignacionPlantilla.findOneAndUpdate(
        { empresa: parsedEmpresa.data },
        {
            $set: {
                fixedAssignments: template.fixedAssignments.map((rule) => ({
                    trabajador: rule.trabajadorId,
                    sector: rule.sectorId,
                    tipos: rule.tipos,
                })),
                rotating: {
                    trabajadores: template.rotating.trabajadorIds,
                    rutas: template.rotating.rutaIds,
                    sectores: template.rotating.sectorIds,
                    tipos: template.rotating.tipos,
                },
                leftoverWorkers: template.leftoverWorkers.map((rule) => ({
                    trabajador: rule.trabajadorId,
                    tipos: rule.tipos,
                })),
                restrictions: template.restrictions.map((rule) => ({
                    trabajador: rule.trabajadorId,
                    sectores: rule.sectorIds,
                })),
                updatedBy: req.authUser?._id,
            },
            $setOnInsert: {
                empresa: parsedEmpresa.data,
            },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    return res.status(200).json({
        message: 'Plantilla guardada correctamente.',
        plantilla: serializeTemplate(updatedTemplate, parsedEmpresa.data),
    });
};

const previsualizarCreadorAsignaciones = async (req, res) => {
    const parsed = previewSchema.safeParse(req.body || {});
    if (!parsed.success) {
        return res.status(400).json({ message: 'Datos de previsualización inválidos.' });
    }

    const templateSource = parsed.data.template
        ? parsed.data.template
        : serializeTemplate(
            await AsignacionPlantilla.findOne({ empresa: { $eq: parsed.data.empresa } }).lean(),
            parsed.data.empresa
        );
    const { errors, template } = await normalizeTemplatePayload(parsed.data.empresa, templateSource);
    if (errors.length) {
        return res.status(400).json({ message: 'La plantilla tiene errores.', errors });
    }

    const previewResult = await buildPreview({
        empresa: parsed.data.empresa,
        year: parsed.data.year,
        month: parsed.data.month,
        routeDays: parsed.data.routeDays,
        template,
    });

    if (previewResult.errors.length) {
        return res.status(400).json({ message: 'No se pudo generar la previsualización.', errors: previewResult.errors });
    }

    return res.status(200).json(previewResult.preview);
};

const findExistingAssignment = async (sectorId, fecha, tipo) => {
    const start = dayjs.utc(fecha).startOf('day').toDate();
    const end = dayjs.utc(fecha).endOf('day').toDate();
    return Asignacion.findOne({
        NumeroSector: { $eq: sectorId },
        tipo: { $eq: tipo },
        fecha_asignacion: {
            $gte: start,
            $lte: end,
        },
    });
};

const confirmarCreadorAsignaciones = async (req, res) => {
    const parsed = confirmSchema.safeParse(req.body || {});
    if (!parsed.success) {
        return res.status(400).json({ message: 'Datos de confirmación inválidos.' });
    }

    const [sectores, trabajadores] = await Promise.all([
        Sector.find({ empresa: { $eq: parsed.data.empresa } }).select('_id').lean(),
        Trabajador.find({ cargo: { $ne: 'administracion' } }).select('_id').lean(),
    ]);
    const sectorIds = new Set(sectores.map((sector) => String(sector._id)));
    const workerIds = new Set(trabajadores.map((worker) => String(worker._id)));
    const errors = [];
    const seenKeys = new Set();
    const plans = [];

    for (const [index, assignment] of parsed.data.asignaciones.entries()) {
        const sectorId = normalizeObjectId(assignment.sectorId);
        const trabajadorId = normalizeObjectId(assignment.trabajadorId);
        const fecha = validateMonthDate(
            assignment.fecha,
            dayjs.utc(assignment.fecha).year(),
            dayjs.utc(assignment.fecha).month() + 1,
            `Asignación ${index + 1}`,
            errors
        );

        if (!sectorId || !sectorIds.has(sectorId)) {
            errors.push(`Asignación ${index + 1}: sector inválido para ${parsed.data.empresa}.`);
            continue;
        }
        if (!trabajadorId || !workerIds.has(trabajadorId)) {
            errors.push(`Asignación ${index + 1}: trabajador inválido o no asignable.`);
            continue;
        }
        if (!fecha) continue;

        const key = assignmentKey(sectorId, fecha, assignment.tipo);
        if (seenKeys.has(key)) {
            errors.push(`Asignación ${index + 1}: la propuesta contiene un duplicado.`);
            continue;
        }
        seenKeys.add(key);

        const existing = await findExistingAssignment(sectorId, fecha, assignment.tipo);
        if (existing && !parsed.data.conflictResolutions[key]) {
            errors.push(`Asignación ${index + 1}: conflicto sin resolver.`);
        }

        plans.push({
            key,
            fecha,
            tipo: assignment.tipo,
            sectorId,
            trabajadorId,
            existing,
            resolution: parsed.data.conflictResolutions[key] || null,
        });
    }

    if (errors.length) {
        return res.status(409).json({ message: 'Hay asignaciones que no se pueden guardar.', errors });
    }

    let created = 0;
    let replaced = 0;
    let kept = 0;

    for (const plan of plans) {
        if (plan.existing) {
            if (plan.resolution === 'replace') {
                plan.existing.Trabajador = plan.trabajadorId;
                plan.existing.apoyo = null;
                plan.existing.fecha_asignacion = dayjs.utc(plan.fecha).startOf('day').toDate();
                await plan.existing.save();
                replaced += 1;
            } else {
                kept += 1;
            }
            continue;
        }

        await Asignacion.create({
            _id: new mongoose.Types.ObjectId(),
            apoyo: null,
            NumeroSector: plan.sectorId,
            Trabajador: plan.trabajadorId,
            tipo: plan.tipo,
            fecha_asignacion: dayjs.utc(plan.fecha).startOf('day').toDate(),
        });
        created += 1;
    }

    return res.status(200).json({
        message: `Asignaciones guardadas: ${created} nuevas, ${replaced} reemplazadas, ${kept} existentes mantenidas.`,
        created,
        replaced,
        kept,
    });
};

module.exports = {
    obtenerCatalogoCreador,
    obtenerPlantillaCreador,
    guardarPlantillaCreador,
    previsualizarCreadorAsignaciones,
    confirmarCreadorAsignaciones,
};
