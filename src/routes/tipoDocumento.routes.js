const router = require('express').Router();

const {crearTipo,obtenerTipos,eliminarTipo} = require('../controllers/tipoDocumento.controller.js');
const { requireAnyPermission, requirePermission } = require('../middlewares/auth.middleware.js');


router.post(
    '/crearTipo',
    requireAnyPermission('trabajadores.documentos.gestionar', 'catalogos.gestionar'),
    crearTipo
);
router.post('/obtenerTipos',obtenerTipos);
router.post('/eliminarTipo', requirePermission('catalogos.gestionar'), eliminarTipo);

module.exports = router;
