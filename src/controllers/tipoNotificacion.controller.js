const mongoose = require('mongoose');
const {TipoNotificacion} = require('../models/tipoNotificacion.model.js');
const Token = require('../controllers/token.controller.js')
const crearTipoNotificacion = async (req, res) => {
    const {  token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid) {
        const { nombre } = req.body;
        try {
            const tipoNotificacion = new TipoNotificacion({
                _id: new mongoose.Types.ObjectId(),
                value: nombre,
            });

            await tipoNotificacion.save();
            res.status(201).send('Tipo de notificacion creado');
        } catch (error) {
            // console.error('Error al crear tipo de notificacon:', error);
            res.status(500).send('Error interno del servidor: ' + error.message);
        }
    } else {
        res.status(401).send('Token inválido');
    }
}
const obtenerTipoNotificacion = async (req, res) => {
    try {
        const {token} = req.body;
        const tokenValido = await Token.validartoken(token);
        if (tokenValido.valid) {
            const tipos = await TipoNotificacion.find({}, '_id value');
            res.status(200).json(tipos);
        } else {
            res.status(401).send('Token inválido');
        }
    } catch (error) {
        // console.error('Error al obtener tipos de notificacion:', error);
        res.status(500).send('Error interno del servidor: ' + error.message);
    }
}
const eliminarTipoNotificacion = async (req, res) => {
    const {  token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid) {
        const { id } = req.body;
        try {
            await TipoNotificacion.findByIdAndDelete(String(id));
            res.status(200).send('Tipo de notificacion eliminado');
        } catch (error) {
            // console.error('Error al eliminar tipo de notificacion:', error);
            res.status(500).send('Error interno del servidor: ' + error.message);
        }
    } else {
        res.status(401).send('Token inválido');
    }
}
module.exports= {crearTipoNotificacion,obtenerTipoNotificacion,eliminarTipoNotificacion};