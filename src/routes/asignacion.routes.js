const router = require('express').Router();

const {asignarsector, modificarasigancion,obtenerAsignacion,obtenerAsigMes,obtenerAsignacionDia,asignarApoyo, obtenerVistaAsignaciones} = require('../controllers/asignacion.controller.js');
const {
    confirmarCreadorAsignaciones,
    guardarPlantillaCreador,
    obtenerCatalogoCreador,
    obtenerFeriadosChilenos,
    obtenerPlantillaCreador,
    previsualizarAsignacionesManuales,
    previsualizarCreadorAsignaciones,
} = require('../controllers/asignacionCreador.controller.js');
const { excelAsignaciones} = require('../controllers/excel.controller');
const { requireRole } = require('../middlewares/auth.middleware.js');
const { uploadLimiter } = require('../middlewares/rateLimit.middleware.js');

const {uploadMemory} = require('../middlewares/multerConfig'); // Importar ambas funciones


router.get('/',(req, res)=>{
    res.send('Ruta de asignacion');
});
router.post('/asignacionMes',obtenerAsigMes)
router.post('/asignarsector', requireRole('administracion', 'supervisor'), asignarsector)
router.post('/obtenerAsignacion',obtenerAsignacion)
router.put('/modificarasigancion', requireRole('administracion', 'supervisor'), modificarasigancion)
router.post('/obtenerAsignacionDia', requireRole('administracion', 'supervisor'), obtenerAsignacionDia)
router.post('/vistaAsignaciones', requireRole('administracion', 'supervisor'), obtenerVistaAsignaciones)
router.get('/feriados/:year', requireRole('administracion', 'supervisor'), obtenerFeriadosChilenos)
router.post('/creador/catalogo', requireRole('administracion', 'supervisor'), obtenerCatalogoCreador)
router.post('/creador/plantilla', requireRole('administracion', 'supervisor'), obtenerPlantillaCreador)
router.put('/creador/plantilla', requireRole('administracion', 'supervisor'), guardarPlantillaCreador)
router.post('/creador/previsualizar', requireRole('administracion', 'supervisor'), previsualizarCreadorAsignaciones)
router.post('/creador/manual/previsualizar', requireRole('administracion', 'supervisor'), previsualizarAsignacionesManuales)
router.post('/creador/confirmar', requireRole('administracion', 'supervisor'), confirmarCreadorAsignaciones)
router.post('/uploadAsignacion', requireRole('administracion', 'supervisor'), uploadLimiter, uploadMemory.single('file'),excelAsignaciones)
router.post('/asignarApoyo', requireRole('administracion', 'supervisor'), asignarApoyo)

module.exports = router;
