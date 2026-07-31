const router = require('express').Router();
const {uploadMemory } = require('../middlewares/multerConfig'); // Importar ambas funciones
const { requireAuth, requirePermission } = require('../middlewares/auth.middleware.js');
const { uploadLimiter } = require('../middlewares/rateLimit.middleware.js');
const { crearDocumento, crearDocumentoMasivo, obtenerDocumentos, eliminarDocumentos ,listarDocumentos,deleteDocumento, descargarDocumento } = require('../controllers/documento.controller');

router.post('/crearDocumento', requireAuth, requirePermission('trabajadores.documentos.gestionar'), uploadLimiter, uploadMemory.single('file'), crearDocumento);
router.post('/crearDocumentoMasivo', requireAuth, requirePermission('trabajadores.documentos.gestionar'), uploadLimiter, uploadMemory.single('file'), crearDocumentoMasivo);
router.post('/obtenerDocumentos', requireAuth, obtenerDocumentos);
router.post('/eliminarDocumento', requireAuth, requirePermission('trabajadores.documentos.gestionar'), eliminarDocumentos);
router.post('/listarDocumentos', requireAuth, listarDocumentos);
router.post('/deleteDocumento', requireAuth, requirePermission('trabajadores.documentos.gestionar'), deleteDocumento);
router.get('/archivo/:id/:fileName', requireAuth, descargarDocumento);
module.exports = router
