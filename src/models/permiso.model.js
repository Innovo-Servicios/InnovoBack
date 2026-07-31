const mongoose=require('mongoose')

const permisoSchema = new mongoose.Schema({
    clave: { type: String, trim: true, lowercase: true, unique: true, sparse: true },
    modulo: { type: String, trim: true },
    accion: { type: String, trim: true },
    nombre: { type: String, required: true, trim: true },
    descripcion: { type: String, default: '', trim: true },
    orden: { type: Number, default: 0 },
    activo: { type: Boolean, default: true },
    legado: { type: Boolean, default: false },
}, { timestamps: true });

const Permiso = mongoose.model('Permiso', permisoSchema);

module.exports = {Permiso};
