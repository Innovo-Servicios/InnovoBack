const router= require('express').Router();

const {crearTipoNotificacion,obtenerTipoNotificacion,eliminarTipoNotificacion} = require('../controllers/tipoNotificacion.controller.js');

router.post('/crearTipoNotificacion',crearTipoNotificacion);
router.post('/obtenerTipoNotificacion',obtenerTipoNotificacion);
router.post('/eliminarTipoNotificacion',eliminarTipoNotificacion);

module.exports = router;