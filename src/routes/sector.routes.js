const router = require('express').Router();

const {crearsectores,obtenerDatosSectores,tablaSectores,obtenerSectoresRuta,calcularPerimetro,sectorApoyo} = require('../controllers/sector.controller.js');


router.get('/',(req, res)=>{
    res.send('Ruta de sector');
});

router.post('/crearsectores', crearsectores)
router.post('/obtenerDatosSectores', obtenerDatosSectores)
router.post('/tablaSectores', tablaSectores)
router.post('/obtenerSectoresRuta',obtenerSectoresRuta)
router.post('/calcularPerimetro', async (req, res) => {
    try {
        const a=await calcularPerimetro(req.body.NumeroSector);
        res.status(200).send(a);
    } catch (error) {
        res.status(500).send(error.message);
    }
});
router.post('/sectorApoyo',sectorApoyo)
module.exports = router;