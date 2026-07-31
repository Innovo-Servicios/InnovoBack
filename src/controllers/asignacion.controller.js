const mongoose = require('mongoose');
const { sector_MongooseModel: SECTOR } = require('../models/sector.model');
const {
    trabajador_MongooseModel: trabajador,
} = require('../models/trabajador.model.js');
const {
    asignacion_MongooseModel: Asignacion,
} = require('../models/asignacion.model.js');
const { ruta_MongooseModel: RUTA } = require('../models/ruta.model.js');
const { apoyo_MongooseModel } = require('../models/apoyo.model.js');
const {direccion_MongooseModel}= require('../models/direccion.model.js')
const {ate_MongooseModel}= require('../models/ATE.model.js')
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const { getAuthRut } = require('../utils/security.js');

dayjs.extend(utc);

const asignarsector = async (req, res) => {
    if (req.authUser) {
        const { trabajadorRut, sectorNumero, apoyoRut, tipo, fechaconsulta } =
            req.body;
        try {
            const nombreTrabajador = await trabajador.findOne({
                Rut: { $eq: String(trabajadorRut) },
            });
            if (!nombreTrabajador) {
                return res.status(404).send('Trabajador no encontrado');
            }

            const sector = await SECTOR.findOne({ NumeroSector: { $eq: Number(sectorNumero) } });
            if (!sector) {
                return res.status(404).send('Sector no encontrado');
            }

            const apoyo = apoyoRut
                ? await trabajador.findOne({ Rut: { $eq: String(apoyoRut) } })._id
                : null;

            const asignacionExiste = await Asignacion.findOne({
                NumeroSector: { $eq: sector._id },
                Trabajador: { $eq: nombreTrabajador._id },
                fecha_asignacion: { $eq: fechaconsulta },
                tipo: { $eq: String(tipo) },
            });
            if (asignacionExiste) {
                return res.status(400).send('Sector ya asignado');
            }

            // console.log('otra fecha: ', dayjs(fechaconsulta).toDate());
            // Usar la fecha proporcionada directamente sin modificarla
            const fecha = fechaconsulta
                ? dayjs(fechaconsulta).format('YYYY-MM-DD')
                : new Date();
            // console.log('Fecha', fecha);

            // apoyo es un elemento opcional, si no se proporciona, se asigna null
            const asignacion = new Asignacion({
                _id: new mongoose.Types.ObjectId(),
                fecha_asignacion: fecha,
                apoyo: apoyo,
                NumeroSector: sector._id,
                Trabajador: nombreTrabajador._id,
                tipo: tipo,
            });

            await asignacion.save();
            res.status(201).send('Asignación completada');
        } catch (error) {
            console.error('Error al asignar:', error);
            res.status(500).send(
                'Error interno del servidor'
            );
        }
    } else {
        res.status(401).send('Token inválido');
    }
};

const obtenerAsigMes = async (req, res) => {
    try {
        if (req.authUser) {
            const fechaInicio = dayjs()
                .startOf('month')
                .subtract(3, 'hours')
                .toDate();
            const fechaFin = dayjs()
                .endOf('month')
                .subtract(3, 'hours')
                .toDate();
            const trabajadorexiste = await trabajador.findOne({
                Rut: { $eq: getAuthRut(req) },
            });
            if (!trabajadorexiste) {
                return res.status(404).send('Trabajador no existente');
            }

            const sectores = await Asignacion.find({
                Trabajador: trabajadorexiste._id,
                fecha_asignacion: {
                    $gte: fechaInicio,
                    $lt: fechaFin,
                },
            });
            // Transformar los datos, buscar el número de sector y formatear la fecha
            const resultado = await Promise.all(
                sectores.map(async (asignacion) => {
                    const sector = await SECTOR.findById(asignacion.NumeroSector);
                    let ruta = null;
                    if (sector && sector.NumeroRuta) {
                        ruta = await RUTA.findById(sector.NumeroRuta);
                    }
                    // console.log(asignacion.fecha_asignacion,dayjs(asignacion.fecha_asignacion).endOf('day').add(21,'hours').toDate())
                    const direcciones= await direccion_MongooseModel.find({NumeroSector:sector._id}).countDocuments();
                    const ate= await ate_MongooseModel.find({Trabajador:trabajadorexiste._id,fecha_ate:{
                        $gte:asignacion.fecha_asignacion,
                        $lte:dayjs(asignacion.fecha_asignacion).endOf('day').add(21,'hours').toDate()
                    },
                    estado: { $ne: true },
                }).countDocuments();
                    return {
                        ruta: ruta ? ruta.NumeroRuta : null, // Recupera el número de ruta
                        sector: sector ? sector.sector : null, // Recupera el nombre del sector
                        fecha_asignacion: dayjs(asignacion.fecha_asignacion)
                            .utc()
                            .format('YYYY-MM-DD'),
                        tipo: asignacion.tipo,
                        direcciones: direcciones,
                        ate:ate
                    };
                })
            );

            res.status(200).send(resultado);
        } else {
            res.status(401).send('Token inválido');
        }
    } catch (error) {
        console.error('Error al obtener asignaciones del mes:', error.message);
        res.status(500).send('Error interno del servidor');
    }
};

