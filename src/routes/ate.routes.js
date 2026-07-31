const router = require('express').Router();
const {asignacionATE,obtenerATE,repsuestaATE, obtenerATE_Adm, editarATE} = require('../middlewares/notificacion_asignacion.middleware.js');
const {uploadMemory, upload} = require('../middlewares/multerConfig'); // Importar ambas funciones
const { requirePermission } = require('../middlewares/auth.middleware.js');
router.get('/',(req, res)=>{
    res.send('Ruta de asignacion');
});
router.post('/asignacionATE', requirePermission('ate.asignar'), asignacionATE);
router.post('/obtenerATE', obtenerATE);
router.post('/obtenerATE_Adm', requirePermission('ate.ver'), obtenerATE_Adm);
router.post('/repsuestaATE',uploadMemory.single('file'),repsuestaATE);
router.put('/editarATE', requirePermission('ate.editar'), editarATE);
module.exports = router;
