const mongoose = require("mongoose");

const documentos_Mongoose = new mongoose.Schema({
  tipo: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'tipoDocumento' },
  url: { type: String, required: false },
  formato: { type: String, required: true }, // Tipo de archivo: "imagen", "pdf", "doc"
  fecha: { type: Date, required: true }
});

const documentos_MongooseModel = mongoose.model('documentos', documentos_Mongoose);

module.exports = { documentos_MongooseModel };
