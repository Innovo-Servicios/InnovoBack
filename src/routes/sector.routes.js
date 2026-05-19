const router = require('express').Router();

const {crearsectores,obtenerDatosSectores,tablaSectores,obtenerSectoresRuta,calcularPerimetro,sectorApoyo} = require('../controllers/sector.controller.js');
const { requireRole } = require('../middlewares/auth.middleware.js');


router.get('/',(req, res)=>{
    res.send('Ruta de sector');
});

router.post('/crearsectores', requireRole('administracion', 'supervisor'), crearsectores)
router.post('/obtenerDatosSectores', requireRole('administracion', 'supervisor'), obtenerDatosSectores)
router.post('/tablaSectores', requireRole('administracion', 'supervisor'), tablaSectores)
router.post('/obtenerSectoresRuta', requireRole('administracion', 'supervisor'), obtenerSectoresRuta)
router.post('/calcularPerimetro', requireRole('administracion', 'supervisor'), async (req, res) => {
    try {
        const a=await calcularPerimetro(req.body.NumeroSector);
        res.status(200).send(a);
    } catch (error) {
        res.status(500).send('Error interno del servidor');
    }
});
router.post('/sectorApoyo', requireRole('administracion', 'supervisor'), sectorApoyo)
module.exports = router;
