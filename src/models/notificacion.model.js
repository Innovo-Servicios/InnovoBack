const mongoose = require("mongoose");

const notificaciones_Mongoose = new mongoose.Schema({
    "tipo":{type: mongoose.Schema.Types.ObjectId, required: true, ref: 'tipoNotificacion'},
    "titulo":{type: String, required: true},
    "mensaje":{type: String, required: true},
    "contenido":{type: String, required: true},
    "url":{type: String},
    "fecha":{type: Date, default: Date.now},
    "trabajadores":[{type: mongoose.Schema.Types.ObjectId, required: true}],
});

const notificaciones_MongooseModel = mongoose.model('notificaciones',notificaciones_Mongoose)
module.exports={notificaciones_MongooseModel}

