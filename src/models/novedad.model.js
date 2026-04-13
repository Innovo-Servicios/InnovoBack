const mongoose = require('mongoose')

const novedadSchema = new mongoose.Schema({
  TipoNovedad: {type:mongoose.Schema.Types.ObjectId, required: true,ref: 'TipoNovedad'},
  Comentario: {type: String, required: false},
  Lecturacorrecta: { type: Number, required: false },
  Fotografia: { type: String, required: false },
  Fecha: { type: Date, required: true },
  direccion: { type: mongoose.Schema.Types.ObjectId, ref: 'direccion' },
  emisor: { type: mongoose.Schema.Types.ObjectId, ref: 'trabajador' }
});

const Novedad = mongoose.model('Novedad', novedadSchema);

module.exports = {Novedad};
