const mongoose = require("mongoose");

const sectorSchema = new mongoose.Schema({
  sector: { type: String, required: true },
  NumeroSector: { type: Number, unique: true },
  NumeroRuta: { type: mongoose.Schema.Types.ObjectId, ref: 'ruta' },
  perimetral: {
    type: [[
      [Number]
    ]]
  },
  empresa: { type: String, enum: ['GasValpo', 'Comercial', 'Energas'] }
});

const sector_MongooseModel = mongoose.model('sector', sectorSchema);

module.exports = { sector_MongooseModel };
