const mongoose=require('mongoose')

const rolSchema = new mongoose.Schema({
    nombre: {type: String, required: true},
    permisos: [{type: mongoose.Schema.Types.ObjectId, required: false, ref: 'Permiso'}]
});

const Rol = mongoose.model('Rol', rolSchema);

module.exports = {Rol};