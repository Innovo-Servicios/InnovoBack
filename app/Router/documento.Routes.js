const router = require('express').Router();
const {uploadMemory } = require('../Middleware/multerConfig'); // Importar ambas funciones
const { requireAuth, requireRole } = require('../Middleware/auth.middleware.js');
const { uploadLimiter } = require('../Middleware/rateLimit.middleware.js');
const { crearDocumento, obtenerDocumentos, eliminarDocumentos ,listarDocumentos,deleteDocumento, descargarDocumento } = require('../Controller/documento.controller');

router.post('/crearDocumento', requireAuth, requireRole('administracion', 'supervisor'), uploadLimiter, uploadMemory.single('file'), crearDocumento);
router.post('/obtenerDocumentos', requireAuth, obtenerDocumentos);
router.post('/eliminarDocumento', requireAuth, requireRole('administracion', 'supervisor'), eliminarDocumentos);
router.post('/listarDocumentos', requireAuth, listarDocumentos);
router.post('/deleteDocumento', requireAuth, requireRole('administracion', 'supervisor'), deleteDocumento);
router.get('/archivo/:id/:fileName', requireAuth, descargarDocumento);
module.exports = router
