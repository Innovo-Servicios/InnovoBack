const router = require('express').Router();

const { registroNotificacion} = require('../middlewares/notificacion_trabajador.middleware.js');


router.get('/', (req, res) => {
  res.send('Ruta de medidor');
});

router.post('/registroNotificacion', registroNotificacion);

module.exports = router;
