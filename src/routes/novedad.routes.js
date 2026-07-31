const {obtenerUltimasNovedadesDelDia,crearNovedad ,obtenerNovedadUno, modificarNovedad, borrarNovedad,hacernovedad,obtenerNovedadTodos} = require('../controllers/novedad.controller.js');
const router = require('express').Router();
const {uploadMemory} = require('../middlewares/multerConfig');
const { requirePermission } = require('../middlewares/auth.middleware.js');

router.get('/', (req, res) => {
  res.send('Ruta de medidor');
});
router.post('/crearNovedad',uploadMemory.array('file', 2),crearNovedad);
router.post('/obtenerNovedadUno', obtenerNovedadUno);
router.post('/modificarNovedad', requirePermission('novedades.editar'), modificarNovedad);
router.post('/borrarNovedad', requirePermission('novedades.eliminar'), borrarNovedad);
router.post('/hacernovedad', requirePermission('novedades.crear'), hacernovedad);
router.post('/obtenerNovedadTodos', requirePermission('novedades.ver'), obtenerNovedadTodos);
router.post('/UltimasNovedadesDia', requirePermission('novedades.ver'), obtenerUltimasNovedadesDelDia);
module.exports = router;
