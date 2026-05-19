const router= require('express').Router();

const {crearTipoNotificacion,obtenerTipoNotificacion,eliminarTipoNotificacion} = require('../controllers/tipoNotificacion.controller.js');
const { requireRole } = require('../middlewares/auth.middleware.js');

router.post('/crearTipoNotificacion', requireRole('administracion'), crearTipoNotificacion);
router.post('/obtenerTipoNotificacion',obtenerTipoNotificacion);
router.post('/eliminarTipoNotificacion', requireRole('administracion'), eliminarTipoNotificacion);

module.exports = router;
