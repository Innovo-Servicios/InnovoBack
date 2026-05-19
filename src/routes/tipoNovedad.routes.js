const {crearTipoNovedad,obtenerTipoNovedad,eliminarTipoNovedad} = require('../controllers/tipoNovedad.controller.js');
const { Router } = require('express');
const router = require('express').Router();
const { requireRole } = require('../middlewares/auth.middleware.js');


router.get('/', (req, res) => {
  res.send('Ruta de medidor');
});

router.post('/crearTipoNovedad', requireRole('administracion'), crearTipoNovedad);
router.post('/obtenerTipoNovedad', obtenerTipoNovedad);
router.delete('/eliminarTipoNovedad', requireRole('administracion'), eliminarTipoNovedad);

module.exports = router;
