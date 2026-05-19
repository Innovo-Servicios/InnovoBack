const router = require('express').Router();
const {uploadMemory } = require('../middlewares/multerConfig'); // Importar ambas funciones
const { requireAuth, requireRole } = require('../middlewares/auth.middleware.js');
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

router.post('/crearNotificacion', requireAuth, requireRole('administracion', 'supervisor'), crearNotificacion);
router.post('/eliminarNotificacion', requireAuth, eliminarNotificacion);
router.post('/buscarNotificacion', requireAuth, requireRole('administracion', 'supervisor'), buscarNotificacion);
router.post('/detallesNotificacion', requireAuth, requireRole('administracion', 'supervisor'), detallesNotificacion);
router.post('/obtenerNotificaciones', requireAuth, requireRole('administracion', 'supervisor'), obtenerNotificaciones);
router.post('/getNoti', requireAuth, obtenerNotificacionesDelUser);
router.post('/getNotiPage', requireAuth, obtenerNotificacionesDelUserPaginadas);
router.post('/infoNotificaciones', requireAuth, requireRole('administracion', 'supervisor'), infoNotificaciones);
router.post('/pushNotification', requireAuth, requireRole('administracion', 'supervisor'), pushNotificationOLD);
router.post('/crearNotificacionDocumento', requireAuth, requireRole('administracion', 'supervisor'), uploadLimiter, uploadMemory.single('file'),crearNotificacionDocumento);
router.post('/validacion/firmar', requireAuth, notificationValidationLimiter, firmarValidacionNotificacion);
router.post('/validacion/aceptar', requireAuth, notificationValidationLimiter, aceptarValidacionNotificacion);
router.post('/validacion/regenerarCodigo', requireAuth, requireRole('administracion', 'supervisor'), notificationValidationLimiter, regenerarCodigoValidacion);
router.get('/archivo/:id/:fileName', requireAuth, descargarNotificacionDocumento);

module.exports = router;
