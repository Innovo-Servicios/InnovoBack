const router = require('express').Router();
const multer = require('multer')  

const {agregarmedidor } = require('../controllers/medidor.controller.js');

const storage = multer.memoryStorage({limits: { fileSize: 524288000 }});
const upload = multer({ storage }); 

router.get('/',(req, res)=>{
    res.send('Ruta de medidor');
});

router.post('/agregarmedidor', agregarmedidor)

module.exports = router;