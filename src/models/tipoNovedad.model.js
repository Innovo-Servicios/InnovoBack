const mongoose = require('mongoose');

const tipoNovedadSchema = new mongoose.Schema({
  value: { type: String, required: true, unique: true }
});

const TipoNovedad = mongoose.model('TipoNovedad', tipoNovedadSchema);

module.exports ={ TipoNovedad};
