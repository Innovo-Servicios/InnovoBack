const router = require('express').Router();
const {asignacionATE,obtenerATE,repsuestaATE, obtenerATE_Adm, editarATE} = require('../middlewares/notificacion_asignacion.middleware.js');
const {uploadMemory, upload} = require('../middlewares/multerConfig'); // Importar ambas funciones
const { requireRole } = require('../middlewares/auth.middleware.js');
router.get('/',(req, res)=>{
    res.send('Ruta de asignacion');
});
router.post('/asignacionATE', requireRole('administracion', 'supervisor'), asignacionATE); 
router.post('/obtenerATE', obtenerATE);
router.post('/obtenerATE_Adm', requireRole('administracion', 'supervisor'), obtenerATE_Adm);
router.post('/repsuestaATE',uploadMemory.single('file'),repsuestaATE);
router.put('/editarATE', requireRole('administracion', 'supervisor'), editarATE);
module.exports = router;
