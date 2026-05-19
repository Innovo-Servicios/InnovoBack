const router = require('express').Router();
const multer = require('multer')  

const {crearcliente, eliminarCliente, obtenercliente} = require('../controllers/cliente.controller.js');
const { requireRole } = require('../middlewares/auth.middleware.js');
const { Router } = require('express');

const storage = multer.memoryStorage({limits: { fileSize: 524288000 }});
const upload = multer({ storage }); 

router.get('/',(req, res)=>{
    res.send('Ruta de cliente');
});

router.post('/crearcliente', requireRole('administracion', 'supervisor'), crearcliente)
router.delete('/eliminarcliente', requireRole('administracion', 'supervisor'), eliminarCliente)
router.get('/obtenercliente', requireRole('administracion', 'supervisor'), obtenercliente)

module.exports = router;
