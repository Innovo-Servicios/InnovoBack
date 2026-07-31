const router = require('express').Router();
const multer = require('multer')  

const {crearcliente, eliminarCliente, obtenercliente} = require('../controllers/cliente.controller.js');
const { requirePermission } = require('../middlewares/auth.middleware.js');
const { Router } = require('express');

const storage = multer.memoryStorage({limits: { fileSize: 524288000 }});
const upload = multer({ storage }); 

router.get('/',(req, res)=>{
    res.send('Ruta de cliente');
});

router.post('/crearcliente', requirePermission('clientes.gestionar'), crearcliente)
router.delete('/eliminarcliente', requirePermission('clientes.gestionar'), eliminarCliente)
router.get('/obtenercliente', requirePermission('clientes.ver'), obtenercliente)

module.exports = router;
