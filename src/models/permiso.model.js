const mongoose=require('mongoose')

const permisoSchema = new mongoose.Schema({
    nombre: {type: String, required: true},
    descripcion: {type: String, required: false}
});

const Permiso = mongoose.model('Permiso', permisoSchema);

module.exports = {Permiso};