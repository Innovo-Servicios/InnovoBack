const mongoose = require('mongoose');

const ASSIGNMENT_TYPES = ['lectura', 'reparto','delantoVerificacion', 'verificacion'];

const assignmentTypeField = {
    type: String,
    enum: ASSIGNMENT_TYPES,
};

const fixedAssignmentSchema = new mongoose.Schema({
    trabajador: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'trabajador',
        required: true,
    },
    sector: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'sector',
        required: true,
    },
    tipos: {
        type: [assignmentTypeField],
        default: ASSIGNMENT_TYPES,
    },
}, { _id: false });

const rotatingGroupSchema = new mongoose.Schema({
    trabajadores: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'trabajador',
    }],
    rutas: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ruta',
    }],
    sectores: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'sector',
    }],
    tipos: {
        type: [assignmentTypeField],
        default: ASSIGNMENT_TYPES,
    },
}, { _id: false });

const leftoverWorkerSchema = new mongoose.Schema({
    trabajador: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'trabajador',
        required: true,
    },
    tipos: {
        type: [assignmentTypeField],
        default: ASSIGNMENT_TYPES,
    },
}, { _id: false });

const restrictionSchema = new mongoose.Schema({
    trabajador: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'trabajador',
        required: true,
    },
    sectores: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'sector',
    }],
}, { _id: false });

const asignacionPlantillaSchema = new mongoose.Schema({
    empresa: {
        type: String,
        required: true,
        enum: ['GasValpo', 'Comercial', 'Energas'],
        unique: true,
    },
    fixedAssignments: {
        type: [fixedAssignmentSchema],
        default: [],
    },
    rotating: {
        type: rotatingGroupSchema,
        default: () => ({
            trabajadores: [],
            rutas: [],
            sectores: [],
            tipos: ASSIGNMENT_TYPES,
        }),
    },
    leftoverWorkers: {
        type: [leftoverWorkerSchema],
        default: [],
    },
    restrictions: {
        type: [restrictionSchema],
        default: [],
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'trabajador',
        required: false,
    },
}, {
    timestamps: true,
});

const asignacionPlantilla_MongooseModel = mongoose.model('asignacionPlantilla', asignacionPlantillaSchema);

module.exports = {
    ASSIGNMENT_TYPES,
    asignacionPlantilla_MongooseModel,
};
