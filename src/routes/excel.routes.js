const express = require('express');
const router = express.Router();
const { upload, uploadMemory } = require('../middlewares/multerConfig'); // Importar ambas funciones
const { processExcelFile ,excelAsignaciones,excelAte,descarga_ATE,descargar_novedad} = require('../controllers/excel.controller');

// Definir ruta para subir y procesar archivos
router.post('/upload', upload.single('file'), processExcelFile);
router.post('/excelAsignaciones', uploadMemory.single('file'), excelAsignaciones);
router.post('/excelAte', uploadMemory.single('file'), excelAte);
router.post('/ate', descarga_ATE);
router.post('/novedad', descargar_novedad);

module.exports = router;