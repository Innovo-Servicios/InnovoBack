const router= require('express').Router();
const { requireAuth, requireRole } = require('../middlewares/auth.middleware.js');

const {obtenerRoles, crearRol, rolesTemporales, modificarRol,darRol} = require('../controllers/rol.controller.js');

router.post('/obtenerRoles', requireAuth, requireRole('administracion'), obtenerRoles);
router.post('/crearRol', requireAuth, requireRole('administracion'), crearRol);
router.post('/rolesTemporales', requireAuth, requireRole('administracion'), rolesTemporales);
router.post('/modificarRol', requireAuth, requireRole('administracion'), modificarRol);
router.post('/darRol', requireAuth, requireRole('administracion'), darRol);
module.exports = router;
