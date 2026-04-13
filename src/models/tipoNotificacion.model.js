const mongoose=require('mongoose');

const tipoNotificacionSchema = new mongoose.Schema({
    value: { type: String, required: true, unique: true }
    });

const TipoNotificacion = mongoose.model('TipoNotificacion', tipoNotificacionSchema);

module.exports ={ TipoNotificacion};
