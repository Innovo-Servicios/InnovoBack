const mongoose = require('mongoose');
const { sector_MongooseModel: SECTOR } = require('../Model/sector_Mongoose');
const {
    trabajador_MongooseModel: trabajador,
} = require('../Model/trabajador_Mongoose.js');
const {
    asignacion_MongooseModel: Asignacion,
} = require('../Model/asignacion_Mongose.js');
const { ruta_MongooseModel: RUTA } = require('../Model/ruta_Mongoose.js');
const { apoyo_MongooseModel } = require('../Model/apoyo.js');
const {direccion_MongooseModel}= require('../Model/direccion_Mongoose.js')
const {ate_MongooseModel}= require('../Model/ATE_Mongoose.js')
const dayjs = require('dayjs');
const Token = require('../Controller/token.Controller.js');

const asignarsector = async (req, res) => {
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid) {
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
                'Error interno del servidor: ' + error.message
            );
        }
    } else {
        res.status(401).send('Token inválido');
    }
};

const obtenerAsigMes = async (req, res) => {
    try {
        const { token } = req.body;
        const tokenValido = await Token.validartoken(token);
        if (tokenValido.valid) {
            const fechaInicio = dayjs()
                .startOf('month')
                .subtract(3, 'hours')
                .toDate();
            const fechaFin = dayjs()
                .endOf('month')
                .subtract(3, 'hours')
                .toDate();
            const trabajadorexiste = await trabajador.findOne({
                Rut: { $eq: String(tokenValido.token.rut) },
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
        res.status(500).send('Error interno del servidor: ' + error);
    }
};

const obtenerAsignacion = async (req, res) => {
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid) {
        const { NumeroSector, fecha } = req.body;
        try {
            const trabajadorexiste = await trabajador.findOne({
                Rut: { $eq: String(tokenValido.token.rut) },
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
                'Error interno del servidor: ' + error.message
            );
        }
    } else {
        res.status(401).send('Token inválido');
    }
};

const obtenerAsignacionDia = async (req, res) => {
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid) {
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
                'Error interno del servidor: ' + error.message
            );
        }
    } else {
        res.status(401).send('Token inválido');
    }
};

const modificarasigancion = async (req, res) => {
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid) {
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
                'Error interno del servidor: ' + error.message
            );
        }
    } else {
        res.status(401).send('Token inválido');
    }
};

const asignarApoyo = async (req, res) => {
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid) {
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
            apoyonuevo = new apoyo_MongooseModel({
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
                'Error interno del servidor: ' + error.message
            );
        }
    } else {
        res.status(401).send('Token inválido');
    }
};

module.exports = {
    asignarsector,
    modificarasigancion,
    obtenerAsignacion,
    obtenerAsignacionDia,
    obtenerAsigMes,
    asignarApoyo,
};
