const mongoose = require("mongoose");
const { ASSIGNMENT_TYPES } = require('./asignacionPlantilla.model');

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
        enum: ASSIGNMENT_TYPES
    },
    fecha_asignacion: {
        type: Date
    }
});

const asignacion_MongooseModel = mongoose.model('asignacion', asignacion_Mongoose);

module.exports = { asignacion_MongooseModel };
