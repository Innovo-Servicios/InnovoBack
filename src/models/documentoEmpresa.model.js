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

const aprobacionDocumentoSchema = new mongoose.Schema({
    tipo: {
        type: String,
        enum: ['gerencia', 'prevencion'],
        required: true,
    },
    estado: {
        type: String,
        enum: ['pendiente', 'aprobado', 'rechazado'],
        default: 'pendiente',
    },
    aprobador: { type: mongoose.Schema.Types.ObjectId, ref: 'trabajador' },
    nombre: { type: String, default: '', trim: true },
    rut: { type: String, default: '', trim: true },
    cargo: { type: String, default: '', trim: true },
    comentario: { type: String, default: '', trim: true },
    firmadoAt: { type: Date },
}, { _id: false });

const controlCambioDocumentoSchema = new mongoose.Schema({
    version: { type: Number, required: true, min: 1 },
    fecha: { type: Date, default: Date.now },
    descripcion: { type: String, required: true, trim: true },
    autor: { type: mongoose.Schema.Types.ObjectId, ref: 'trabajador' },
    nombreAutor: { type: String, default: '', trim: true },
}, { _id: false });

const matrizRelacionadaSchema = new mongoose.Schema({
    codigo: { type: String, required: true, trim: true },
    nombre: { type: String, default: '', trim: true },
    descripcion: { type: String, default: '', trim: true },
}, { _id: false });

const documentoRelacionadoSchema = new mongoose.Schema({
    documento: { type: mongoose.Schema.Types.ObjectId, ref: 'DocumentoEmpresa', required: true },
    tipoRelacion: {
        type: String,
        enum: ['matriz', 'referencia', 'reemplaza', 'anexo', 'otro'],
        default: 'referencia',
    },
    descripcion: { type: String, default: '', trim: true },
}, { _id: false });

const documentoEmpresaSchema = new mongoose.Schema({
    serieId: { type: String, required: true, trim: true },
    version: { type: Number, required: true, min: 1, default: 1 },
    codigoBase: { type: String, trim: true, uppercase: true },
    codigoVersionado: { type: String, trim: true, uppercase: true },
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
        enum: ['borrador', 'pendiente_aprobacion', 'vigente', 'reemplazado', 'archivado'],
        default: 'vigente',
    },
    requiereAprobacion: { type: Boolean, default: false },
    requiereFirmaDigital: { type: Boolean, default: false },
    responsableSistemaGestion: {
        nombre: { type: String, default: 'Paola Olivares', trim: true },
        cargo: { type: String, default: 'Prevencion de Riesgos', trim: true },
    },
    plantillaDocumental: {
        plantilla: { type: mongoose.Schema.Types.ObjectId, ref: 'DocumentoPlantilla' },
        nombre: { type: String, default: '', trim: true },
        version: { type: Number, min: 1 },
        contenido: { type: String, default: '', trim: true },
        textoAceptacion: { type: String, default: '', trim: true },
    },
    aprobaciones: [aprobacionDocumentoSchema],
    controlCambios: [controlCambioDocumentoSchema],
    documentosRelacionados: [documentoRelacionadoSchema],
    matricesRelacionadas: [matrizRelacionadaSchema],
    publicadoAt: { type: Date },
    difusion: {
        estado: {
            type: String,
            enum: ['no_requerida', 'pendiente', 'enviada', 'completa'],
            default: 'no_requerida',
        },
        ultimaNotificacion: { type: mongoose.Schema.Types.ObjectId, ref: 'notificaciones' },
        difundidoAt: { type: Date },
        alcanceDescripcion: { type: String, default: '', trim: true },
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
documentoEmpresaSchema.index(
    { codigoVersionado: 1 },
    { unique: true, partialFilterExpression: { codigoVersionado: { $type: 'string' } } }
);
documentoEmpresaSchema.index(
    { codigoBase: 1, version: 1 },
    { unique: true, partialFilterExpression: { codigoBase: { $type: 'string' } } }
);
documentoEmpresaSchema.index({ categoria: 1, estado: 1, createdAt: -1 });
documentoEmpresaSchema.index({ estado: 1, fechaVencimiento: 1 });
documentoEmpresaSchema.index({ esGlobal: 1, estado: 1, createdAt: -1 });
documentoEmpresaSchema.index({ 'firmantesDigitales.trabajador': 1 });

const DocumentoEmpresa = mongoose.model('DocumentoEmpresa', documentoEmpresaSchema);

module.exports = { DocumentoEmpresa };
