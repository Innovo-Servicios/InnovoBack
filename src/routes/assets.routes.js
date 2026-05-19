const router = require('express').Router();
const { descargarAsset } = require('../controllers/assets.controller.js');

router.get('/:type/:fileName', descargarAsset);

module.exports = router;
