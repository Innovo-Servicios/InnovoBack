const mongoose = require('mongoose');

const documentoPlantillaSchema = new mongoose.Schema({
    nombre: { type: String, required: true, trim: true },
    descripcion: { type: String, default: '', trim: true },
    contenido: { type: String, required: true, trim: true },
    contenidoHtml: { type: String, default: '', trim: true },
    textoAceptacion: {
        type: String,
        default: 'Declaro haber recibido, leido, comprendido y aceptado el contenido de este documento.',
        trim: true,
    },
    codigoBase: { type: String, default: '', trim: true, uppercase: true },
    categoria: { type: mongoose.Schema.Types.ObjectId, ref: 'CategoriaDocumentoEmpresa' },
    archivoBase: {
        nombreOriginal: { type: String, default: '' },
        mimeType: { type: String, default: '' },
        tamano: { type: Number, default: 0, min: 0 },
        importadoAt: { type: Date },
    },
    variablesDetectadas: [{ type: String, trim: true }],
    version: { type: Number, required: true, min: 1, default: 1 },
    activo: { type: Boolean, default: true, index: true },
    creadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'trabajador' },
    actualizadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'trabajador' },
}, { timestamps: true });

documentoPlantillaSchema.index({ nombre: 1, activo: 1 });

const DocumentoPlantilla = mongoose.model('DocumentoPlantilla', documentoPlantillaSchema);

module.exports = { DocumentoPlantilla };
