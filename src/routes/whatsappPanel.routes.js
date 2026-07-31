const router = require('express').Router();
const {
  getWhatsappPanelStatus,
  initializeWhatsappPanelClient,
  renderWhatsappPanel,
  requireWhatsappPanelToken,
  restartWhatsappPanelClient,
  sendPanelScript,
  sendWhatsappPanelMessage,
} = require('../controllers/whatsappPanel.controller.js');

router.get('/', renderWhatsappPanel);
router.get('/panel.js', sendPanelScript);
router.get('/api/status', requireWhatsappPanelToken, getWhatsappPanelStatus);
router.post('/api/initialize', requireWhatsappPanelToken, initializeWhatsappPanelClient);
router.post('/api/restart', requireWhatsappPanelToken, restartWhatsappPanelClient);
router.post('/api/send', requireWhatsappPanelToken, sendWhatsappPanelMessage);

module.exports = router;
