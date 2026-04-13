const mongoose = require('mongoose');
const {TipoNovedad} = require('../models/tipoNovedad.model.js');
const Token = require('../controllers/token.controller.js')


const crearTipoNovedad = async (req, res) => {
    const {  token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid) {
        const { nombre } = req.body;
        try {
            const tipoNovedad = new TipoNovedad({
                _id: new mongoose.Types.ObjectId(),
                value: nombre,
            });

            await tipoNovedad.save();
            res.status(201).send('Tipo de novedad creado');
        } catch (error) {
            // console.error('Error al crear tipo de novedad:', error);
            res.status(500).send('Error interno del servidor: ' + error.message);
        }
    } else {
        res.status(401).send('Token inválido');
    }
}

const obtenerTipoNovedad = async (req, res) => {
    try {
        const {  token } = req.body;
        const tokenValido = await Token.validartoken(token);
        if (tokenValido.valid) {
            const tipos = await TipoNovedad.find();
            res.status(200).json(tipos);
        } else {
            res.status(401).send('Token inválido');
        }
    } catch (error) {
        // console.error('Error al obtener tipos de novedad:', error);
        res.status(500).send('Error interno del servidor: ' + error.message);
    }
}

const eliminarTipoNovedad = async (req, res) => {
    const {  token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid) {
        const { id } = req.body;
        try {
            await TipoNovedad.findByIdAndDelete(String(id));
            res.status(200).send('Tipo de novedad eliminado');
        } catch (error) {
            // console.error('Error al eliminar tipo de novedad:', error);
            res.status(500).send('Error interno del servidor: ' + error.message);
        }
    } else {
        res.status(401).send('Token inválido');
    }
}

module.exports = {crearTipoNovedad,obtenerTipoNovedad,eliminarTipoNovedad};