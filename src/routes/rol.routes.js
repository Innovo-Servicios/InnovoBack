const router= require('express').Router();
const { requireAuth, requireAnyPermission, requirePermission } = require('../middlewares/auth.middleware.js');

const {
    actualizarArquetipo,
    archivarRol,
    asignarRol,
    asignarRolTemporal,
    crearRol,
    darRol,
    eliminarRolTemporal,
    listarArquetipos,
    listarRoles,
    modificarRol,
    obtenerRoles,
    rolesTemporales,
} = require('../controllers/rol.controller.js');

router.get('/', requireAnyPermission('accesos.ver', 'trabajadores.crear', 'trabajadores.editar', 'trabajadores.roles.asignar', 'trabajadores.roles.temporales', 'notificaciones.crear'), listarRoles);
router.post('/', requirePermission('accesos.gestionar'), crearRol);
router.put('/:id', requirePermission('accesos.gestionar'), modificarRol);
router.delete('/:id', requirePermission('accesos.gestionar'), archivarRol);
router.get('/arquetipos', requirePermission('accesos.ver'), listarArquetipos);
router.put('/arquetipos/:clave', requirePermission('accesos.gestionar'), actualizarArquetipo);
router.put('/asignacion/:trabajadorId', requirePermission('trabajadores.roles.asignar'), asignarRol);
router.put('/asignacion/:trabajadorId/temporal', requirePermission('trabajadores.roles.temporales'), asignarRolTemporal);
router.delete('/asignacion/:trabajadorId/temporal', requirePermission('trabajadores.roles.temporales'), eliminarRolTemporal);

router.post('/obtenerRoles', requireAuth, requirePermission('accesos.ver'), obtenerRoles);
router.post('/crearRol', requireAuth, requirePermission('accesos.gestionar'), crearRol);
router.post('/rolesTemporales', requireAuth, requirePermission('trabajadores.roles.temporales'), rolesTemporales);
router.post('/modificarRol', requireAuth, requirePermission('accesos.gestionar'), modificarRol);
router.post('/darRol', requireAuth, requirePermission('trabajadores.roles.asignar'), darRol);
module.exports = router;
