const mongoose = require("mongoose");

const EMPRESAS_TRABAJADOR = ['GasValpo', 'Comercial', 'Energas'];

const trabajador_Mongoose = new mongoose.Schema({
    "Rut": { type: String, required: true ,unique:true},//
    "Nombre": { type: String, required: true },//
    "cargo": { // Alias transitorio del arquetipo para clientes móviles antiguos.
        type: String,
        required: true,
        enum: ['administracion', 'lector', 'supervisor', 'inspector']
    },
    "arquetipo": {
        type: String,
        enum: ['administracion', 'lector', 'supervisor', 'inspector'],
        required: false
    },
    "empresa": [{ type: String, enum: EMPRESAS_TRABAJADOR, required: false }],
    "perfil": { type: String, required: false },//implementar documentos?
    "apoyo": [{ type: mongoose.Schema.Types.ObjectId, required: true }],  //  
    "correo": { type: String, required: true },//
    "clave": { type: String, required: true },
    "notificaciones": [{ type: mongoose.Schema.Types.ObjectId, required: true }],//
    "vistas": [{ type: mongoose.Schema.Types.ObjectId, required: false }],//
    "notificacionesEliminadas": [{ type: mongoose.Schema.Types.ObjectId, required: false }],
    "documentos": [{ type: mongoose.Schema.Types.ObjectId }],//
    "rol": { type: mongoose.Schema.Types.ObjectId, required: false, ref: 'Rol' },//
    "rolTemporal": { //
        "rol": { type: mongoose.Schema.Types.ObjectId, required: false, ref: 'Rol' },
        "expiracion": { type: Date, required: false }
    },
    "ID": { type: String, required: false },
    "tokenPush": { type: String, required: false },
    "sessionVersion": { type: Number, required: true, default: 0 },
    "refreshTokens": [{
        "tokenHash": { type: String, required: true },
        "deviceId": { type: String, required: true },
        "expiresAt": { type: Date, required: true },
        "createdAt": { type: Date, required: true, default: Date.now },
        "lastUsedAt": { type: Date, required: false },
    }],
    "lastUbication": {
        "lat": { type: Number, required: false },
        "lng": { type: Number, required: false },
        "date": { type: Date, required: false }
    }
})

const trabajador_MongooseModel = mongoose.model('trabajador', trabajador_Mongoose);

module.exports = { trabajador_MongooseModel, EMPRESAS_TRABAJADOR };
