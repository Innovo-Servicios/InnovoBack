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
const {
    ASSIGNMENT_EXCEPTION_REASONS,
    asignacionExcepcion_MongooseModel: AssignmentException,
} = require('../models/asignacionExcepcion.model');
const {
    buildHolidayDateSet,
    getChileanHolidays,
} = require('../utils/chileanHolidays');
const {
    incrementWorkerLoad,
    normalizeAssignmentType,
    normalizeAssignmentTypes,
    pickBalancedWorker,
    serializeCompanyList,
} = require('../utils/asignacionProposal');

dayjs.extend(utc);

const EMPRESAS = ['GasValpo', 'Comercial', 'Energas'];
const EXTRA_ROUTE_DAY_TYPES = ['adelantoVerificacion', 'verificacion'];
const ROUTE_DAY_DATE_FIELDS = Array.from(new Set([...ASSIGNMENT_TYPES, ...EXTRA_ROUTE_DAY_TYPES]));
const buildArchetypeFilter = (values) => ({
    $or: [
        { arquetipo: { $in: values } },
        { arquetipo: { $exists: false }, cargo: { $in: values } },
    ],
});
const ASSIGNABLE_WORKER_FILTER = buildArchetypeFilter(['lector']);
const CATALOG_WORKER_FILTER = buildArchetypeFilter(['administracion', 'lector', 'supervisor', 'inspector']);
const ASSIGNABLE_INSPECTOR_FILTER = buildArchetypeFilter(['inspector']);
const ASSIGNABLE_ASSIGNMENT_FILTER = buildArchetypeFilter(['lector', 'inspector']);
const READER_ASSIGNMENT_TYPES = ['lectura', 'reparto'];
const INSPECTOR_ASSIGNMENT_TYPES = ['adelantoVerificacion', 'verificacion'];

const empresaSchema = z.enum(EMPRESAS);
const idSchema = z.string().trim().min(1);
const assignmentTypeSchema = z.preprocess(
    (value) => normalizeAssignmentType(value),
    z.enum(ASSIGNMENT_TYPES)
);
const tiposSchema = z.array(assignmentTypeSchema).optional();
const monthSchema = z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

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
    bonusGroup: z.object({
        workerIds: z.array(idSchema).default([]),
        sectorIds: z.array(idSchema).default([]),
    }).default({
        workerIds: [],
        sectorIds: [],
    }),
    verificationGroups: z.array(z.object({
        inspectorIds: z.array(idSchema).default([]),
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
    bonusGroup: {
        workerIds: [],
        sectorIds: [],
    },
    verificationGroups: [],
});

const routeDaySchema = z.object({
    rutaId: idSchema.optional(),
    rutaNumero: z.coerce.number().int().optional(),
    ...Object.fromEntries(
        ROUTE_DAY_DATE_FIELDS.map((field) => [field, z.string().trim().optional().nullable()])
    ),
});

const previewSchema = z.object({
    empresa: empresaSchema,
    year: z.coerce.number().int().min(2020).max(2100),
    month: z.coerce.number().int().min(1).max(12),
    routeDays: z.array(routeDaySchema).default([]),
    template: templatePayloadSchema.optional(),
});

const manualPreviewSchema = z.object({
    empresa: empresaSchema,
    asignaciones: z.array(z.object({
        fecha: z.string().trim(),
        tipo: assignmentTypeSchema,
        sectorId: idSchema,
        trabajadorId: idSchema,
    })).default([]),
});

const confirmAssignmentSchema = z.object({
    key: z.string().trim().optional(),
    fecha: z.string().trim(),
    tipo: assignmentTypeSchema,
    sectorId: idSchema,
    trabajadorId: idSchema,
    source: z.string().trim().optional(),
});

const confirmSchema = z.object({
    empresa: empresaSchema,
    asignaciones: z.array(confirmAssignmentSchema).default([]),
    conflictResolutions: z.record(z.string(), z.enum(['keep', 'replace'])).default({}),
});

const proposalCalendarSchema = z.object({
    routeId: idSchema.optional(),
    rutaId: idSchema.optional(),
    routeNumber: z.coerce.number().int().optional(),
    rutaNumero: z.coerce.number().int().optional(),
    lectura: z.string().trim().optional().nullable(),
    adelantoVerificacion: z.string().trim().optional().nullable(),
    verificacion: z.string().trim().optional().nullable(),
    reparto: z.string().trim().optional().nullable(),
});

const exceptionDraftSchema = z.object({
    sectorId: idSchema,
    originalWorkerId: idSchema.optional(),
    replacementWorkerId: idSchema,
    reason: z.enum(ASSIGNMENT_EXCEPTION_REASONS),
    note: z.string().trim().optional().nullable(),
});

const proposalSchema = z.object({
    empresa: empresaSchema,
    month: monthSchema,
    calendar: z.array(proposalCalendarSchema).default([]),
    exceptions: z.array(exceptionDraftSchema).default([]),
});

const saveExceptionsSchema = proposalSchema.pick({
    empresa: true,
    month: true,
    exceptions: true,
});

const normalizeObjectId = (value) => {
    const text = String(value || '').trim();
    return mongoose.isValidObjectId(text) ? text : null;
};

const unique = (values) => Array.from(new Set(values.filter(Boolean)));

const normalizeTipos = (tipos) => {
    return normalizeAssignmentTypes(tipos, ASSIGNMENT_TYPES);
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
    bonusGroup: {
        workerIds: [],
        sectorIds: [],
    },
    verificationGroups: [],
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
        bonusGroup: {
            workerIds: unique((plainTemplate.bonusGroup?.trabajadores || []).map(getPlainId)),
            sectorIds: unique((plainTemplate.bonusGroup?.sectores || []).map(getPlainId)),
        },
        verificationGroups: (plainTemplate.verificationGroups || []).map((group) => ({
            inspectorIds: unique((group.inspectores || []).map(getPlainId)),
            sectorIds: unique((group.sectores || []).map(getPlainId)),
        })).filter((group) => group.inspectorIds.length || group.sectorIds.length),
        updatedAt: plainTemplate.updatedAt || null,
    };
};

