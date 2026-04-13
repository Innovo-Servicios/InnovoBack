const mongoose = require("mongoose");

const asignacion_Mongoose = new mongoose.Schema({
    apoyo: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'apoyo', 
        required: false 
    },
    NumeroSector: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'sector',
        required: true
    },
    Trabajador: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'trabajador',
        required: true
    },
    tipo: {
        type: String,
        required: true,
        enum: ['lectura', 'reparto']
    },
    fecha_asignacion: {
        type: Date
    }
});

const asignacion_MongooseModel = mongoose.model('asignacion', asignacion_Mongoose);

module.exports = { asignacion_MongooseModel };

