const mongoose = require('mongoose');

const clienteSchema = new mongoose.Schema({
    nombre: { type: String, required: true },
    NumeroCliente: { type: Number, required: true}
});

const cliente_MongooseModel = mongoose.model('clientes', clienteSchema);

module.exports = { cliente_MongooseModel };
