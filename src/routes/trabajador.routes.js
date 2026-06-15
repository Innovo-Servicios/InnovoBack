const router = require('express').Router();
const multer = require('multer')  
const { requireAuth, requireRole } = require('../middlewares/auth.middleware.js');
const { authLimiter, uploadLimiter } = require('../middlewares/rateLimit.middleware.js');

const {obtenerRegionChile,creartrabajador, modificardatostrabajador, eliminartrabajador, login,listarTrabajadores,obtenerTrabajador, updatePushToken, listarTrabajadoresConectados,seguimientoUbicaciones,datosTrabajador, datosApp,fotoTrabajador} = require('../controllers/trabajador.controller.js');

const storage = multer.memoryStorage({limits: { fileSize: 524288000 }});
const upload = multer({ storage }); 

router.get('/',(req, res)=>{
    res.send('Ruta de trabajador');
});

router.post('/creartrabajador', requireAuth, requireRole('administracion'), creartrabajador)
router.put('/modificardatostrabajador', requireAuth, requireRole('administracion'), modificardatostrabajador)
router.delete('/eliminartrabajador', requireAuth, requireRole('administracion'), eliminartrabajador)
router.post('/login', authLimiter, login)
router.post('/listarTrabajadores', requireAuth, requireRole('administracion', 'supervisor'), listarTrabajadores)
router.post('/obtenerTrabajador', requireAuth, obtenerTrabajador)
router.post('/updatePushToken', requireAuth, updatePushToken)
router.get('/listarTrabajadoresConectados', requireAuth, requireRole('administracion', 'supervisor'), listarTrabajadoresConectados)
router.get('/seguimientoUbicaciones', requireAuth, requireRole('administracion', 'supervisor'), seguimientoUbicaciones)
router.post('/datosTrabajador', requireAuth, datosTrabajador)
router.post('/datosApp', requireAuth, datosApp)
router.post('/fotoTrabajador', requireAuth, uploadLimiter, upload.single('file'), fotoTrabajador)
router.post('/obtenerRegionChile', requireAuth, obtenerRegionChile)
module.exports = router;
