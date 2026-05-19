const {obtenerUltimasNovedadesDelDia,crearNovedad ,obtenerNovedadUno, modificarNovedad, borrarNovedad,hacernovedad,obtenerNovedadTodos} = require('../controllers/novedad.controller.js');
const router = require('express').Router();
const {uploadMemory} = require('../middlewares/multerConfig');
const { requireRole } = require('../middlewares/auth.middleware.js');

router.get('/', (req, res) => {
  res.send('Ruta de medidor');
});
router.post('/crearNovedad',uploadMemory.single('file'),crearNovedad);
router.post('/obtenerNovedadUno', obtenerNovedadUno);
router.post('/modificarNovedad', requireRole('administracion', 'supervisor'), modificarNovedad);
router.post('/borrarNovedad', requireRole('administracion', 'supervisor'), borrarNovedad);
router.post('/hacernovedad', requireRole('administracion', 'supervisor'), hacernovedad);
router.post('/obtenerNovedadTodos', requireRole('administracion', 'supervisor'), obtenerNovedadTodos);
router.post('/UltimasNovedadesDia', requireRole('administracion', 'supervisor'), obtenerUltimasNovedadesDelDia);
module.exports = router;
