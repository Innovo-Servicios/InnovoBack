const router = require('express').Router();
const { uploadMemory } = require('../middlewares/multerConfig.js');
const { requirePermission } = require('../middlewares/auth.middleware.js');
const {
    actualizarConfig,
    listarAdmin,
    obtenerConfig,
    obtenerPendientes,
    responderVerificacion,
} = require('../controllers/verificacionTerreno.controller.js');

router.post('/pendientes', obtenerPendientes);
router.post('/responder', uploadMemory.single('file'), responderVerificacion);
router.post('/admin/listar', requirePermission('validaciones_terreno.ver'), listarAdmin);
router.get('/admin/config', requirePermission('validaciones_terreno.ver'), obtenerConfig);
router.put('/admin/config', requirePermission('validaciones_terreno.configurar'), actualizarConfig);

module.exports = router;
