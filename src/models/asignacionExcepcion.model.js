const mongoose = require('mongoose');

const ASSIGNMENT_EXCEPTION_REASONS = ['vacaciones', 'licencia', 'lesion', 'apoyo', 'reemplazo', 'otro'];

const asignacionExcepcionSchema = new mongoose.Schema({
    empresa: {
        type: String,
        required: true,
        enum: ['GasValpo', 'Comercial', 'Energas'],
    },
    month: {
        type: String,
        required: true,
        match: /^\d{4}-(0[1-9]|1[0-2])$/,
    },
    sector: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'sector',
        required: true,
    },
    originalWorker: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'trabajador',
        required: false,
    },
    replacementWorker: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'trabajador',
        required: true,
    },
    reason: {
        type: String,
        required: true,
        enum: ASSIGNMENT_EXCEPTION_REASONS,
    },
    note: {
        type: String,
        trim: true,
        default: '',
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'trabajador',
        required: false,
    },
}, {
    timestamps: true,
});

asignacionExcepcionSchema.index({ empresa: 1, month: 1, sector: 1 }, { unique: true });

const asignacionExcepcion_MongooseModel = mongoose.model('asignacionExcepcion', asignacionExcepcionSchema);

module.exports = {
    ASSIGNMENT_EXCEPTION_REASONS,
    asignacionExcepcion_MongooseModel,
};
