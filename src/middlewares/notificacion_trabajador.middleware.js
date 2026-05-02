//listar,
const mongoose = require('mongoose');
const {
    notificacion_vista_MongooseModel,
} = require('../models/notificacion_vista.model.js');
const {
    notificaciones_MongooseModel,
} = require('../models/notificacion.model.js');
const { trabajador_MongooseModel } = require('../models/trabajador.model.js');
const Token = require('../controllers/token.controller.js');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const moment = require('moment-timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const registroNotificacion = async (req, res) => {
    try {
        const { token } = req.body;
        const tokenValido = await Token.validartoken(token);

        if (tokenValido.valid) {
            const { idNotificacion } = req.body;
            
            const trabajador = await trabajador_MongooseModel.findOne({
                Rut: { $eq: String(tokenValido.token.rut) },
            });
            const notificacion = await notificaciones_MongooseModel.findOne({
                _id: { $eq: String(idNotificacion) },
            });
            if (trabajador && notificacion) {
                let notificacionVista = await notificacion_vista_MongooseModel.findOne({
                    notificacion: { $eq: String(idNotificacion) },
                    trabajador: { $eq: trabajador._id },
                });
                if (!notificacionVista) {
                    notificacionVista = new notificacion_vista_MongooseModel({
                        notificacion: idNotificacion,
                        trabajador: trabajador._id,
                        tiempo: moment()
                            .tz('America/Santiago')
                            .format('DD-MM-YYYY'),
                    });
                    await notificacionVista.save();
                }
                await trabajador_MongooseModel.updateOne(
                    { Rut: { $eq: String(tokenValido.token.rut) } },
                    {
                        $pull: { notificaciones: idNotificacion },
                        $addToSet: { vistas: idNotificacion },
                    }
                );
                //Evento de cambio de bolsa
                res.status(200).send('Notificación registrada');
            } else {
                res.status(404).send(
                    trabajador,
                    notificacion,
                    'No se encontró el trabajador o la notificación'
                );
            }
        }
    } catch (error) {
        res.status(500).send('Error interno del servidor: ' + error.message);
    }
};

module.exports = { registroNotificacion };
