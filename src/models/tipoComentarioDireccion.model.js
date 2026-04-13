const mongoose = require('mongoose');

const tipoComentarioSchema = new mongoose.Schema({
  value: { type: String, required: true, unique: true }
});

const TipoComentario = mongoose.model('TipoComentario', tipoComentarioSchema);

module.exports ={ TipoComentario};
