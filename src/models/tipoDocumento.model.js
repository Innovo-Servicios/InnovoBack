const mongoose=require('mongoose');

const tipoDocumento_Mongoose = new mongoose.Schema({
    value: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 }
});

const tipoDocumento_MongooseModel = mongoose.model('tipoDocumento',tipoDocumento_Mongoose);

module.exports={tipoDocumento_MongooseModel}
