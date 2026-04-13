const mongoose = require("mongoose");

const rutaSchema = new mongoose.Schema({
    NumeroRuta: { type: Number, required: true, unique: true },
    perimetral: {
        type: [[
          [Number]
        ]]
      }
});

const ruta_MongooseModel = mongoose.model('ruta', rutaSchema); 
module.exports = { ruta_MongooseModel };
