const {crearTipoNovedad,obtenerTipoNovedad,eliminarTipoNovedad} = require('../controllers/tipoNovedad.controller.js');
const { Router } = require('express');
const router = require('express').Router();


router.get('/', (req, res) => {
  res.send('Ruta de medidor');
});

router.post('/crearTipoNovedad', crearTipoNovedad);
router.post('/obtenerTipoNovedad', obtenerTipoNovedad);
router.delete('/eliminarTipoNovedad', eliminarTipoNovedad);

module.exports = router;
