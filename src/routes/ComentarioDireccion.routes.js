const router = require('express').Router();

const {crearComentario, obtenerComentario, eliminarComentario}= require('../controllers/ComentarioDireccion.controller.js');

router.get('/',(req, res)=>{
    res.send('Ruta de comentario');
});

router.post('/crearComentario', crearComentario)
router.post('/obtenerComentario', obtenerComentario)
router.post('/eliminarComentario', eliminarComentario)

module.exports = router;