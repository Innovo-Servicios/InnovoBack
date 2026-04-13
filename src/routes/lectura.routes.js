const router = require('express').Router();
const multer = require('multer')  

const {crearlectura, obtenerlectura} = require('../controllers/lectura.controller.js');

const storage = multer.memoryStorage({limits: { fileSize: 524288000 }});
const upload = multer({ storage }); 

router.get('/',(req, res)=>{
    res.send('Ruta de lectura');
});

router.post('/crearlectura', crearlectura)
router.get('/obtenerlectura', obtenerlectura)

module.exports = router;