const serializeWorker = (worker) => ({
    id: worker?._id ? String(worker._id) : null,
    nombre: worker?.Nombre || 'Sin trabajador',
    rut: worker?.Rut || '',
    cargo: worker?.arquetipo || worker?.cargo || '',
    arquetipo: worker?.arquetipo || worker?.cargo || '',
    empresa: serializeCompanyList(worker?.empresa),
    empresas: serializeCompanyList(worker?.empresa),
});

const serializeSector = (sector) => ({
    id: sector?._id ? String(sector._id) : null,
    nombre: sector?.sector || 'Sin sector',
    numero: sector?.NumeroSector ?? null,
    empresa: sector?.empresa || '',
    rutaId: sector?.NumeroRuta?._id ? String(sector.NumeroRuta._id) : getPlainId(sector?.NumeroRuta),
    rutaNumero: sector?.NumeroRuta?.NumeroRuta ?? null,
});

const buildCompanyWorkerFilter = (empresa, roleFilter = {}) => {
    if (!empresa) return roleFilter;

    return {
        $and: [
            roleFilter,
            {
                $or: [
                    { empresa: { $eq: empresa } },
                    { empresa: { $exists: false } },
                    { empresa: { $size: 0 } },
                ],
            },
        ],
    };
};

const expectedCargoForAssignmentType = (tipo) => {
    if (READER_ASSIGNMENT_TYPES.includes(tipo)) return 'lector';
    if (INSPECTOR_ASSIGNMENT_TYPES.includes(tipo)) return 'inspector';
    return null;
};

