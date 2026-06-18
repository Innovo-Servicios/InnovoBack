const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const { z } = require('zod');
const { asignacion_MongooseModel: Asignacion } = require('../models/asignacion.model.js');
const { sector_MongooseModel: Sector } = require('../models/sector.model.js');
const {
    buildAssignmentProgramWorkbook,
} = require('../utils/asignacionProgramacionExport.js');

dayjs.extend(utc);

const EMPRESAS = ['GasValpo', 'Comercial', 'Energas'];

const exportProgramacionSchema = z.object({
    empresa: z.enum(EMPRESAS).optional(),
    month: z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
    zonal: z.string().trim().max(20).optional(),
});

const getRequestSource = (req) => (req.method === 'GET' ? req.query : req.body);

const parseExportParams = (req) => {
    const parsed = exportProgramacionSchema.safeParse(getRequestSource(req) || {});
    if (!parsed.success) {
        return { error: 'Parámetros de exportación inválidos.' };
    }

    return {
        params: {
            empresa: parsed.data.empresa,
            month: parsed.data.month || dayjs.utc().format('YYYY-MM'),
            zonal: parsed.data.zonal || '4',
        },
    };
};

const getMonthRange = (month) => {
    const start = dayjs.utc(`${month}-01`).startOf('month');
    return {
        start: start.toDate(),
        end: start.endOf('month').toDate(),
    };
};

const loadSectorIdsForCompany = async (empresa) => {
    if (!empresa) return null;

    const sectors = await Sector.find({ empresa: { $eq: empresa } }).select('_id').lean();
    return sectors.map((sector) => sector._id);
};

const loadAssignmentsForProgramacionExport = async ({ empresa, month }) => {
    const { start, end } = getMonthRange(month);
    const sectorIds = await loadSectorIdsForCompany(empresa);

    if (sectorIds && !sectorIds.length) {
        return [];
    }

    return Asignacion.find({
        fecha_asignacion: {
            $gte: start,
            $lte: end,
        },
        ...(sectorIds ? { NumeroSector: { $in: sectorIds } } : {}),
    })
        .populate({
            path: 'Trabajador',
            select: 'Nombre Rut cargo ID empresa',
        })
        .populate({
            path: 'NumeroSector',
            select: 'sector NumeroSector NumeroRuta empresa',
            populate: {
                path: 'NumeroRuta',
                select: 'NumeroRuta',
            },
        })
        .sort({ fecha_asignacion: 1, tipo: 1 })
        .lean();
};

const buildContentDisposition = (fileName) => {
    const safeName = fileName.replace(/["\r\n]/g, '');
    return `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
};

const exportarProgramacionAsignaciones = async (req, res) => {
    const { params, error } = parseExportParams(req);
    if (error) {
        return res.status(400).json({ message: error });
    }

    try {
        const assignments = await loadAssignmentsForProgramacionExport(params);
        const { workbook, fileName } = buildAssignmentProgramWorkbook({
            assignments,
            empresa: params.empresa,
            month: params.month,
            zonal: params.zonal,
        });
        const buffer = await workbook.xlsx.writeBuffer();

        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader('Content-Disposition', buildContentDisposition(fileName));
        res.setHeader('Content-Length', Buffer.byteLength(buffer));

        return res.status(200).send(Buffer.from(buffer));
    } catch (exportError) {
        console.error('Error al exportar programación de asignaciones:', exportError.message);
        return res.status(500).json({ message: 'No se pudo exportar la programación de asignaciones.' });
    }
};

module.exports = {
    exportarProgramacionAsignaciones,
    loadAssignmentsForProgramacionExport,
};
