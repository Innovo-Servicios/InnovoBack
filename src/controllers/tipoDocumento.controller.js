const mongoose=require('mongoose');
const {tipoDocumento_MongooseModel} = require('../models/tipoDocumento.model.js')
const Token = require('../controllers/token.controller.js')

const normalizeTipoDocumento = (value) => String(value || '').trim().replace(/\s+/g, ' ');

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const crearTipo= async (req, res) => {
    const value = normalizeTipoDocumento(req.body?.value);

    if (value.length < 2 || value.length > 80) {
        return res.status(400).json({ message: 'La categoría debe tener entre 2 y 80 caracteres' });
    }

    try{
        const existente = await tipoDocumento_MongooseModel.findOne({
            value: new RegExp(`^${escapeRegExp(value)}$`, 'i'),
        });

        if (existente) {
            return res.status(409).json({
                message: 'La categoría ya existe',
                tipo: existente,
            });
        }

        const nuevoTipo = new tipoDocumento_MongooseModel({
            _id: new mongoose.Types.ObjectId(),
            value
        });
        await nuevoTipo.save();

        return res.status(201).json({
            message: 'Categoría creada correctamente',
            tipo: nuevoTipo,
        });
    }catch (error) {
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
}

const obtenerTipos = async (req, res) => {
    const {token} = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid){
        try{
            const tipos = await tipoDocumento_MongooseModel.find();
            res.send(tipos);
        }catch (error) {
            res.status(500).send('Error interno del servidor');
        }
    }else{
        res.status(401).send('Token inválido');
    }
}

const eliminarTipo = async (req, res) => {
    const {token, id} = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid){
        try{
            await tipoDocumento_MongooseModel.deleteOne({ _id: { $eq: String(id) } });
            res.status(200).send('Tipo de documento eliminado correctamente');
        }catch (error) {
            res.status(500).send('Error interno del servidor');
        }
    }else{
        res.status(401).send('Token inválido');
    }
}


module.exports = {crearTipo,obtenerTipos,eliminarTipo}
