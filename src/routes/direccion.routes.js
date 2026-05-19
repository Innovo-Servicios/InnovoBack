const router = require('express').Router();
const multer = require('multer')  

const {agregardireccion, modificardireccion, obtenerdireccion,obtenerDireccionesSector,modificarCoord,comentarDireccion,listadirecciones} = require('../controllers/direccion.controller.js');
const { requireRole } = require('../middlewares/auth.middleware.js');

const storage = multer.memoryStorage({limits: { fileSize: 524288000 }});
const upload = multer({ storage }); 

router.get('/',(req, res)=>{
    res.send('Ruta de direccion');
});

router.post('/agregardireccion', requireRole('administracion', 'supervisor'), agregardireccion)
router.put('/modificardireccion', requireRole('administracion', 'supervisor'), modificardireccion)
router.post('/obtenerdireccion', requireRole('administracion', 'supervisor'), obtenerdireccion)
router.post('/obtenerDireccionesSector', requireRole('administracion', 'supervisor'), obtenerDireccionesSector)
router.post('/modificarCoord', requireRole('administracion', 'supervisor'), modificarCoord)
router.post('/comentarDireccion', requireRole('administracion', 'supervisor'), comentarDireccion)
router.post('/listadirecciones',listadirecciones)
module.exports = router;
