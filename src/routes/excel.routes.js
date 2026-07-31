const express = require('express');
const router = express.Router();
const { upload, uploadMemory } = require('../middlewares/multerConfig'); // Importar ambas funciones
const { processExcelFile ,excelAsignaciones,excelAte,descarga_ATE,descargar_novedad} = require('../controllers/excel.controller');
const { requirePermission } = require('../middlewares/auth.middleware.js');
const { uploadLimiter } = require('../middlewares/rateLimit.middleware.js');

// Definir ruta para subir y procesar archivos
router.post('/upload', requirePermission('catalogos.gestionar'), uploadLimiter, upload.single('file'), processExcelFile);
router.post('/excelAsignaciones', requirePermission('asignaciones.importar'), uploadLimiter, uploadMemory.single('file'), excelAsignaciones);
router.post('/excelAte', requirePermission('ate.asignar'), uploadLimiter, uploadMemory.single('file'), excelAte);
router.post('/ate', requirePermission('ate.exportar'), uploadLimiter, descarga_ATE);
router.post('/novedad', requirePermission('novedades.exportar'), uploadLimiter, descargar_novedad);

module.exports = router;
