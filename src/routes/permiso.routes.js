const router= require('express').Router();
const { requireAuth, requirePermission } = require('../middlewares/auth.middleware.js');

const {actualizarPermiso, obtenerCatalogo, obtenerPermisos, crearPermiso, eliminarPermiso} = require('../controllers/permiso.controller.js');

router.get('/catalogo', requirePermission('accesos.ver'), obtenerCatalogo);
router.patch('/:clave', requirePermission('accesos.gestionar'), actualizarPermiso);

router.post('/obtenerPermisos', requireAuth, requirePermission('accesos.ver'), obtenerPermisos);
router.post('/crearPermiso', requireAuth, requirePermission('accesos.gestionar'), crearPermiso);
router.post('/eliminarPermiso', requireAuth, requirePermission('accesos.gestionar'), eliminarPermiso);

module.exports = router;
