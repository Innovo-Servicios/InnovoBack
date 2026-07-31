const mongoose = require('mongoose');

const arquetipoRolSchema = new mongoose.Schema({
    clave: {
        type: String,
        required: true,
        unique: true,
        enum: ['administracion', 'lector', 'supervisor', 'inspector'],
    },
    nombre: { type: String, required: true, trim: true },
    descripcion: { type: String, default: '', trim: true },
    permisosPredeterminados: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Permiso' }],
    activo: { type: Boolean, default: true },
}, { timestamps: true });

const ArquetipoRol = mongoose.model('ArquetipoRol', arquetipoRolSchema);

module.exports = { ArquetipoRol };
