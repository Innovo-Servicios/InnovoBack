const router = require('express').Router();
const multer = require('multer')  
const { requireAuth, requirePermission } = require('../middlewares/auth.middleware.js');
const { authLimiter, uploadLimiter } = require('../middlewares/rateLimit.middleware.js');

const {obtenerRegionChile,creartrabajador, modificardatostrabajador, eliminartrabajador, login,listarTrabajadores,obtenerTrabajador, updatePushToken, listarTrabajadoresConectados,seguimientoUbicaciones,datosTrabajador, datosApp,obtenerSesion,fotoTrabajador} = require('../controllers/trabajador.controller.js');

const storage = multer.memoryStorage({limits: { fileSize: 524288000 }});
const upload = multer({ storage }); 

router.get('/',(req, res)=>{
    res.send('Ruta de trabajador');
});

router.post('/creartrabajador', requireAuth, requirePermission('trabajadores.crear'), creartrabajador)
router.put('/modificardatostrabajador', requireAuth, requirePermission('trabajadores.editar'), modificardatostrabajador)
router.delete('/eliminartrabajador', requireAuth, requirePermission('trabajadores.eliminar'), eliminartrabajador)
router.post('/login', authLimiter, login)
router.post('/listarTrabajadores', requireAuth, requirePermission('trabajadores.ver'), listarTrabajadores)
router.post('/obtenerTrabajador', requireAuth, obtenerTrabajador)
router.post('/updatePushToken', requireAuth, updatePushToken)
router.get('/listarTrabajadoresConectados', requireAuth, requirePermission('seguimiento.ver'), listarTrabajadoresConectados)
router.get('/seguimientoUbicaciones', requireAuth, requirePermission('seguimiento.ver'), seguimientoUbicaciones)
router.get('/sesion', requireAuth, obtenerSesion)
router.post('/datosTrabajador', requireAuth, datosTrabajador)
router.post('/datosApp', requireAuth, datosApp)
router.post('/fotoTrabajador', requireAuth, uploadLimiter, upload.single('file'), fotoTrabajador)
router.post('/obtenerRegionChile', requireAuth, obtenerRegionChile)
module.exports = router;
