const mongoose = require("mongoose");

const medidor_Mongoose = new mongoose.Schema({
    NumeroMedidor:{ type: Number, required: true},
    NumeroCliente: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'cliente', 
    },
});

const medidor_MongooseModel =mongoose.model('medidor',medidor_Mongoose)

module.exports = {medidor_MongooseModel}