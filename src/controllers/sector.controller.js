const mongoose = require('mongoose');
const {ruta_MongooseModel:Ruta} = require('../models/ruta.model');
const { sector_MongooseModel: Sector } = require('../models/sector.model');
const { direccion_MongooseModel : Direccion } = require('../models/direccion.model');
const { cliente_MongooseModel: Cliente } = require('../models/cliente.model');
const  {asignacion_MongooseModel:Asignacion} = require('../models/asignacion.model.js');
const Token = require('../controllers/token.controller.js')
const turf = require('@turf/turf');
const dayjs = require('dayjs');

const crearsectores = async (req, res) => {
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid){   
        const { NumeroRuta, NumeroSector, sector } = req.body;
        try {
            const sectorExistente = await Sector.findOne({ NumeroSector: { $eq: Number(NumeroSector) } });
            const rutaExistente = await Ruta.findOne({ NumeroRuta: { $eq: Number(NumeroRuta) } });
            if (!rutaExistente) {
                return res.status(400).send('Ruta no existente');
            }
            if (sectorExistente) {
                return res.status(400).send('El sector ya existe');
            }
            const nuevosector = new Sector({
                _id: new mongoose.Types.ObjectId(),
                NumeroSector:NumeroSector,
                sector: sector,
                NumeroRuta: rutaExistente._id,
            });
            await nuevosector.save();
            res.status(201).send('Sector registrado correctamente');
        } catch (error) {
            // console.error('Error al registrar sector:', error);
            res.status(500).send('Error interno del servidor: ' + error.message);
        }
    }else {
        res.status(401).send('Token inválido');
    }
};

const obtenerDatosSectores = async (req, res) => {
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid) {
        const { NumeroSector } = req.body;
        try {
            const sector = await Sector.findOne({ NumeroSector: { $eq: Number(NumeroSector) } });
            if (!sector) {
                return res.status(404).send('Sector no encontrado');
            }
            const response={
                perimetral:sector.perimetral,
                direcciones:[],
            }

            res.status(200).send(response);
        } catch (error) {
            // console.error('Error al obtener datos de sector:', error);
            res.status(500).send('Error interno del servidor: ' + error.message);
        }
    } else {
        res.status(401).send('Token inválido');
    }
}

const tablaSectores = async (req, res) => {
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid) {
        try{
            const rutas = await Ruta.find();
            const nRutas = await Promise.all(rutas.map(async (ruta) => {
                const sectores = await Sector.find({ NumeroRuta: ruta });
                const tabla = {
                    NumeroRuta: ruta.NumeroRuta,
                    sectores: sectores.map((sector) => {
                        return {
                            id:sector._id,
                            NumeroSector: sector.NumeroSector,
                            sector: sector.sector,
                        };
                    }),
                };
                return tabla;
            }));

            res.status(200).send(nRutas);
            
        } catch (error) {
            // console.error('Error al obtener sectores:', error);
            res.status(500).send('Error interno del servidor: ' + error.message);
        }
    } else {
        res.status(401).send('Token inválido');
    }
};

const obtenerSectoresRuta = async (req, res) => {
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid) {
        const { NumeroRuta } = req.body;
        try {
            const ruta = await Ruta.findOne({ NumeroRuta: { $eq: Number(NumeroRuta) } });
            if (!ruta) {
                return res.status(404).send('Ruta no encontrada');
            }
            const sectores = await Sector.find({ NumeroRuta: ruta._id },"sector NumeroSector");
            res.send(sectores);
        } catch (error) {
            // console.error('Error al obtener sectores de ruta:', error);
            res.status(500).send('Error interno del servidor: ' + error.message);
        }
    } else {
        res.status(401).send('Token inválido');
    }
}

const calcularPerimetro = async (NumeroSector) => {
    try {
        const sector = await Sector.findOne({ NumeroSector: { $eq: String(NumeroSector) } });
        if (!sector) {
            throw new Error('Sector no encontrado');
        }

        const direcciones = await Direccion.find({ NumeroSector: sector._id });
        const puntos = direcciones.map((direccion) => {
            return [direccion.LAT, direccion.LNG];
        });

        const poligono = turf.points(puntos);
        const perimetro = turf.convex(poligono);

        if (perimetro) {
            sector.perimetral = perimetro.geometry.coordinates[0];
            await sector.save();
            return perimetro.geometry.coordinates[0];
        } else {
            throw new Error('No se pudo calcular el perímetro');
        }
    } catch (error) {
        // console.error('Error al calcular perímetro de sector:', error);
        throw error;
    }
};

const sectorApoyo = async (req, res) => {
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);

    if (tokenValido.valid) {
        try {
            // Se buscan las asignaciones en el rango de fechas indicado
            const asignaciones = await Asignacion.find({
                "fecha_asignacion": {
                    $gte: dayjs().subtract(2, 'day').endOf('day').subtract(3, 'hour').toDate(),
                    $lte: dayjs().toDate(),
                }
            });

            // Se mapean las asignaciones a sus sectores correspondientes
            const sectores = await Promise.all(asignaciones.map(async (asignacion) => {
                const sector = await Sector.findById(asignacion.NumeroSector);
                // Se retorna un objeto con _id y el nombre del sector si se encontró; 
                // de lo contrario, se retorna null
                return sector 
                    ? { _id: sector._id, sectorNombre: sector.sector } 
                    : null;
            }));

            // Se eliminan los resultados nulos (en caso de no encontrar el sector)
            const sectoresValidos = sectores.filter(sector => sector !== null);

            // Se filtran los duplicados: se mantiene solo el primer elemento de cada _id único
            const sectoresUnicos = sectoresValidos.filter((sector, index, self) =>
                index === self.findIndex((s) => s._id.toString() === sector._id.toString())
            );
            res.status(200).send(sectoresUnicos);
        } catch (error) {
            // console.error(error);
            res.status(500).send('Error en el servidor');
        }
    } else {
        res.status(401).send('Token inválido');
    }
};


module.exports = { crearsectores ,obtenerDatosSectores,tablaSectores,obtenerSectoresRuta,calcularPerimetro,sectorApoyo};