const loadCatalogData = async (empresa) => {
    const sectorFilter = empresa ? { empresa: { $eq: empresa } } : {};
    const [sectores, workers, empresasDisponibles] = await Promise.all([
        Sector.find(sectorFilter)
            .populate({ path: 'NumeroRuta', select: 'NumeroRuta' })
            .sort({ NumeroSector: 1 })
            .lean(),
        Trabajador.find(buildCompanyWorkerFilter(empresa, CATALOG_WORKER_FILTER))
            .select('_id Nombre Rut cargo arquetipo correo empresa')
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

    const serializedWorkers = workers.map(serializeWorker);
    const trabajadores = serializedWorkers.filter((worker) => worker.cargo === 'lector');
    const inspectores = serializedWorkers.filter((worker) => worker.cargo === 'inspector');

    return {
        empresas: EMPRESAS.filter((item) => empresasDisponibles.includes(item)),
        rutas: Array.from(routesById.values()).sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0)),
        sectores: sectores.map(serializeSector).sort((a, b) => {
            if ((a.rutaNumero ?? 0) !== (b.rutaNumero ?? 0)) {
                return (a.rutaNumero ?? 0) - (b.rutaNumero ?? 0);
            }
            return (a.numero ?? 0) - (b.numero ?? 0);
        }),
        trabajadores,
        inspectores,
        workers: serializedWorkers,
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

    const [sectores, rutas, trabajadores, inspectores] = await Promise.all([
        Sector.find({ empresa: { $eq: empresa } }).select('_id NumeroRuta').lean(),
        Ruta.find().select('_id NumeroRuta').lean(),
        Trabajador.find(buildCompanyWorkerFilter(empresa, ASSIGNABLE_WORKER_FILTER)).select('_id Nombre Rut cargo arquetipo empresa').lean(),
        Trabajador.find(buildCompanyWorkerFilter(empresa, ASSIGNABLE_INSPECTOR_FILTER)).select('_id Nombre Rut cargo arquetipo empresa').lean(),
    ]);

    const sectorIds = new Set(sectores.map((sector) => String(sector._id)));
    const routeIdsForCompany = new Set(sectores.map((sector) => getPlainId(sector.NumeroRuta)).filter(Boolean));
    const allRouteIds = new Set(rutas.map((ruta) => String(ruta._id)));
    const workerIds = new Set(trabajadores.map((worker) => String(worker._id)));
    const inspectorIds = new Set(inspectores.map((worker) => String(worker._id)));
    const errors = [];

    const requireWorker = (value, label) => {
        const id = normalizeObjectId(value);
        if (!id || !workerIds.has(id)) errors.push(`${label}: trabajador no válido o no asignable.`);
        return id;
    };
    const requireInspector = (value, label) => {
        const id = normalizeObjectId(value);
        if (!id || !inspectorIds.has(id)) errors.push(`${label}: inspector no válido para ${empresa}.`);
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

    const bonusGroup = {
        workerIds: unique(parsed.data.bonusGroup.workerIds.map((id, index) =>
            requireWorker(id, `Bono trabajador ${index + 1}`)
        )),
        sectorIds: unique(parsed.data.bonusGroup.sectorIds.map((id, index) =>
            requireSector(id, `Bono sector ${index + 1}`)
        )),
    };

    const verificationGroups = parsed.data.verificationGroups.map((group, groupIndex) => ({
        inspectorIds: unique(group.inspectorIds.map((id, index) =>
            requireInspector(id, `Verificación ${groupIndex + 1} inspector ${index + 1}`)
        )),
        sectorIds: unique(group.sectorIds.map((id, index) =>
            requireSector(id, `Verificación ${groupIndex + 1} sector ${index + 1}`)
        )),
    })).filter((group) => group.inspectorIds.length || group.sectorIds.length);

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
            bonusGroup,
            verificationGroups,
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

const extractYearFromDateText = (value) => {
    const dateText = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return null;

    const parsed = dayjs.utc(dateText);
    return parsed.isValid() ? parsed.year() : null;
};

const loadHolidayDateSetForYear = async (year) => {
    const { holidays } = await getChileanHolidays(year);

    return buildHolidayDateSet(holidays);
};

const loadHolidayDateSetsForYears = async (years) => {
    const validYears = unique(years.filter((year) => Number.isInteger(year)));
    const entries = await Promise.all(
        validYears.map(async (year) => [year, await loadHolidayDateSetForYear(year)])
    );

    return new Map(entries);
};

const getHolidayDateSetForDate = (dateText, holidayDateSetsByYear) => {
    const year = extractYearFromDateText(dateText);

    return year ? holidayDateSetsByYear.get(year) || new Set() : new Set();
};

const validateMonthDate = (value, year, month, label, errors, holidayDates = new Set()) => {
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

    const normalizedDate = parsed.format('YYYY-MM-DD');
    if (holidayDates.has(normalizedDate)) {
        errors.push(`${label}: cae en feriado chileno.`);
        return null;
    }

    return normalizedDate;
};

const buildRouteDaysMap = (routeDays, routes, year, month, holidayDates) => {
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

        map.set(route.id, Object.fromEntries(
            ROUTE_DAY_DATE_FIELDS.map((field) => [
                field,
                validateMonthDate(day[field], year, month, `Ruta ${route.numero} ${field}`, errors, holidayDates),
            ])
        ));
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
        .populate({ path: 'Trabajador', select: 'Nombre Rut cargo arquetipo empresa' })
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
            ...Object.fromEntries(ASSIGNMENT_TYPES.map((tipo) => [tipo, 0])),
            fija: 0,
            rotativa: 0,
            restante: 0,
            manual: 0,
        };
        current.total += 1;
        current[row.tipo] = (current[row.tipo] || 0) + 1;
        if (typeof current[row.source] === 'number') {
            current[row.source] += 1;
        }
        map.set(key, current);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
};

const buildPreview = async ({ empresa, year, month, routeDays, template }) => {
    const catalog = await loadCatalogData(empresa);
    let holidayDates;

    try {
        holidayDates = await loadHolidayDateSetForYear(year);
    } catch (error) {
        return { errors: ['No se pudieron cargar los feriados chilenos. Intenta nuevamente.'] };
    }

    const { map: routeDaysMap, errors: routeDayErrors } = buildRouteDaysMap(
        routeDays,
        catalog.rutas,
        year,
        month,
        holidayDates
    );
    if (routeDayErrors.length) {
        return { errors: routeDayErrors };
    }

    const workersById = new Map(catalog.trabajadores.map((worker) => [worker.id, worker]));
    const restrictionMap = buildRestrictionMap(template.restrictions);
    const loadByType = new Map(ASSIGNMENT_TYPES.map((tipo) => [tipo, new Map()]));
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
                incrementWorkerLoad(loadByType.get(tipo), workerId);
            } else if (isInRotatingScope(template, sector, tipo)) {
                source = 'rotativa';
                const candidates = template.rotating.trabajadorIds.filter((id) =>
                    workersById.has(id) && !isWorkerBlocked(restrictionMap, id, sector.id)
                );
                workerId = pickBalancedWorker({
                    candidateIds: candidates,
                    workersById,
                    loadByWorker: loadByType.get(tipo),
                });
            } else {
                const candidates = template.leftoverWorkers
                    .filter((rule) => rule.tipos.includes(tipo))
                    .map((rule) => rule.trabajadorId)
                    .filter((id) => workersById.has(id) && !isWorkerBlocked(restrictionMap, id, sector.id));
                workerId = pickBalancedWorker({
                    candidateIds: candidates,
                    workersById,
                    loadByWorker: loadByType.get(tipo),
                });
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

const validateAssignmentDate = (value, label, errors, holidayDates = new Set()) => {
    const dateText = String(value || '').trim();
    if (!dateText || !/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
        errors.push(`${label}: fecha inválida.`);
        return null;
    }

    const parsed = dayjs.utc(dateText);
    if (!parsed.isValid() || parsed.format('YYYY-MM-DD') !== dateText) {
        errors.push(`${label}: fecha inválida.`);
        return null;
    }

    const normalizedDate = parsed.format('YYYY-MM-DD');
    if (holidayDates.has(normalizedDate)) {
        errors.push(`${label}: cae en feriado chileno.`);
        return null;
    }

    return normalizedDate;
};

const buildManualPreview = async ({ empresa, asignaciones }) => {
    const catalog = await loadCatalogData(empresa);
    const sectorById = new Map(catalog.sectores.map((sector) => [sector.id, sector]));
    const workerById = new Map(
        catalog.workers
            .filter((worker) => ['lector', 'inspector'].includes(worker.cargo))
            .map((worker) => [worker.id, worker])
    );
    const errors = [];
    const seenKeys = new Set();
    const seenWorkerDates = new Set();
    const rows = [];
    let holidayDateSetsByYear = new Map();

    if (!asignaciones.length) {
        errors.push('Agrega al menos una asignación manual.');
    }

    try {
        holidayDateSetsByYear = await loadHolidayDateSetsForYears(
            asignaciones.map((assignment) => extractYearFromDateText(assignment.fecha))
        );
    } catch (error) {
        return { errors: ['No se pudieron cargar los feriados chilenos. Intenta nuevamente.'] };
    }

    for (const [index, assignment] of asignaciones.entries()) {
        const label = `Asignación manual ${index + 1}`;
        const sectorId = normalizeObjectId(assignment.sectorId);
        const trabajadorId = normalizeObjectId(assignment.trabajadorId);
        const fecha = validateAssignmentDate(
            assignment.fecha,
            label,
            errors,
            getHolidayDateSetForDate(assignment.fecha, holidayDateSetsByYear)
        );

        if (!sectorId || !sectorById.has(sectorId)) {
            errors.push(`${label}: sector inválido para ${empresa}.`);
        }
        const selectedWorker = trabajadorId ? workerById.get(trabajadorId) : null;
        const expectedCargo = expectedCargoForAssignmentType(assignment.tipo);
        if (!selectedWorker || selectedWorker.cargo !== expectedCargo) {
            errors.push(`${label}: trabajador inválido para ${assignment.tipo}.`);
        }
        if (!fecha || !sectorId || !trabajadorId || !sectorById.has(sectorId) || !selectedWorker || selectedWorker.cargo !== expectedCargo) {
            continue;
        }

        const key = assignmentKey(sectorId, fecha, assignment.tipo);
        if (seenKeys.has(key)) {
            errors.push(`${label}: la lista contiene un duplicado para el mismo sector, fecha y tipo.`);
            continue;
        }
        seenKeys.add(key);

        const workerDateKey = `${trabajadorId}:${fecha}`;
        if (seenWorkerDates.has(workerDateKey)) {
            errors.push(`${label}: el trabajador ya está seleccionado en otra asignación del mismo día.`);
            continue;
        }
        seenWorkerDates.add(workerDateKey);

        rows.push({
            key,
            fecha,
            tipo: assignment.tipo,
            source: 'manual',
            trabajador: workerById.get(trabajadorId),
            sector: sectorById.get(sectorId),
            conflicto: null,
        });
    }

    if (errors.length) {
        return { errors };
    }

    for (const [index, row] of rows.entries()) {
        const existingWorkerAssignments = await findExistingWorkerAssignmentsOnDate(row.trabajador.id, row.fecha);
        const hasBlockingAssignment = existingWorkerAssignments.some((assignment) => {
            const existingSectorId = getPlainId(assignment.NumeroSector);
            return existingSectorId !== row.sector.id || assignment.tipo !== row.tipo;
        });

        if (hasBlockingAssignment) {
            errors.push(`Asignación manual ${index + 1}: ${row.trabajador.nombre} ya tiene una asignación el ${row.fecha}.`);
        }
    }

    if (errors.length) {
        return { errors };
    }

    const rowsWithConflicts = [];
    for (const row of rows) {
        const existing = await findExistingAssignment(row.sector.id, row.fecha, row.tipo);
        rowsWithConflicts.push(existing ? {
            ...row,
            conflicto: {
                asignacionId: String(existing._id),
                trabajador: serializeWorker(existing.Trabajador),
                apoyo: Boolean(existing.apoyo),
            },
        } : row);
    }

    return {
        errors: [],
        preview: {
            empresa,
            generatedAt: new Date().toISOString(),
            resumen: {
                total: rowsWithConflicts.length,
                nuevas: rowsWithConflicts.filter((row) => !row.conflicto).length,
                conflictos: rowsWithConflicts.filter((row) => row.conflicto).length,
                omitidas: 0,
                lectura: rowsWithConflicts.filter((row) => row.tipo === 'lectura').length,
                reparto: rowsWithConflicts.filter((row) => row.tipo === 'reparto').length,
            },
            porTrabajador: buildWorkerSummary(rowsWithConflicts),
            asignaciones: rowsWithConflicts,
            omitidas: [],
        },
    };
};

const parseMonthParts = (month) => {
    const parsed = dayjs.utc(`${month}-01`);

    return {
        year: parsed.year(),
        month: parsed.month() + 1,
    };
};

const normalizeCalendarPayload = (calendar) => (calendar || []).map((route) => ({
    rutaId: route.routeId || route.rutaId,
    rutaNumero: route.routeNumber || route.rutaNumero,
    lectura: route.lectura,
    adelantoVerificacion: route.adelantoVerificacion,
    verificacion: route.verificacion,
    reparto: route.reparto,
}));

const serializeRules = (template, empresa) => {
    const plainTemplate = typeof template?.toObject === 'function' ? template.toObject() : template;
    const serialized = serializeTemplate(plainTemplate, empresa);

    return {
        id: plainTemplate?._id ? String(plainTemplate._id) : null,
        empresa,
        fixedSectors: serialized.fixedAssignments.map((rule) => ({
            sectorId: rule.sectorId,
            workerId: rule.trabajadorId,
            tipos: rule.tipos,
        })),
        bonusGroup: serialized.bonusGroup,
        verificationGroups: serialized.verificationGroups,
        legacyTemplate: serialized,
    };
};

const serializeAssignmentException = (exception) => ({
    id: exception?._id ? String(exception._id) : null,
    empresa: exception?.empresa || '',
    month: exception?.month || '',
    sectorId: getPlainId(exception?.sector) || exception?.sectorId || null,
    sectorName: exception?.sector?.sector || null,
    sectorNumber: exception?.sector?.NumeroSector ?? null,
    originalWorkerId: getPlainId(exception?.originalWorker) || exception?.originalWorkerId || null,
    originalWorkerName: exception?.originalWorker?.Nombre || null,
    replacementWorkerId: getPlainId(exception?.replacementWorker) || exception?.replacementWorkerId || null,
    replacementWorkerName: exception?.replacementWorker?.Nombre || null,
    reason: exception?.reason || '',
    note: exception?.note || '',
});

const loadSavedExceptions = async (empresa, month) => {
    if (!empresa || !month) return [];

    return AssignmentException.find({ empresa: { $eq: empresa }, month: { $eq: month } })
        .populate({ path: 'sector', select: 'sector NumeroSector NumeroRuta empresa' })
        .populate({ path: 'originalWorker', select: 'Nombre Rut cargo arquetipo empresa' })
        .populate({ path: 'replacementWorker', select: 'Nombre Rut cargo arquetipo empresa' })
        .sort({ createdAt: 1 })
        .lean();
};

const normalizeExceptionDrafts = ({ empresa, month, exceptions, sectorById, readerById }) => {
    const errors = [];
    const normalized = [];
    const seenSectors = new Set();

    for (const [index, exception] of (exceptions || []).entries()) {
        const label = `Excepción ${index + 1}`;
        const sectorId = normalizeObjectId(exception.sectorId);
        const replacementWorkerId = normalizeObjectId(exception.replacementWorkerId);
        const originalWorkerId = exception.originalWorkerId ? normalizeObjectId(exception.originalWorkerId) : null;

        if (!sectorId || !sectorById.has(sectorId)) {
            errors.push(`${label}: sector inválido para ${empresa}.`);
            continue;
        }
        if (seenSectors.has(sectorId)) {
            errors.push(`${label}: ya existe una excepción para el mismo sector.`);
            continue;
        }
        if (!replacementWorkerId || !readerById.has(replacementWorkerId)) {
            errors.push(`${label}: trabajador reemplazante inválido para ${empresa}.`);
            continue;
        }
        if (originalWorkerId && !readerById.has(originalWorkerId)) {
            errors.push(`${label}: trabajador original inválido para ${empresa}.`);
            continue;
        }

        seenSectors.add(sectorId);
        normalized.push({
            id: null,
            empresa,
            month,
            sectorId,
            originalWorkerId,
            replacementWorkerId,
            reason: exception.reason,
            note: String(exception.note || '').trim(),
        });
    }

    return { errors, exceptions: normalized };
};

const normalizeSavedExceptions = (exceptions) => (exceptions || []).map((exception) => ({
    ...serializeAssignmentException(exception),
    sectorId: getPlainId(exception.sector),
    originalWorkerId: getPlainId(exception.originalWorker),
    replacementWorkerId: getPlainId(exception.replacementWorker),
}));

const mergeExceptionsBySector = (savedExceptions, draftExceptions) => {
    const map = new Map();

    for (const exception of savedExceptions || []) {
        if (exception.sectorId) {
            map.set(exception.sectorId, exception);
        }
    }
    for (const exception of draftExceptions || []) {
        if (exception.sectorId) {
            map.set(exception.sectorId, exception);
        }
    }

    return map;
};

const findFixedReaderRule = (template, sectorId) =>
    template.fixedAssignments.find((rule) =>
        rule.sectorId === sectorId && rule.tipos.some((tipo) => READER_ASSIGNMENT_TYPES.includes(tipo))
    );

const buildFreeReaderCandidates = (template, readers, sector) => {
    const configuredReaders = template.rotating.trabajadorIds.length
        ? template.rotating.trabajadorIds
        : readers.map((reader) => reader.id);

    if (!template.rotating.rutaIds.length && !template.rotating.sectorIds.length) {
        return configuredReaders;
    }

    if (template.rotating.sectorIds.includes(sector.id) || template.rotating.rutaIds.includes(sector.rutaId)) {
        return configuredReaders;
    }

    const leftoverReaders = template.leftoverWorkers.map((rule) => rule.trabajadorId);
    return leftoverReaders.length ? leftoverReaders : configuredReaders;
};

const buildMonthlyAssignmentProposal = async ({ empresa, month, calendar, exceptions }) => {
    const { year, month: monthNumber } = parseMonthParts(month);
    const [catalog, templateDoc, savedExceptions] = await Promise.all([
        loadCatalogData(empresa),
        AsignacionPlantilla.findOne({ empresa: { $eq: empresa } }).lean(),
        loadSavedExceptions(empresa, month),
    ]);

    const templateSource = serializeTemplate(templateDoc, empresa);
    const { errors: templateErrors, template } = await normalizeTemplatePayload(empresa, templateSource);
    const errors = [...templateErrors];
    const warnings = [];
    let holidayDates = new Set();

    try {
        holidayDates = await loadHolidayDateSetForYear(year);
    } catch (error) {
        errors.push('No se pudieron cargar los feriados chilenos. Intenta nuevamente.');
    }

    const { map: routeDaysMap, errors: routeDayErrors } = buildRouteDaysMap(
        normalizeCalendarPayload(calendar),
        catalog.rutas,
        year,
        monthNumber,
        holidayDates
    );
    errors.push(...routeDayErrors);

    const sectorById = new Map(catalog.sectores.map((sector) => [sector.id, sector]));
    const readerById = new Map(catalog.trabajadores.map((worker) => [worker.id, worker]));
    const inspectorById = new Map(catalog.inspectores.map((worker) => [worker.id, worker]));
    const workerById = new Map(catalog.workers.map((worker) => [worker.id, worker]));
    const { errors: exceptionErrors, exceptions: draftExceptions } = normalizeExceptionDrafts({
        empresa,
        month,
        exceptions,
        sectorById,
        readerById,
    });
    errors.push(...exceptionErrors);

    const exceptionBySector = mergeExceptionsBySector(
        normalizeSavedExceptions(savedExceptions),
        draftExceptions
    );
    const restrictionMap = buildRestrictionMap(template.restrictions);
    const readerLoad = new Map();
    const inspectorLoad = new Map();
    const existingMap = await buildExistingAssignmentsMap(catalog.sectores.map((sector) => sector.id), year, monthNumber);
    const routes = [];
    const assignments = [];
    const summary = {
        totalSectors: 0,
        fixed: 0,
        bonus: 0,
        free: 0,
        exceptions: 0,
        inspectors: 0,
        totalAssignments: 0,
        conflicts: 0,
    };

    for (const route of catalog.rutas) {
        const routeSectors = catalog.sectores.filter((sector) => sector.rutaId === route.id);
        if (!routeSectors.length) continue;

        const calendarForRoute = routeDaysMap.get(route.id) || Object.fromEntries(
            ROUTE_DAY_DATE_FIELDS.map((field) => [field, null])
        );

        if (!routeDaysMap.has(route.id)) {
            warnings.push(`Ruta ${route.numero}: no tiene calendario configurado.`);
        }

        const sectorRows = [];
        for (const sector of routeSectors) {
            const exception = exceptionBySector.get(sector.id) || null;
            let source = 'free_rotation';
            let readerId = null;
            let exceptionReason = null;

            if (exception) {
                source = 'exception';
                readerId = exception.replacementWorkerId;
                exceptionReason = exception.reason;
                if (readerById.has(readerId)) {
                    incrementWorkerLoad(readerLoad, readerId);
                } else {
                    errors.push(`Sector ${sector.numero}: excepción con reemplazante inválido.`);
                }
            } else {
                const fixedRule = findFixedReaderRule(template, sector.id);
                if (fixedRule && readerById.has(fixedRule.trabajadorId) && !isWorkerBlocked(restrictionMap, fixedRule.trabajadorId, sector.id)) {
                    source = 'fixed';
                    readerId = fixedRule.trabajadorId;
                    incrementWorkerLoad(readerLoad, readerId);
                } else if (template.bonusGroup.sectorIds.includes(sector.id)) {
                    source = 'bonus';
                    const candidates = template.bonusGroup.workerIds.filter((id) =>
                        readerById.has(id) && !isWorkerBlocked(restrictionMap, id, sector.id)
                    );
                    readerId = pickBalancedWorker({ candidateIds: candidates, workersById: readerById, loadByWorker: readerLoad });
                } else {
                    const candidates = buildFreeReaderCandidates(template, catalog.trabajadores, sector)
                        .filter((id) => readerById.has(id) && !isWorkerBlocked(restrictionMap, id, sector.id));
                    readerId = pickBalancedWorker({ candidateIds: candidates, workersById: readerById, loadByWorker: readerLoad });
                }
            }

            if (!readerId || !readerById.has(readerId)) {
                errors.push(`Sector ${sector.numero}: no hay lector disponible para la regla ${source}.`);
            }

            const verificationGroup = template.verificationGroups.find((group) => group.sectorIds.includes(sector.id));
            const inspectorId = verificationGroup
                ? pickBalancedWorker({
                    candidateIds: verificationGroup.inspectorIds.filter((id) => inspectorById.has(id)),
                    workersById: inspectorById,
                    loadByWorker: inspectorLoad,
                })
                : null;

            if (inspectorId) {
                summary.inspectors += 1;
            } else if (calendarForRoute.adelantoVerificacion || calendarForRoute.verificacion) {
                warnings.push(`Sector ${sector.numero}: no tiene inspector de verificación asignado.`);
            }

            const sectorRow = {
                sectorId: sector.id,
                sectorName: sector.nombre,
                sectorNumber: sector.numero,
                reader: readerId && readerById.has(readerId) ? {
                    id: readerId,
                    nombre: readerById.get(readerId).nombre,
                } : null,
                inspector: inspectorId ? {
                    id: inspectorId,
                    nombre: inspectorById.get(inspectorId).nombre,
                } : null,
                source,
                exceptionReason,
            };
            sectorRows.push(sectorRow);
            summary.totalSectors += 1;
            if (source === 'fixed') summary.fixed += 1;
            if (source === 'bonus') summary.bonus += 1;
            if (source === 'free_rotation') summary.free += 1;
            if (source === 'exception') summary.exceptions += 1;

            const pushAssignment = ({ tipo, fecha, workerId, role }) => {
                if (!fecha || !workerId || !workerById.has(workerId)) return;
                const key = assignmentKey(sector.id, fecha, tipo);
                const existing = existingMap.get(key);
                const row = {
                    key,
                    fecha,
                    tipo,
                    sectorId: sector.id,
                    trabajadorId: workerId,
                    source,
                    role,
                    conflicto: existing ? {
                        asignacionId: String(existing._id),
                        trabajador: serializeWorker(existing.Trabajador),
                        apoyo: Boolean(existing.apoyo),
                    } : null,
                };
                assignments.push(row);
            };

            for (const tipo of READER_ASSIGNMENT_TYPES) {
                pushAssignment({ tipo, fecha: calendarForRoute[tipo], workerId: readerId, role: 'reader' });
            }
            for (const tipo of INSPECTOR_ASSIGNMENT_TYPES) {
                pushAssignment({ tipo, fecha: calendarForRoute[tipo], workerId: inspectorId, role: 'inspector' });
            }
        }

        routes.push({
            routeId: route.id,
            routeNumber: route.numero ?? null,
            calendar: {
                lectura: calendarForRoute.lectura,
                adelantoVerificacion: calendarForRoute.adelantoVerificacion,
                verificacion: calendarForRoute.verificacion,
                reparto: calendarForRoute.reparto,
            },
            sectors: sectorRows,
        });
    }

    summary.totalAssignments = assignments.length;
    summary.conflicts = assignments.filter((assignment) => assignment.conflicto).length;

    return {
        empresa,
        month,
        routes,
        assignments,
        rules: serializeRules(templateDoc, empresa),
        exceptions: Array.from(exceptionBySector.values()),
        summary,
        errors,
        warnings,
    };
};

const obtenerCatalogoCreador = async (req, res) => {
    try {
        const source = req.method === 'GET' ? req.query : req.body;
        const empresa = source?.empresa ? empresaSchema.parse(source.empresa) : null;
        const month = source?.month ? monthSchema.parse(source.month) : null;
        const catalog = await loadCatalogData(empresa);
        const template = empresa
            ? await AsignacionPlantilla.findOne({ empresa: { $eq: empresa } }).lean()
            : null;
        const exceptions = empresa && month
            ? await loadSavedExceptions(empresa, month)
            : [];

        return res.status(200).json({
            ...catalog,
            routes: catalog.rutas,
            sectors: catalog.sectores,
            rules: empresa ? serializeRules(template, empresa) : null,
            exceptions: exceptions.map(serializeAssignmentException),
            month,
        });
    } catch (error) {
        return res.status(400).json({ message: 'No se pudo obtener el catálogo de asignaciones.' });
    }
};

const generarPropuestaCreador = async (req, res) => {
    const parsed = proposalSchema.safeParse(req.body || {});
    if (!parsed.success) {
        return res.status(400).json({ message: 'Datos de propuesta inválidos.' });
    }

    try {
        const proposal = await buildMonthlyAssignmentProposal(parsed.data);
        return res.status(200).json(proposal);
    } catch (error) {
        console.error('Error al generar propuesta de asignaciones:', error.message);
        return res.status(500).json({ message: 'No se pudo generar la propuesta de asignaciones.' });
    }
};

const guardarExcepcionesCreador = async (req, res) => {
    const parsed = saveExceptionsSchema.safeParse(req.body || {});
    if (!parsed.success) {
        return res.status(400).json({ message: 'Datos de excepciones inválidos.' });
    }

    try {
        const catalog = await loadCatalogData(parsed.data.empresa);
        const sectorById = new Map(catalog.sectores.map((sector) => [sector.id, sector]));
        const readerById = new Map(catalog.trabajadores.map((worker) => [worker.id, worker]));
        const { errors, exceptions } = normalizeExceptionDrafts({
            empresa: parsed.data.empresa,
            month: parsed.data.month,
            exceptions: parsed.data.exceptions,
            sectorById,
            readerById,
        });

        if (errors.length) {
            return res.status(400).json({ message: 'Las excepciones tienen errores.', errors });
        }

        const sectorIds = exceptions.map((exception) => exception.sectorId);
        await AssignmentException.deleteMany({
            empresa: parsed.data.empresa,
            month: parsed.data.month,
            ...(sectorIds.length ? { sector: { $nin: sectorIds } } : {}),
        });

        if (exceptions.length) {
            await AssignmentException.bulkWrite(exceptions.map((exception) => {
                const update = {
                    $set: {
                        replacementWorker: exception.replacementWorkerId,
                        reason: exception.reason,
                        note: exception.note,
                        updatedBy: req.authUser?._id,
                    },
                    $setOnInsert: {
                        empresa: parsed.data.empresa,
                        month: parsed.data.month,
                        sector: exception.sectorId,
                    },
                };

                if (exception.originalWorkerId) {
                    update.$set.originalWorker = exception.originalWorkerId;
                } else {
                    update.$unset = { originalWorker: '' };
                }

                return {
                    updateOne: {
                        filter: {
                            empresa: parsed.data.empresa,
                            month: parsed.data.month,
                            sector: exception.sectorId,
                        },
                        update,
                        upsert: true,
                    },
                };
            }));
        }

        const saved = await loadSavedExceptions(parsed.data.empresa, parsed.data.month);
        return res.status(200).json({
            message: 'Excepciones guardadas correctamente.',
            exceptions: saved.map(serializeAssignmentException),
        });
    } catch (error) {
        console.error('Error al guardar excepciones de asignación:', error.message);
        return res.status(500).json({ message: 'No se pudieron guardar las excepciones.' });
    }
};

const obtenerFeriadosChilenos = async (req, res) => {
    const year = Number(req.params?.year);

    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
        return res.status(400).json({ message: 'Año de feriados inválido.' });
    }

    try {
        const result = await getChileanHolidays(year);
        return res.status(200).json(result);
    } catch (error) {
        return res.status(502).json({
            message: 'No se pudieron cargar los feriados chilenos.',
        });
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
                bonusGroup: {
                    trabajadores: template.bonusGroup.workerIds,
                    sectores: template.bonusGroup.sectorIds,
                },
                verificationGroups: template.verificationGroups.map((group) => ({
                    inspectores: group.inspectorIds,
                    sectores: group.sectorIds,
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

const previsualizarAsignacionesManuales = async (req, res) => {
    const parsed = manualPreviewSchema.safeParse(req.body || {});
    if (!parsed.success) {
        return res.status(400).json({ message: 'Datos de previsualización manual inválidos.' });
    }

    const previewResult = await buildManualPreview(parsed.data);
    if (previewResult.errors.length) {
        return res.status(400).json({
            message: 'No se pudo generar la previsualización manual.',
            errors: previewResult.errors,
        });
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
    }).populate({ path: 'Trabajador', select: 'Nombre Rut cargo arquetipo empresa' });
};

const findExistingWorkerAssignmentsOnDate = async (trabajadorId, fecha) => {
    const start = dayjs.utc(fecha).startOf('day').toDate();
    const end = dayjs.utc(fecha).endOf('day').toDate();
    return Asignacion.find({
        Trabajador: { $eq: trabajadorId },
        fecha_asignacion: {
            $gte: start,
            $lte: end,
        },
    }).select('_id NumeroSector tipo fecha_asignacion').lean();
};

const confirmarCreadorAsignaciones = async (req, res) => {
    const parsed = confirmSchema.safeParse(req.body || {});
    if (!parsed.success) {
        return res.status(400).json({ message: 'Datos de confirmación inválidos.' });
    }

    let holidayDateSetsByYear;
    try {
        holidayDateSetsByYear = await loadHolidayDateSetsForYears(
            parsed.data.asignaciones.map((assignment) => extractYearFromDateText(assignment.fecha))
        );
    } catch (error) {
        return res.status(502).json({
            message: 'No se pudieron cargar los feriados chilenos.',
            errors: ['No se pudieron validar los feriados chilenos. Intenta nuevamente.'],
        });
    }

    const [sectores, trabajadores] = await Promise.all([
        Sector.find({ empresa: { $eq: parsed.data.empresa } }).select('_id').lean(),
        Trabajador.find(buildCompanyWorkerFilter(parsed.data.empresa, ASSIGNABLE_ASSIGNMENT_FILTER)).select('_id cargo arquetipo').lean(),
    ]);
    const sectorIds = new Set(sectores.map((sector) => String(sector._id)));
    const workerById = new Map(trabajadores.map((worker) => [String(worker._id), worker]));
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
            errors,
            getHolidayDateSetForDate(assignment.fecha, holidayDateSetsByYear)
        );

        if (!sectorId || !sectorIds.has(sectorId)) {
            errors.push(`Asignación ${index + 1}: sector inválido para ${parsed.data.empresa}.`);
            continue;
        }
        const selectedWorker = trabajadorId ? workerById.get(trabajadorId) : null;
        const expectedCargo = expectedCargoForAssignmentType(assignment.tipo);
        if (!selectedWorker || (selectedWorker.arquetipo || selectedWorker.cargo) !== expectedCargo) {
            errors.push(`Asignación ${index + 1}: trabajador inválido para ${assignment.tipo}.`);
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
    obtenerFeriadosChilenos,
    obtenerPlantillaCreador,
    generarPropuestaCreador,
    guardarExcepcionesCreador,
    guardarPlantillaCreador,
    previsualizarCreadorAsignaciones,
    previsualizarAsignacionesManuales,
    confirmarCreadorAsignaciones,
};
