const router = require('express').Router();
const multer = require('multer')  

const {agregardireccion, modificardireccion, obtenerdireccion,obtenerDireccionesSector,modificarCoord,comentarDireccion,listadirecciones} = require('../controllers/direccion.controller.js');
const { requirePermission } = require('../middlewares/auth.middleware.js');

const storage = multer.memoryStorage({limits: { fileSize: 524288000 }});
const upload = multer({ storage }); 

router.get('/',(req, res)=>{
    res.send('Ruta de direccion');
});

router.post('/agregardireccion', requirePermission('direcciones.gestionar'), agregardireccion)
router.put('/modificardireccion', requirePermission('direcciones.gestionar'), modificardireccion)
router.post('/obtenerdireccion', requirePermission('direcciones.ver'), obtenerdireccion)
router.post('/obtenerDireccionesSector', requirePermission('direcciones.ver'), obtenerDireccionesSector)
router.post('/modificarCoord', requirePermission('direcciones.gestionar'), modificarCoord)
router.post('/comentarDireccion', requirePermission('direcciones.comentar'), comentarDireccion)
router.post('/listadirecciones',listadirecciones)
module.exports = router;
