const router = require('express').Router();

const {asignarsector, modificarasigancion,obtenerAsignacion,obtenerAsigMes,obtenerAsignacionDia,asignarApoyo} = require('../controllers/asignacion.controller.js');
const { excelAsignaciones} = require('../controllers/excel.controller');

const {uploadMemory} = require('../middlewares/multerConfig'); // Importar ambas funciones


router.get('/',(req, res)=>{
    res.send('Ruta de asignacion');
});
router.post('/asignacionMes',obtenerAsigMes)
router.post('/asignarsector', asignarsector)
router.post('/obtenerAsignacion',obtenerAsignacion)
router.put('/modificarasigancion', modificarasigancion)
router.post('/obtenerAsignacionDia',obtenerAsignacionDia)
router.post('/uploadAsignacion', uploadMemory.single('file'),excelAsignaciones)
router.post('/asignarApoyo',asignarApoyo)

module.exports = router;