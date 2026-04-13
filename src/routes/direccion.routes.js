const router = require('express').Router();
const multer = require('multer')  

const {agregardireccion, modificardireccion, obtenerdireccion,obtenerDireccionesSector,modificarCoord,comentarDireccion,listadirecciones} = require('../controllers/direccion.controller.js');

const storage = multer.memoryStorage({limits: { fileSize: 524288000 }});
const upload = multer({ storage }); 

router.get('/',(req, res)=>{
    res.send('Ruta de direccion');
});

router.post('/agregardireccion', agregardireccion)
router.put('/modificardireccion',modificardireccion)
router.post('/obtenerdireccion', obtenerdireccion)
router.post('/obtenerDireccionesSector', obtenerDireccionesSector)
router.post('/modificarCoord',modificarCoord)
router.post('/comentarDireccion',comentarDireccion)
router.post('/listadirecciones',listadirecciones)
module.exports = router;