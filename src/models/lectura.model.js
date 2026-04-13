const mongoose = require("mongoose");

const lectura_Mongoose = new mongoose.Schema({
    lectura: { type: Number, required: true,unique:false},
    foto: { type: String, required: true },
    clave: { type: String, required: true },
    fecha: { type: Date, required: true },
    NumeroMedidor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'medidor', 
    },
    NumeroRuta: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ruta',
    },
    NumeroSector: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'sector',
    },
    trabajador:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'trabajador'
    }
});

const lectura_MongooseModel = mongoose.model('lectura',lectura_Mongoose);

module.exports ={lectura_MongooseModel};