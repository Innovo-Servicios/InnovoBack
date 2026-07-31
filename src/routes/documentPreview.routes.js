const router = require('express').Router();
const { requireAuth } = require('../middlewares/auth.middleware.js');
const controller = require('../controllers/documentPreview.controller.js');

router.post('/ticket', requireAuth, controller.createPreviewTicket);
router.get('/:ticket', controller.openPreviewTicket);

module.exports = router;
