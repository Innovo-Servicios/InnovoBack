const router = require('express').Router();

const { crearrutas ,calcularPerimetral} = require('../controllers/ruta.controller.js');
const { requirePermission } = require('../middlewares/auth.middleware.js');

router.get('/',(req, res)=>{
    res.send('Ruta de ruta');
});

router.post('/crearrutas', requirePermission('rutas.gestionar'), crearrutas)
router.post('/calcularPerimetral', requirePermission('rutas.gestionar'), calcularPerimetral)

module.exports = router;