const obtenerAsignacion = async (req, res) => {
    if (req.authUser) {
        const { NumeroSector, fecha } = req.body;
        try {
            const trabajadorexiste = await trabajador.findOne({
                Rut: { $eq: getAuthRut(req) },
            });
            const sectorexiste = await SECTOR.findOne({ NumeroSector: { $eq: Number(NumeroSector) } });
            if (!sectorexiste) {
                return res.status(404).send('Sector no existente');
            }
            const fechaconsulta = dayjs(fecha).utc(); // No aplicar .format aquí
            const fechaConsultaConHoraCero = fechaconsulta.startOf('day');

            const asignacion = await Asignacion.find({
                Trabajador: trabajadorexiste._id,
                NumeroSector: sectorexiste._id,
                fecha_asignacion: {
                    $gte: fechaConsultaConHoraCero.toDate(),
                    $lt: fechaConsultaConHoraCero.endOf('day').toDate(),
                },
            });
            if (!asignacion) {
                return res.status(404).send('Asignación no existente');
            }
            res.status(200).send(asignacion);
        } catch (error) {
            console.error('Error al obtener datos:', error);
            res.status(500).send(
                'Error interno del servidor'
            );
        }
    } else {
        res.status(401).send('Token inválido');
    }
};

const obtenerAsignacionDia = async (req, res) => {
    if (req.authUser) {
        try {
            const { fecha } = req.body;
            const fechaconsulta = dayjs(fecha).utc(); // No aplicar .format aquí
            const inicioDelDia = fechaconsulta.startOf('day').toDate();
            const finDelDia = fechaconsulta.endOf('day').toDate();

            const asignaciones = await Asignacion.find({
                fecha_asignacion: {
                    $gte: inicioDelDia,
                    $lt: finDelDia,
                },
            });

            return res.status(200).send(asignaciones);
        } catch (error) {
            console.error('Error al obtener datos:', error);
            res.status(500).send(
                'Error interno del servidor'
            );
        }
    } else {
        res.status(401).send('Token inválido');
    }
};

const modificarasigancion = async (req, res) => {
    if (req.authUser) {
        const { Nuevotrabajador, Nuevoapoyo, idAsignacion } = req.body;
        try {
            const nuevaasignacion = await Asignacion.findOne({
                _id: { $eq: String(idAsignacion) },
            });
            const Trabajador = await trabajador.findOne({
                Rut: { $eq: String(Nuevotrabajador) },
            });
            if (!Trabajador) {
                return res.status(404).send('Trabajador no existente');
            }
            const apoyo = Nuevoapoyo
                ? await trabajador.findOne({ Rut: { $eq: String(Nuevoapoyo) } })
                : null;
            nuevaasignacion.Trabajador = Trabajador._id;
            nuevaasignacion.apoyo = apoyo ? apoyo._id : null;
            await nuevaasignacion.save();
            return res.send('Datos trabajador modificados correctamente');
        } catch (error) {
            console.error('Error al modificar datos:', error);
            res.status(500).send(
                'Error interno del servidor'
            );
        }
    } else {
        res.status(401).send('Token inválido');
    }
};

const asignarApoyo = async (req, res) => {
    if (req.authUser) {
        const { rut, sector, fechainicio, fechafin } = req.body;
        try {
            const trabajadorExiste = await trabajador.findOne({ Rut: { $eq: String(rut) } });
            if (!trabajadorExiste) {
                return res.status(404).send('Trabajador no encontrado');
            }
            const sectorExiste = await SECTOR.findOne({ _id: { $eq: String(sector) } });
            if (!sectorExiste) {
                return res.status(404).send('Sector no encontrado');
            }
            const asignacionMasCercana = await Asignacion.findOne({
                NumeroSector: sectorExiste._id,
            }).sort({ fecha_asignacion: 1 });

            if (!asignacionMasCercana) {
                return res
                    .status(404)
                    .send('No se encontró una asignación cercana');
            }
            const apoyonuevo = new apoyo_MongooseModel({
                Trabajador: trabajadorExiste._id,
                fecha_inicio: fechainicio,
                fecha_fin: fechafin,
                asignacion: asignacionMasCercana._id,
            });
            await apoyonuevo.save();
            trabajadorExiste.apoyo.push(apoyonuevo._id);
            trabajadorExiste.save();
            res.status(201).send('Apoyo asignado correctamente');
        } catch (error) {
            console.error('Error al asignar apoyo:', error);
            res.status(500).send(
                'Error interno del servidor'
            );
        }
    } else {
        res.status(401).send('Token inválido');
    }
};

