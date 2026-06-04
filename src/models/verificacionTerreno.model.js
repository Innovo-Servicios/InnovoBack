const mongoose = require('mongoose');

const intentoSchema = new mongoose.Schema(
    {
        fecha: { type: Date, required: true, default: Date.now },
        lat: { type: Number, required: true },
        lng: { type: Number, required: true },
        accuracy: { type: Number, required: false },
        distanciaMetros: { type: Number, required: false, default: null },
        fotografia: { type: String, required: false },
        comentario: { type: String, required: false },
        estado: {
            type: String,
            required: true,
            enum: ['fuera_de_rango', 'validada', 'validada_por_captura_inicial'],
        },
    },
    { _id: false }
);

const verificacionTerrenoSchema = new mongoose.Schema(
    {
        trabajador: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'trabajador',
            required: true,
            index: true,
        },
        asignacion: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'asignacion',
            required: false,
        },
        direccion: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'direccion',
            required: true,
            index: true,
        },
        sector: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'sector',
            required: false,
        },
        fecha: {
            type: Date,
            required: true,
            index: true,
        },
        estado: {
            type: String,
            required: true,
            enum: ['pendiente', 'validada', 'validada_por_captura_inicial'],
            default: 'pendiente',
            index: true,
        },
        origen: {
            type: String,
            required: true,
            enum: ['aleatoria'],
            default: 'aleatoria',
        },
        radioMetros: { type: Number, required: true, default: 150 },
        fotografia: { type: String, required: false },
        comentario: { type: String, required: false },
        respuestaAt: { type: Date, required: false },
        latRespuesta: { type: Number, required: false },
        lngRespuesta: { type: Number, required: false },
        accuracy: { type: Number, required: false },
        distanciaMetros: { type: Number, required: false, default: null },
        direccionCoordenadasOriginales: {
            lat: { type: Number, required: false },
            lng: { type: Number, required: false },
        },
        coordenadasActualizadas: { type: Boolean, required: true, default: false },
        intentos: { type: [intentoSchema], default: [] },
    },
    { timestamps: true }
);

verificacionTerrenoSchema.index(
    { trabajador: 1, fecha: 1, direccion: 1 },
    { unique: true }
);

const verificacionTerreno_MongooseModel = mongoose.model(
    'verificacionTerreno',
    verificacionTerrenoSchema
);

module.exports = { verificacionTerreno_MongooseModel };
