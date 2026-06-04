const mongoose = require('mongoose');

const verificacionTerrenoConfigSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            required: true,
            unique: true,
            default: 'default',
        },
        enabled: {
            type: Boolean,
            required: true,
            default: true,
        },
        cantidadDiaria: {
            type: Number,
            required: true,
            default: 1,
            min: 1,
            max: 10,
        },
        radioMetros: {
            type: Number,
            required: true,
            default: 150,
            min: 20,
            max: 1000,
        },
    },
    { timestamps: true }
);

const verificacionTerrenoConfig_MongooseModel = mongoose.model(
    'verificacionTerrenoConfig',
    verificacionTerrenoConfigSchema
);

module.exports = { verificacionTerrenoConfig_MongooseModel };
