const router = require('express').Router();
const {uploadMemory } = require('../middlewares/multerConfig'); // Importar ambas funciones
const { requireAuth, requireRole } = require('../middlewares/auth.middleware.js');
const { uploadLimiter } = require('../middlewares/rateLimit.middleware.js');
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
} = require('../controllers/notificaciones.controller.js');

router.post('/crearNotificacion', requireAuth, requireRole('administracion', 'supervisor'), crearNotificacion);
router.post('/eliminarNotificacion', requireAuth, eliminarNotificacion);
router.post('/buscarNotificacion', requireAuth, buscarNotificacion);
router.post('/detallesNotificacion', requireAuth, detallesNotificacion);
router.post('/obtenerNotificaciones', requireAuth, obtenerNotificaciones);
router.post('/getNoti', requireAuth, obtenerNotificacionesDelUser);
router.post('/getNotiPage', requireAuth, obtenerNotificacionesDelUserPaginadas);
router.post('/infoNotificaciones', requireAuth, requireRole('administracion', 'supervisor'), infoNotificaciones);
router.post('/pushNotification', requireAuth, requireRole('administracion', 'supervisor'), pushNotificationOLD);
router.post('/crearNotificacionDocumento', requireAuth, requireRole('administracion', 'supervisor'), uploadLimiter, uploadMemory.single('file'),crearNotificacionDocumento);
router.get('/archivo/:id/:fileName', requireAuth, descargarNotificacionDocumento);

module.exports = router;
