const db = require('../config/db.js');
const mongoose = require('mongoose');
const cliente = require('../models/cliente.model.js')
const medidor = require('../models/medidor.model.js')
const Token = require('../controllers/token.controller.js')

const agregarmedidor= async (req, res) => {
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido){   
        const {NumeroCliente, NumeroMedidor} = req.body;
        try{
            const usuarioExistente = await cliente.cliente_MongooseModel.findOne({ NumeroCliente: { $eq: Number(NumeroCliente) } });
            const medidorExistente = await medidor.medidor_MongooseModel.findOne({ NumeroMedidor: { $eq: Number(NumeroMedidor) } });
            if (!usuarioExistente) {
                return res.status(400).send('El usuario no existe');
            }
            if (medidorExistente) {
                return res.status(400).send('El medidor ya existe');
            }
            const nuevomedidor = new medidor.medidor_MongooseModel({
                _id: new mongoose.Types.ObjectId(),
                NumeroMedidor,
                NumeroCliente: usuarioExistente._id
            });
            await nuevomedidor.save();
            res.status(201).send('Medidro registrado correctamente');
        }catch (error) {
            // console.error('Error al registrar medidor:', error);
            res.status(500).send('Error interno del servidor');
        }
    }else {
        res.status(401).send('Token inválido');
    }
};

module.exports = {agregarmedidor}