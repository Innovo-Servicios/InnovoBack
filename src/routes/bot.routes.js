const router = require('express').Router();
const {
  enviarResultadoBotGmailWhatsapp,
} = require('../controllers/bot.controller.js');

router.post('/gmail-ate/whatsapp-result', enviarResultadoBotGmailWhatsapp);

module.exports = router;
