const express = require('express');
const router = express.Router();
const { upload, uploadMemory } = require('../middlewares/multerConfig'); // Importar ambas funciones
const { processExcelFile ,excelAsignaciones,excelAte,descarga_ATE,descargar_novedad} = require('../controllers/excel.controller');
const { requireRole } = require('../middlewares/auth.middleware.js');
const { uploadLimiter } = require('../middlewares/rateLimit.middleware.js');

// Definir ruta para subir y procesar archivos
router.post('/upload', requireRole('administracion', 'supervisor'), uploadLimiter, upload.single('file'), processExcelFile);
router.post('/excelAsignaciones', requireRole('administracion', 'supervisor'), uploadLimiter, uploadMemory.single('file'), excelAsignaciones);
router.post('/excelAte', requireRole('administracion', 'supervisor'), uploadLimiter, uploadMemory.single('file'), excelAte);
router.post('/ate', requireRole('administracion', 'supervisor'), uploadLimiter, descarga_ATE);
router.post('/novedad', requireRole('administracion', 'supervisor'), uploadLimiter, descargar_novedad);

module.exports = router;
