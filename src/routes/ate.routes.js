const router = require('express').Router();
const {asignacionATE,obtenerATE,repsuestaATE, obtenerATE_Adm, editarATE} = require('../middlewares/notificacion_asignacion.middleware.js');
const {uploadMemory, upload} = require('../middlewares/multerConfig'); // Importar ambas funciones
router.get('/',(req, res)=>{
    res.send('Ruta de asignacion');
});
router.post('/asignacionATE', asignacionATE); 
router.post('/obtenerATE', obtenerATE);
router.post('/obtenerATE_Adm', obtenerATE_Adm);
router.post('/repsuestaATE',uploadMemory.single('file'),repsuestaATE);
router.put('/editarATE', editarATE);
module.exports = router;