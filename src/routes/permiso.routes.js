const router= require('express').Router();
const { requireAuth, requireRole } = require('../middlewares/auth.middleware.js');

const {obtenerPermisos, crearPermiso, eliminarPermiso} = require('../controllers/permiso.controller.js');

router.post('/obtenerPermisos', requireAuth, requireRole('administracion'), obtenerPermisos);
router.post('/crearPermiso', requireAuth, requireRole('administracion'), crearPermiso);
router.post('/eliminarPermiso', requireAuth, requireRole('administracion'), eliminarPermiso);

module.exports = router;
