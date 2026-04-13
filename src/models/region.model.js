const mongoose=require('mongoose')

const regionSchema = new mongoose.Schema({
    idnumero: { type: Number, required: true, unique: true },
    nombre: { type: String, required: false },
    area: {
        latMin: { type: Number, required: false },
        latMax: { type: Number, required: false },
        lngMin: { type: Number, required: false },
        lngMax: { type: Number, required: false }
    },
    indiceUV_h: { type: Number, required: false },
    indiceUV_m: { type: Number, required: false }
});

const Region = mongoose.model('Region', regionSchema);

module.exports = {Region};