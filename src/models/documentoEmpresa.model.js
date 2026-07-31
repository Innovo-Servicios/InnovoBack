const mongoose = require('mongoose');

const firmanteFisicoSchema = new mongoose.Schema({
    tipo: { type: String, enum: ['trabajador', 'externo'], required: true },
    trabajador: { type: mongoose.Schema.Types.ObjectId, ref: 'trabajador' },
    nombre: { type: String, required: true, trim: true },
    rut: { type: String, default: '', trim: true },
    cargo: { type: String, default: '', trim: true },
    estado: { type: String, enum: ['pendiente', 'firmado'], default: 'pendiente' },
    firmadoAt: { type: Date },
    registradoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'trabajador' },
}, { timestamps: true, optimisticConcurrency: true });

const firmanteDigitalSchema = new mongoose.Schema({
    trabajador: { type: mongoose.Schema.Types.ObjectId, ref: 'trabajador', required: true },
    nombre: { type: String, required: true, trim: true },
    rut: { type: String, required: true, trim: true },
    cargo: { type: String, default: '', trim: true },
    notificacion: { type: mongoose.Schema.Types.ObjectId, ref: 'notificaciones' },
    validacion: { type: mongoose.Schema.Types.ObjectId, ref: 'notificacion_validacion' },
}, { timestamps: true });

const documentoEmpresaSchema = new mongoose.Schema({
    serieId: { type: String, required: true, trim: true },
    version: { type: Number, required: true, min: 1, default: 1 },
    documentoAnterior: { type: mongoose.Schema.Types.ObjectId, ref: 'DocumentoEmpresa' },
    categoria: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CategoriaDocumentoEmpresa',
        required: true,
    },
    titulo: { type: String, required: true, trim: true },
    descripcion: { type: String, default: '', trim: true },
    esGlobal: { type: Boolean, default: false, index: true },
    fechaEmision: { type: Date },
    fechaVencimiento: { type: Date },
    diasAviso: { type: Number, min: 1, max: 365, default: 30 },
    estado: {
        type: String,
        enum: ['vigente', 'reemplazado', 'archivado'],
        default: 'vigente',
    },
    archivo: {
        nombreOriginal: { type: String, required: true },
        nombreAlmacenado: { type: String, required: true },
        rutaRelativa: { type: String, required: true },
        mimeType: { type: String, required: true },
        tamano: { type: Number, required: true, min: 0 },
    },
    firmantesFisicos: [firmanteFisicoSchema],
    firmantesDigitales: [firmanteDigitalSchema],
    ultimoHitoAvisado: { type: Number, min: 0, max: 4, default: 0 },
    vencimientoAvisado: { type: Date },
    creadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'trabajador', required: true },
    actualizadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'trabajador' },
}, { timestamps: true });

documentoEmpresaSchema.index({ serieId: 1, version: 1 }, { unique: true });
documentoEmpresaSchema.index({ categoria: 1, estado: 1, createdAt: -1 });
documentoEmpresaSchema.index({ estado: 1, fechaVencimiento: 1 });
documentoEmpresaSchema.index({ esGlobal: 1, estado: 1, createdAt: -1 });
documentoEmpresaSchema.index({ 'firmantesDigitales.trabajador': 1 });

const DocumentoEmpresa = mongoose.model('DocumentoEmpresa', documentoEmpresaSchema);

module.exports = { DocumentoEmpresa };
