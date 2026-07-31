const router = require('express').Router();

const {asignarsector, modificarasigancion,obtenerAsignacion,obtenerAsigMes,obtenerAsignacionDia,asignarApoyo, obtenerVistaAsignaciones} = require('../controllers/asignacion.controller.js');
const {
    confirmarCreadorAsignaciones,
    generarPropuestaCreador,
    guardarExcepcionesCreador,
    guardarPlantillaCreador,
    obtenerCatalogoCreador,
    obtenerFeriadosChilenos,
    obtenerPlantillaCreador,
    previsualizarAsignacionesManuales,
    previsualizarCreadorAsignaciones,
} = require('../controllers/asignacionCreador.controller.js');
const { excelAsignaciones} = require('../controllers/excel.controller');
const {
    exportarProgramacionAsignaciones,
    exportarProgramacionAsignacionesPdf,
} = require('../controllers/asignacionExport.controller.js');
const { requirePermission } = require('../middlewares/auth.middleware.js');
const { uploadLimiter } = require('../middlewares/rateLimit.middleware.js');

const {uploadMemory} = require('../middlewares/multerConfig'); // Importar ambas funciones


router.get('/',(req, res)=>{
    res.send('Ruta de asignacion');
});
router.post('/asignacionMes',obtenerAsigMes)
router.post('/asignarsector', requirePermission('asignaciones.crear'), asignarsector)
router.post('/obtenerAsignacion',obtenerAsignacion)
router.put('/modificarasigancion', requirePermission('asignaciones.editar'), modificarasigancion)
router.post('/obtenerAsignacionDia', requirePermission('asignaciones.ver'), obtenerAsignacionDia)
router.post('/vistaAsignaciones', requirePermission('asignaciones.ver'), obtenerVistaAsignaciones)
router.get('/exportar/programacion', requirePermission('asignaciones.exportar'), exportarProgramacionAsignaciones)
router.post('/exportar/programacion', requirePermission('asignaciones.exportar'), exportarProgramacionAsignaciones)
router.get('/exportar/programacion/pdf', requirePermission('asignaciones.exportar'), exportarProgramacionAsignacionesPdf)
router.get('/feriados/:year', requirePermission('asignaciones.ver'), obtenerFeriadosChilenos)
router.get('/creador/catalogo', requirePermission('asignaciones.ver'), obtenerCatalogoCreador)
router.post('/creador/catalogo', requirePermission('asignaciones.ver'), obtenerCatalogoCreador)
router.post('/creador/plantilla', requirePermission('asignaciones.ver'), obtenerPlantillaCreador)
router.put('/creador/plantilla', requirePermission('asignaciones.configurar'), guardarPlantillaCreador)
router.put('/creador/excepciones', requirePermission('asignaciones.configurar'), guardarExcepcionesCreador)
router.post('/creador/propuesta', requirePermission('asignaciones.crear'), generarPropuestaCreador)
router.post('/creador/previsualizar', requirePermission('asignaciones.crear'), previsualizarCreadorAsignaciones)
router.post('/creador/manual/previsualizar', requirePermission('asignaciones.crear'), previsualizarAsignacionesManuales)
router.post('/creador/confirmar', requirePermission('asignaciones.crear'), confirmarCreadorAsignaciones)
router.post('/uploadAsignacion', requirePermission('asignaciones.importar'), uploadLimiter, uploadMemory.single('file'),excelAsignaciones)
router.post('/asignarApoyo', requirePermission('trabajadores.apoyos.gestionar'), asignarApoyo)

module.exports = router;
