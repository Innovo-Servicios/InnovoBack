const mongoose = require("mongoose");

const apoyo = new mongoose.Schema({
    Trabajador: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'trabajador', 
        required: true
    },
    fecha_inicio: {
        type: Date
    },
    fecha_fin: {
        type: Date
    },
    asignacion: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'asignacion', 
        required: true
    },
});

const apoyo_MongooseModel = mongoose.model('apoyo',apoyo);

module.exports = {apoyo_MongooseModel};

