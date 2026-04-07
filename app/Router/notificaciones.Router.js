const router = require('express').Router();
const {uploadMemory } = require('../Middleware/multerConfig'); // Importar ambas funciones
const { requireAuth, requireRole } = require('../Middleware/auth.middleware.js');
const { uploadLimiter } = require('../Middleware/rateLimit.middleware.js');
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
    descargarNotificacionDocumento,
} = require('../Controller/notificaciones.Controller.js');

router.post('/crearNotificacion', requireAuth, requireRole('administracion', 'supervisor'), crearNotificacion);
router.post('/eliminarNotificacion', requireAuth, requireRole('administracion', 'supervisor'), eliminarNotificacion);
router.post('/buscarNotificacion', requireAuth, buscarNotificacion);
router.post('/detallesNotificacion', requireAuth, detallesNotificacion);
router.post('/obtenerNotificaciones', requireAuth, obtenerNotificaciones);
router.post('/getNoti', requireAuth, obtenerNotificacionesDelUser);
router.post('/infoNotificaciones', requireAuth, requireRole('administracion', 'supervisor'), infoNotificaciones);
router.post('/pushNotification', requireAuth, requireRole('administracion', 'supervisor'), pushNotificationOLD);
router.post('/crearNotificacionDocumento', requireAuth, requireRole('administracion', 'supervisor'), uploadLimiter, uploadMemory.single('file'),crearNotificacionDocumento);
router.get('/archivo/:id/:fileName', requireAuth, descargarNotificacionDocumento);

module.exports = router;
