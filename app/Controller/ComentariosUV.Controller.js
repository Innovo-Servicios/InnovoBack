const mongoose = require('mongoose');
const Token = require('../Controller/token.Controller.js')
const { ComentariosUV: ComentariosUVModel } = require('../Model/uvComentario_Mongoose.js');

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

const listarComentariosUV = async (req, res) => {
    try {
        const {token}=req.body;
        const tokenValido = await Token.validartoken(token);
        if (tokenValido.valid) {
            const comentarios = await ComentariosUVModel.find();
            res.status(200).send(comentarios);
        }else{
            res.status(401).send('Token inválido');
        }
    } catch (error) {
        
        // console.error('Error al obtener comentarios:', error);
        res.status(500).send('Error interno del servidor: ' + error.message);
    }

}

const crearComentarioUV = async (req, res) => {
    const { token, comentario } = req.body;
    try {
        const tokenValido = await Token.validartoken(token);
        if (tokenValido.valid) {
            const comentarioNormalizado = normalizeRequiredString(comentario);
            if (!comentarioNormalizado) {
                return res.status(400).send('Comentario inválido');
            }

            const comentarioExistente = await ComentariosUVModel.findOne(
                mongoose.sanitizeFilter({ value: comentarioNormalizado })
            );
            if (comentarioExistente) {
                return res.status(400).send('El comentario ya existe');
            }
            const nuevoComentario = new ComentariosUVModel({
                value: comentarioNormalizado
            });
            await nuevoComentario.save();
            return res.status(201).send('Comentario registrado correctamente');
        } else {
            res.status(401).send('Token inválido');
        }
    } catch (error) {
        // console.error('Error al registrar comentario:', error);
        return res.status(500).send('Error interno del servidor: ' + error.message);
    }
};

const eliminarComentarioUV = async (req, res) => {
    const { token, id } = req.body;
    try {
        const tokenValido = await Token.validartoken(token);
        if (tokenValido.valid) {
            const comentarioId = normalizeObjectId(id);
            if (!comentarioId) {
                return res.status(404).send('Comentario no encontrado');
            }

            const comentario = await ComentariosUVModel.findOneAndDelete(
                mongoose.sanitizeFilter({ _id: new mongoose.Types.ObjectId(comentarioId) })
            );
            if (comentario) {
                return res.status(200).send('Comentario eliminado correctamente');
            } else {
                return res.status(404).send('Comentario no encontrado');
            }
        } else {
            res.status(401).send('Token inválido');
        }
    } catch (error) {
        // console.error('Error al eliminar comentario:', error);
        return res.status(500).send('Error interno del servidor: ' + error.message);
    }
};

module.exports = { listarComentariosUV, crearComentarioUV, eliminarComentarioUV };
