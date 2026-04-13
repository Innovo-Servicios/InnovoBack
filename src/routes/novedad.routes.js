const {obtenerUltimasNovedadesDelDia,crearNovedad ,obtenerNovedadUno, modificarNovedad, borrarNovedad,hacernovedad,obtenerNovedadTodos} = require('../controllers/novedad.controller.js');
const router = require('express').Router();
const {uploadMemory} = require('../middlewares/multerConfig');

router.get('/', (req, res) => {
  res.send('Ruta de medidor');
});
router.post('/crearNovedad',uploadMemory.single('file'),crearNovedad);
router.post('/obtenerNovedadUno', obtenerNovedadUno);
router.post('/modificarNovedad', modificarNovedad);
router.post('/borrarNovedad', borrarNovedad);
router.post('/hacernovedad',hacernovedad);
router.post('/obtenerNovedadTodos',obtenerNovedadTodos);
router.post('/UltimasNovedadesDia', obtenerUltimasNovedadesDelDia);
module.exports = router;
