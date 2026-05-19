const router = require('express').Router();

const { crearrutas ,calcularPerimetral} = require('../controllers/ruta.controller.js');
const { requireRole } = require('../middlewares/auth.middleware.js');

router.get('/',(req, res)=>{
    res.send('Ruta de ruta');
});

router.post('/crearrutas', requireRole('administracion', 'supervisor'), crearrutas)
router.post('/calcularPerimetral', requireRole('administracion', 'supervisor'), calcularPerimetral)

module.exports = router;
