const mongoose = require('mongoose');
const TipoComentario = mongoose.model('TipoComentario');
const Token = require('../controllers/token.controller.js')

const normalizeRequiredString = (value) => {
    if (typeof value !== 'string') {
        return null;
    }

    const normalizedValue = value.trim();
    return normalizedValue === '' ? null : normalizedValue;
};

const normalizeObjectId = (value) => {
    if (!(typeof value === 'string' || value instanceof mongoose.Types.ObjectId)) {
        return null;
    }

    const normalizedValue = String(value).trim();
    if (normalizedValue === '' || !mongoose.isValidObjectId(normalizedValue)) {
        return null;
    }

    return normalizedValue;
};

const crearComentario = async (req, res) => {
    try {
        const {token, nombre} = req.body;
        const tokenValido = await Token.validartoken(token);
        if (tokenValido.valid) {
            const nombreComentario = normalizeRequiredString(nombre);
            if (!nombreComentario) {
                return res.status(400).send('Nombre de comentario inválido');
            }

            const tipoComentario = new TipoComentario({
                _id: new mongoose.Types.ObjectId(),
                value: nombreComentario,
            });
            await tipoComentario.save();
            return res.status(201).send('Tipo de comentario creado');
        } else {
            return res.status(401).send('Token inválido');
        }
    } catch (error) {
        return res.status(500).send('Error interno del servidor: ' + error.message);
    }
}

const obtenerComentario = async (req, res) => {
    try {
        const {token} = req.body;
        const tokenValido = await Token.validartoken(token);
        if (tokenValido.valid) {
            const tipos = await TipoComentario.find();
            res.status(200).json(tipos);
        } else {
            res.status(401).send('Token inválido');
        }
    } catch (error) {
        res.status(500).send('Error interno del servidor: ' + error.message);
    }
}

const eliminarComentario = async (req, res) => {
    try {
        const {token, id} = req.body;
        const tokenValido = await Token.validartoken(token);
        if (tokenValido.valid) {
            const comentarioId = normalizeObjectId(id);
            if (!comentarioId) {
                return res.status(404).send('Tipo de comentario no encontrado');
            }

            await TipoComentario.deleteOne(mongoose.sanitizeFilter({ _id: new mongoose.Types.ObjectId(comentarioId) }));
            return res.status(200).send('Tipo de comentario eliminado');
        } else {
            return res.status(401).send('Token inválido');
        }
    } catch (error) {
        return res.status(500).send('Error interno del servidor: ' + error.message);
    }
}

module.exports = {crearComentario, obtenerComentario, eliminarComentario};
