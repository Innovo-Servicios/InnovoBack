const router = require('express').Router();
const {uploadMemory } = require('../middlewares/multerConfig'); // Importar ambas funciones
const { requireAuth, requirePermission } = require('../middlewares/auth.middleware.js');
const {
    notificationValidationLimiter,
    uploadLimiter,
} = require('../middlewares/rateLimit.middleware.js');
const {
    crearNotificacion,
    eliminarNotificacion,
    obtenerNotificaciones,
    buscarNotificacion,
    detallesNotificacion,
    infoNotificaciones,
    pushNotificationOLD,
    crearNotificacionDocumento,
    obtenerNotificacionesDelUser,
    obtenerNotificacionesDelUserPaginadas,
    descargarNotificacionDocumento,
    firmarValidacionNotificacion,
    aceptarValidacionNotificacion,
    regenerarCodigoValidacion,
} = require('../controllers/notificaciones.controller.js');

router.post('/crearNotificacion', requireAuth, requirePermission('notificaciones.crear'), crearNotificacion);
router.post('/eliminarNotificacion', requireAuth, eliminarNotificacion);
router.post('/buscarNotificacion', requireAuth, requirePermission('notificaciones.ver'), buscarNotificacion);
router.post('/detallesNotificacion', requireAuth, requirePermission('notificaciones.ver'), detallesNotificacion);
router.post('/obtenerNotificaciones', requireAuth, requirePermission('notificaciones.ver'), obtenerNotificaciones);
router.post('/getNoti', requireAuth, obtenerNotificacionesDelUser);
router.post('/getNotiPage', requireAuth, obtenerNotificacionesDelUserPaginadas);
router.post('/infoNotificaciones', requireAuth, requirePermission('notificaciones.ver'), infoNotificaciones);
router.post('/pushNotification', requireAuth, requirePermission('notificaciones.crear'), pushNotificationOLD);
router.post('/crearNotificacionDocumento', requireAuth, requirePermission('notificaciones.crear'), uploadLimiter, uploadMemory.single('file'),crearNotificacionDocumento);
router.post('/validacion/firmar', requireAuth, notificationValidationLimiter, firmarValidacionNotificacion);
router.post('/validacion/aceptar', requireAuth, notificationValidationLimiter, aceptarValidacionNotificacion);
router.post('/validacion/regenerarCodigo', requireAuth, requirePermission('notificaciones.validaciones.gestionar'), notificationValidationLimiter, regenerarCodigoValidacion);
router.get('/archivo/:id/:fileName', requireAuth, descargarNotificacionDocumento);

module.exports = router;
