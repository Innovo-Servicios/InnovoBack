const mongoose = require("mongoose");

const ate = new mongoose.Schema({
    comentario: { type: String, required: false},
    foto:{type: String, required: false},
    tipo:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'tipoNovedad',
        required: true
    },
    direccion: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'direccion', 
        required: true
    },
    Trabajador: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'trabajador',
        required: false
    },
    fecha_ate: {
        type: Date
    },
    fotografia:{type: mongoose.Schema.Types.ObjectId},
    estado:{type: Boolean, default: false},
    respuesta:{type: Date, required: false},
    respuestaComentario:{type: String, required: false},
    Lecturacorrecta:{type: Number, required: false, default: null},
    whatsappNotificacionIntentadaAt:{type: Date, required: false},
    whatsappNotificacionEstado:{
        type: String,
        enum: ['pendiente', 'enviada', 'error'],
        required: false
    },
    whatsappNotificacionEnviadaAt:{type: Date, required: false},
    whatsappNotificacionError:{type: String, required: false},
    atrasoNotificacionEnviadaAt:{type: Date, required: false},
    atrasoNotificacion:{type: mongoose.Schema.Types.ObjectId, ref: 'notificaciones', required: false},
});

const ate_MongooseModel = mongoose.model('ATE',ate);

module.exports = {ate_MongooseModel};
