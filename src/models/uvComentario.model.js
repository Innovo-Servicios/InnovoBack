const mongoose = require('mongoose');

const ComentariosUVSchema = new mongoose.Schema({
  value: { type: String, required: true, unique: true }
});

const ComentariosUV = mongoose.model('ComentariosUV', ComentariosUVSchema);

module.exports ={ ComentariosUV };
