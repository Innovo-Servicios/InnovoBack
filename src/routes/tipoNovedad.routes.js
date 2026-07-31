const {crearTipoNovedad,obtenerTipoNovedad,eliminarTipoNovedad} = require('../controllers/tipoNovedad.controller.js');
const { Router } = require('express');
const router = require('express').Router();
const { requirePermission } = require('../middlewares/auth.middleware.js');


router.get('/', (req, res) => {
  res.send('Ruta de medidor');
});

router.post('/crearTipoNovedad', requirePermission('catalogos.gestionar'), crearTipoNovedad);
router.post('/obtenerTipoNovedad', obtenerTipoNovedad);
router.delete('/eliminarTipoNovedad', requirePermission('catalogos.gestionar'), eliminarTipoNovedad);

module.exports = router;
