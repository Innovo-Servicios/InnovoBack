const router = require('express').Router();

const {crearsectores,obtenerDatosSectores,tablaSectores,obtenerSectoresRuta,calcularPerimetro,sectorApoyo} = require('../controllers/sector.controller.js');
const { requirePermission } = require('../middlewares/auth.middleware.js');


router.get('/',(req, res)=>{
    res.send('Ruta de sector');
});

router.post('/crearsectores', requirePermission('sectores.gestionar'), crearsectores)
router.post('/obtenerDatosSectores', requirePermission('sectores.ver'), obtenerDatosSectores)
router.post('/tablaSectores', requirePermission('sectores.ver'), tablaSectores)
router.post('/obtenerSectoresRuta', requirePermission('sectores.ver'), obtenerSectoresRuta)
router.post('/calcularPerimetro', requirePermission('sectores.gestionar'), async (req, res) => {
    try {
        const a=await calcularPerimetro(req.body.NumeroSector);
        res.status(200).send(a);
    } catch (error) {
        res.status(500).send('Error interno del servidor');
    }
});
router.post('/sectorApoyo', requirePermission('trabajadores.apoyos.gestionar'), sectorApoyo)
module.exports = router;
