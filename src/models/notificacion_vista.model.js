const mongoose = require("mongoose");

const notificacion_vista_Mongoose = new mongoose.Schema({
    notificacion: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'notificacion',
    },
    trabajador:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'trabajador'
    },
    tiempo:{
        type: String,
        required: true
    }
});

const notificacion_vista_MongooseModel = mongoose.model('notificacion_vista',notificacion_vista_Mongoose);

module.exports ={notificacion_vista_MongooseModel};