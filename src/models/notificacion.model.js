const mongoose = require("mongoose");

const notificaciones_Mongoose = new mongoose.Schema({
    "tipo":{type: mongoose.Schema.Types.ObjectId, required: true, ref: 'tipoNotificacion'},
    "titulo":{type: String, required: true},
    "mensaje":{type: String, required: true},
    "contenido":{type: String, required: true},
    "url":{type: String},
    "fecha":{type: Date, default: Date.now},
    "trabajadores":[{type: mongoose.Schema.Types.ObjectId, required: true}],
    "documento":{type: mongoose.Schema.Types.ObjectId, ref: 'documentos', required: false},
    "requiereFirma":{type: Boolean, default: false},
    "programada":{type: Boolean, default: false},
    "fechaProgramacion":{type: Date, required: false},
    "fechaEnvio":{type: Date, required: false},
    "fechaEnvioIniciado":{type: Date, required: false},
    "metadata":{type: mongoose.Schema.Types.Mixed, required: false},
    "estado": {
        type: String,
        enum: ['programada', 'enviando', 'enviado', 'fallida'],
        default: 'enviado'
    },
    "intentosEnvio":{type: Number, default: 0},
    "ultimoErrorEnvio":{type: String, required: false},
});

notificaciones_Mongoose.index({ estado: 1, fechaProgramacion: 1 });
notificaciones_Mongoose.index({ trabajadores: 1, fecha: -1 });

const notificaciones_MongooseModel = mongoose.model('notificaciones',notificaciones_Mongoose)
module.exports={notificaciones_MongooseModel}
