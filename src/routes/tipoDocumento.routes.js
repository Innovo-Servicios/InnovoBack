const router = require('express').Router();

const {crearTipo,obtenerTipos,eliminarTipo} = require('../controllers/tipoDocumento.controller.js');


router.post('/crearTipo',crearTipo);
router.post('/obtenerTipos',obtenerTipos);
router.post('/eliminarTipo',eliminarTipo);

module.exports = router;