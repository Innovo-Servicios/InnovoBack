const mongoose = require('mongoose');

const VALIDATION_STATES = [
    'pendiente',
    'firmado',
    'aceptado',
    'vencido',
    'bloqueado',
];

const notificacionValidacionSchema = new mongoose.Schema(
    {
        notificacion: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'notificaciones',
            required: true,
        },
        trabajador: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'trabajador',
            required: true,
        },
        documentoEmpresa: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'DocumentoEmpresa',
        },
        firmanteDocumento: {
            type: mongoose.Schema.Types.ObjectId,
        },
        codeHash: {
            type: String,
            select: false,
        },
        codeEncrypted: {
            type: String,
            select: false,
        },
        codeIv: {
            type: String,
            select: false,
        },
        codeTag: {
            type: String,
            select: false,
        },
        expiresAt: {
            type: Date,
            required: true,
        },
        estado: {
            type: String,
            enum: VALIDATION_STATES,
            default: 'pendiente',
            required: true,
        },
        firmaAutomatica: {
            type: Boolean,
            default: false,
        },
        intentos: {
            type: Number,
            default: 0,
            min: 0,
        },
        maxIntentos: {
            type: Number,
            default: 5,
            min: 1,
        },
        lastAttemptAt: {
            type: Date,
        },
        firmadoAt: {
            type: Date,
        },
        aceptadoAt: {
            type: Date,
        },
        regeneradoAt: {
            type: Date,
        },
    },
    { timestamps: true }
);

notificacionValidacionSchema.index(
    { notificacion: 1, trabajador: 1 },
    { unique: true }
);
notificacionValidacionSchema.index({ expiresAt: 1 });
notificacionValidacionSchema.index({ estado: 1 });
notificacionValidacionSchema.index(
    { documentoEmpresa: 1, trabajador: 1 },
    {
        unique: true,
        partialFilterExpression: { documentoEmpresa: { $type: 'objectId' } },
    }
);

const notificacion_validacion_MongooseModel = mongoose.model(
    'notificacion_validacion',
    notificacionValidacionSchema
);

module.exports = {
    VALIDATION_STATES,
    notificacion_validacion_MongooseModel,
};
