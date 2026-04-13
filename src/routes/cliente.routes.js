const router = require('express').Router();
const multer = require('multer')  

const {crearcliente, eliminarCliente, obtenercliente} = require('../controllers/cliente.controller.js');
const { Router } = require('express');

const storage = multer.memoryStorage({limits: { fileSize: 524288000 }});
const upload = multer({ storage }); 

router.get('/',(req, res)=>{
    res.send('Ruta de cliente');
});

router.post('/crearcliente', crearcliente)
router.delete('/eliminarcliente', eliminarCliente)
router.get('/obtenercliente', obtenercliente)

module.exports = router;
