const router = require('express').Router();
const { uploadMemory } = require('../middlewares/multerConfig.js');
const { requireRole } = require('../middlewares/auth.middleware.js');
const {
    actualizarConfig,
    listarAdmin,
    obtenerConfig,
    obtenerPendientes,
    responderVerificacion,
} = require('../controllers/verificacionTerreno.controller.js');

router.post('/pendientes', obtenerPendientes);
router.post('/responder', uploadMemory.single('file'), responderVerificacion);
router.post('/admin/listar', requireRole('administracion', 'supervisor'), listarAdmin);
router.get('/admin/config', requireRole('administracion', 'supervisor'), obtenerConfig);
router.put('/admin/config', requireRole('administracion', 'supervisor'), actualizarConfig);

module.exports = router;
