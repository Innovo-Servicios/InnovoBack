const router = require('express').Router();

const {crearTipo,obtenerTipos,eliminarTipo} = require('../controllers/tipoDocumento.controller.js');
const { requireRole } = require('../middlewares/auth.middleware.js');


router.post('/crearTipo', requireRole('administracion'), crearTipo);
router.post('/obtenerTipos',obtenerTipos);
router.post('/eliminarTipo', requireRole('administracion'), eliminarTipo);

module.exports = router;
