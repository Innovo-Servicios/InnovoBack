const mongoose=require('mongoose')

const rolSchema = new mongoose.Schema({
    nombre: { type: String, required: true, trim: true },
    nombreNormalizado: { type: String, trim: true, lowercase: true, unique: true, sparse: true },
    descripcion: { type: String, default: '', trim: true },
    arquetipo: {
        type: String,
        enum: ['administracion', 'lector', 'supervisor', 'inspector'],
    },
    permisos: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Permiso' }],
    activo: { type: Boolean, default: true },
    esBase: { type: Boolean, default: false },
    legado: { type: Boolean, default: false },
}, { timestamps: true });

rolSchema.pre('validate', function normalizeName() {
    if (this.nombre) {
        this.nombreNormalizado = String(this.nombre).trim().toLocaleLowerCase('es-CL');
    }
});

const Rol = mongoose.model('Rol', rolSchema);

module.exports = {Rol};
