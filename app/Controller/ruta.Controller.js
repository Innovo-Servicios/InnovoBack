const mongoose = require('mongoose');
const { ruta_MongooseModel } = require('../Model/ruta_Mongoose');
const { sector_MongooseModel } = require('../Model/sector_Mongoose');
const Token = require('../Controller/token.Controller.js')
const turf = require('@turf/turf');


const crearrutas = async (req, res) => {
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid){   
        const { NumeroRuta } = req.body;  
        try {
            const rutaExistente = await ruta_MongooseModel.findOne({ NumeroRuta: { $eq: Number(NumeroRuta) } });
            if (rutaExistente) {
                return res.status(400).send('La ruta ya existe');
            }

            const nuevaRuta = new ruta_MongooseModel({ NumeroRuta });
            await nuevaRuta.save();  
            res.status(201).send('Ruta creada correctamente');
        } catch (error) {
            // console.error('Error al crear la ruta:', error);
            res.status(500).send('Error interno del servidor');
        }
    }else {
        res.status(401).send('Token inválido');
    }
};

const calcularPerimetral = async (req, res) => {
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (!tokenValido.valid) {
        return res.status(401).send('Token inválido');
    }

    try {
        const { NumeroRuta } = req.body;
        const ruta = await ruta_MongooseModel.findOne({ NumeroRuta: { $eq: Number(NumeroRuta) } });
        if (!ruta) {
            return res.status(404).send('Ruta no encontrada');
        }

        const sectores = await sector_MongooseModel.find({ NumeroRuta: ruta._id });
        let perimetro = sectores.flatMap(sector => sector.perimetral.flat());

        const poligono = turf.points(perimetro);
        const convexHull = turf.convex(poligono);
        ruta.perimetral = convexHull ? convexHull.geometry.coordinates[0] : [];

        await ruta.save();

        res.status(200).send('Perímetro calculado correctamente ');
    } catch (error) {
        // console.error('Error al calcular perimetro:', error);
        res.status(500).send('Error interno del servidor');
    }
};

module.exports = { crearrutas ,calcularPerimetral};
