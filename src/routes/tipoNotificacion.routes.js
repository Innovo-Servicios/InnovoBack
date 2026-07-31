const router= require('express').Router();

const {crearTipoNotificacion,obtenerTipoNotificacion,eliminarTipoNotificacion} = require('../controllers/tipoNotificacion.controller.js');
const { requirePermission } = require('../middlewares/auth.middleware.js');

router.post('/crearTipoNotificacion', requirePermission('catalogos.gestionar'), crearTipoNotificacion);
router.post('/obtenerTipoNotificacion',obtenerTipoNotificacion);
router.post('/eliminarTipoNotificacion', requirePermission('catalogos.gestionar'), eliminarTipoNotificacion);

module.exports = router;
