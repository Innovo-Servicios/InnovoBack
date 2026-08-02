const router = require('express').Router();
const { verificarDocumento } = require('../controllers/documentoVerificacion.controller.js');

router.get('/:codigo', verificarDocumento);

module.exports = router;
