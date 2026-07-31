const mongoose = require('mongoose');

const categoriaDocumentoEmpresaSchema = new mongoose.Schema({
    nombre: { type: String, required: true, trim: true },
    nombreNormalizado: { type: String, required: true, trim: true, lowercase: true, unique: true },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, immutable: true },
    descripcion: { type: String, default: '', trim: true },
    carpetaRelativa: { type: String, required: true, immutable: true },
    activo: { type: Boolean, default: true },
    creadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'trabajador', required: true },
    actualizadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'trabajador' },
}, { timestamps: true });

const CategoriaDocumentoEmpresa = mongoose.model(
    'CategoriaDocumentoEmpresa',
    categoriaDocumentoEmpresaSchema
);

module.exports = { CategoriaDocumentoEmpresa };
