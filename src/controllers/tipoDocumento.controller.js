const mongoose=require('mongoose');
const {tipoDocumento_MongooseModel} = require('../models/tipoDocumento.model.js')
const Token = require('../controllers/token.controller.js')

const crearTipo= async (req, res) => {
    const {token} = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid){
        const {value} = req.body;
        try{
            const nuevoTipo = new tipoDocumento_MongooseModel({
                _id: new mongoose.Types.ObjectId(),
                value
            });
            await nuevoTipo.save();
            res.status(201).send('Tipo de documento creado correctamente');
        }catch (error) {
            res.status(500).send('Error interno del servidor');
        }
    }else{
        res.status(401).send('Token inválido');
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