const obtenerVistaAsignaciones = async (req, res) => {
    try {
        const fechaInicio = req.body?.fechaInicio
            ? dayjs.utc(req.body.fechaInicio)
            : dayjs.utc().startOf('month');
        const fechaFin = req.body?.fechaFin
            ? dayjs.utc(req.body.fechaFin)
            : dayjs.utc().endOf('month');

        if (!fechaInicio.isValid() || !fechaFin.isValid()) {
            return res.status(400).json({ message: 'Rango de fechas inválido' });
        }

        const inicio = fechaInicio.startOf('day').toDate();
        const fin = fechaFin.endOf('day').toDate();

        const asignaciones = await Asignacion.find({
            fecha_asignacion: {
                $gte: inicio,
                $lte: fin,
            },
        })
            .populate({
                path: 'Trabajador',
                select: 'Nombre Rut cargo arquetipo',
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

        const trabajadores = new Set();
        const sectores = new Set();
        const porTrabajador = new Map();

        const resultado = asignaciones.map((asignacion) => {
            const trabajadorAsignado = asignacion.Trabajador || null;
            const sectorAsignado = asignacion.NumeroSector || null;
            const trabajadorId = trabajadorAsignado?._id?.toString() || 'sin-trabajador';
            const sectorId = sectorAsignado?._id?.toString() || '';

            if (trabajadorAsignado?._id) {
                trabajadores.add(trabajadorId);
            }

            if (sectorId) {
                sectores.add(sectorId);
            }

            const detalleTrabajador = {
                id: trabajadorAsignado?._id?.toString() || null,
                nombre: trabajadorAsignado?.Nombre || 'Sin trabajador',
                rut: trabajadorAsignado?.Rut || '',
                cargo: trabajadorAsignado?.arquetipo || trabajadorAsignado?.cargo || '',
            };

            const detalleSector = {
                id: sectorId || null,
                nombre: sectorAsignado?.sector || 'Sin sector',
                numero: sectorAsignado?.NumeroSector ?? null,
                ruta: sectorAsignado?.NumeroRuta?.NumeroRuta ?? null,
                empresa: sectorAsignado?.empresa || '',
            };

            const totalActual = porTrabajador.get(trabajadorId) || {
                trabajador: detalleTrabajador,
                total: 0,
                lectura: 0,
                reparto: 0,
            };

            totalActual.total += 1;
            if (asignacion.tipo === 'lectura') {
                totalActual.lectura += 1;
            }
            if (asignacion.tipo === 'reparto') {
                totalActual.reparto += 1;
            }
            porTrabajador.set(trabajadorId, totalActual);

            return {
                id: asignacion._id.toString(),
                fecha_asignacion: dayjs.utc(asignacion.fecha_asignacion).format('YYYY-MM-DD'),
                tipo: asignacion.tipo,
                trabajador: detalleTrabajador,
                sector: detalleSector,
            };
        });

        return res.status(200).json({
            rango: {
                fechaInicio: dayjs.utc(inicio).format('YYYY-MM-DD'),
                fechaFin: dayjs.utc(fin).format('YYYY-MM-DD'),
            },
            resumen: {
                total: resultado.length,
                lectura: resultado.filter((asignacion) => asignacion.tipo === 'lectura').length,
                reparto: resultado.filter((asignacion) => asignacion.tipo === 'reparto').length,
                trabajadores: trabajadores.size,
                sectores: sectores.size,
            },
            porTrabajador: Array.from(porTrabajador.values()).sort((a, b) =>
                a.trabajador.nombre.localeCompare(b.trabajador.nombre, 'es')
            ),
            asignaciones: resultado,
        });
    } catch (error) {
        console.error('Error al obtener vista de asignaciones:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

module.exports = {
    asignarsector,
    modificarasigancion,
    obtenerAsignacion,
    obtenerAsignacionDia,
    obtenerAsigMes,
    asignarApoyo,
    obtenerVistaAsignaciones,
};
