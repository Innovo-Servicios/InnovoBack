const mongoose = require("mongoose");

const direccion_Mongoose = new mongoose.Schema({
    calle: { type: String, required: true },
    numero: { type: Number, required: true },
    block: { type: String, required: false },  // Ahora opcional
    depto: { type: String, required: false },  // Ahora opcional
    comuna: { type: String, required: true },
    ciudad: { type: String, required: true },
    region: { type: String, required: true },
    LAT: { type: Number, required: true },
    LNG: { type: Number, required: true },
    NumeroSector: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'sector', 
    },
    NumeroMedidor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'medidor', 
    },
    TipoComentario: {type:mongoose.Schema.Types.ObjectId, ref: 'TipoComentario'},

});

const direccion_MongooseModel = mongoose.model('direccion',direccion_Mongoose);

module.exports={direccion_MongooseModel}

